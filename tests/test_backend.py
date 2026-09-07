import argparse
import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from codenotch import model
from codenotch.providers import Provider, discover, sqlite_rows, request_json, NoRedirect, glm_key
from codenotch.worker import DEFAULTS, atomic_json, configuration, update_provider, demo_snapshot, collect

class Parsers(unittest.TestCase):
    def test_claude_merge_and_headline(self):
        out=model.claude({'limits':[{'kind':'weekly_all','percent':7,'resets_at':'2026-10-01T00:00:00Z'}],'five_hour':{'utilization':73,'resets_at':'2026-09-08T00:00:00Z'}},0)
        self.assertEqual([w['id'] for w in out],['session','weekly_all']);self.assertEqual(out[0]['fraction'],.73)
    def test_claude_zero_is_reading(self):
        self.assertEqual(model.claude({'five_hour':{'utilization':0}},0)[0]['fraction'],0)
    def test_codex_actual_window_length(self):
        out=model.codex({'rate_limit':{'primary_window':{'used_percent':21,'limit_window_seconds':2592000,'reset_after_seconds':300}}},100)
        self.assertEqual(out[0]['label'],'Monthly limit');self.assertEqual(out[0]['resetsAt'],400)
    def test_codex_ignores_review_quota(self):
        with self.assertRaises(model.ProviderError):model.codex({'code_review_rate_limit':{'primary_window':{'used_percent':99}}},0)
    def test_cursor_free_plan_allowance(self):
        out=model.cursor({'individualUsage':{'plan':{'totalPercentUsed':9.5,'used':0,'limit':0}}},0)
        self.assertEqual(out[0]['fraction'],.095)
    def test_cursor_no_invented_zero(self):
        with self.assertRaises(model.ProviderError):model.cursor({'isUnlimited':True},0)
    def test_glm_http_200_error_envelope(self):
        with self.assertRaises(model.ProviderError) as e:model.glm({'code':401,'success':False},0)
        self.assertEqual(e.exception.status,'needsAuth')
    def test_glm_credit_plan_and_millis(self):
        out=model.glm({'data':{'limits':[{'type':'CREDIT_LIMIT','unit':3,'number':5,'percentage':12.5,'nextResetTime':1788682200000}]}},0)
        self.assertEqual(out[0]['id'],'session');self.assertEqual(out[0]['resetsAt'],1788682200)
    def test_grok_product_fallback_headline(self):
        out=model.grok({'config':{'productUsage':[{'product':'GrokBuild','usagePercent':8}]}},0)
        self.assertEqual(out[0]['id'],'credits');self.assertEqual(out[0]['fraction'],.08)
    def test_opencode_order(self):
        out=model.opencode({'usage':{'monthly':{'percent':4},'rolling':{'percent':32},'weekly':{'percent':10}}},0)
        self.assertEqual([w['id'] for w in out],['rolling','weekly','monthly'])
    def test_antigravity_remaining_inversion(self):
        out=model.antigravity({'response':{'groups':[{'displayName':'Gemini','buckets':[{'remainingFraction':.8}]}]}},0)
        self.assertAlmostEqual(out[0]['fraction'],.2)
    def test_invalid_numbers_not_zero(self):
        for value in [None,True,float('nan'),float('inf'),-1,'0']:
            with self.assertRaises(model.ProviderError):model.window('x','x',value)
    def test_over_limit_preserved(self):self.assertEqual(model.window('x','x',120)['fraction'],1.2)

class State(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.home=self.root/'home';self.home.mkdir();self.config=self.home/'.config';self.data=self.home/'.local/share';self.p=Provider('claude','Claude','claude',self.home/'.claude')
    def tearDown(self):self.temp.cleanup()
    def test_profile_order(self):
        (self.home/'.claude-work').mkdir();(self.home/'.claude-alpha').mkdir()
        self.assertEqual([p.id for p in discover(self.home,self.config,self.data)][:3],['claude','claude:.claude-alpha','claude:.claude-work'])
    def test_disable_never_reads_credentials_and_purges(self):
        with patch('codenotch.worker.detected',side_effect=AssertionError('read disabled credentials')):
            out=update_provider(self.p,{'windows':[{'fraction':.73}]},{**DEFAULTS,'disabled':['claude']},self.home,self.config,self.data,'all')
        self.assertEqual(out['windows'],[]);self.assertEqual(out['status'],'disabled')
    def test_backoff_survives_forced_refresh(self):
        old={'status':'stale','retryAt':time.time()+600,'windows':[{'fraction':.7}]}
        with patch('codenotch.worker.detected',return_value=True),patch('codenotch.worker.sessions',return_value=[]),patch.object(Provider,'fetch',side_effect=AssertionError('ignored backoff')):
            out=update_provider(self.p,old,DEFAULTS,self.home,self.config,self.data,'all')
        self.assertEqual(out['windows'],old['windows'])
    def test_rate_limit_zero_delays_and_retains(self):
        with patch('codenotch.worker.detected',return_value=True),patch('codenotch.worker.sessions',return_value=[]),patch.object(Provider,'fetch',side_effect=model.ProviderError('rateLimited','retry',0)):
            before=time.time();out=update_provider(self.p,{'windows':[{'fraction':.73}]},DEFAULTS,self.home,self.config,self.data,'all')
        self.assertGreaterEqual(out['retryAt'],before+59);self.assertEqual(out['status'],'stale');self.assertEqual(out['windows'][0]['fraction'],.73)
    def test_retry_after_server_floor(self):
        with patch('codenotch.worker.detected',return_value=True),patch('codenotch.worker.sessions',return_value=[]),patch.object(Provider,'fetch',side_effect=model.ProviderError('rateLimited','retry',3600)):
            before=time.time();out=update_provider(self.p,{},DEFAULTS,self.home,self.config,self.data,'all')
        self.assertGreaterEqual(out['retryAt'],before+3599)
    def test_atomic_files_are_private(self):
        p=self.config/'codenotch/settings.json';atomic_json(p,{'edge':'left'})
        self.assertEqual(p.stat().st_mode&0o777,0o600);self.assertEqual(configuration(self.config)['edge'],'left')
    def test_bad_settings_get_defaults(self):
        atomic_json(self.config/'codenotch/settings.json',{'scale':999,'edge':'invalid','disabled':5})
        out=configuration(self.config);self.assertEqual(out['scale'],1);self.assertEqual(out['edge'],'right');self.assertEqual(out['disabled'],[])
    def test_sqlite_reads_uncheckpointed_wal(self):
        p=self.root/'state.db';db=sqlite3.connect(p);db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE ItemTable(key TEXT,value TEXT)');db.execute('INSERT INTO ItemTable VALUES (?,?)',('token','rotated'));db.commit()
        self.assertEqual(sqlite_rows(p,'SELECT value FROM ItemTable')[0][0],'rotated');db.close()
    def test_no_redirect_credential_forwarding(self):
        with self.assertRaises(model.ProviderError):NoRedirect().redirect_request(None,None,302,'',{},'https://evil.invalid')
    def test_no_remote_insecure_tls(self):
        with self.assertRaises(model.ProviderError):request_json('https://example.com',{},local=True)
    def test_grok_does_not_send_custom_issuer_token(self):
        p=Provider('grok','Grok','grok',self.home/'auth.json');atomic_json(p.path,{'https://auth.x.ai.evil.invalid::app':{'key':'secret'}})
        with patch('codenotch.providers.request_json',side_effect=AssertionError('token leaked')):
            with self.assertRaises(model.ProviderError):p.fetch(self.home,self.config,self.data)
    def test_glm_does_not_send_other_vendor_key(self):
        atomic_json(self.home/'.claude/settings.json',{'env':{'ANTHROPIC_BASE_URL':'https://example.com','ANTHROPIC_AUTH_TOKEN':'secret'}})
        self.assertIsNone(glm_key(self.home,self.config,self.data))
    def test_worker_disabled_transition_is_persisted(self):
        atomic_json(self.home/'.claude/.credentials.json',{'claudeAiOauth':{'accessToken':'never-output-this'}})
        args=argparse.Namespace(set=None,enable=None,disable='claude',demo=False,info=False,verify=None)
        with patch('codenotch.worker.locations',return_value=(self.home,self.config,self.data,self.root/'cache')):
            out=collect(args)
        claude=next(p for p in out['providers'] if p['id']=='claude')
        self.assertEqual(claude['status'],'disabled');self.assertNotIn('never-output-this',json.dumps(out))
        self.assertIn('claude',configuration(self.config)['disabled'])
    def test_success_snapshot_excludes_token(self):
        atomic_json(self.p.path/'.credentials.json',{'claudeAiOauth':{'accessToken':'borrowed-secret'}})
        with patch('codenotch.providers.request_json',return_value={'five_hour':{'utilization':42}}):
            out=update_provider(self.p,{},DEFAULTS,self.home,self.config,self.data,'claude')
        self.assertEqual(out['status'],'ok');self.assertEqual(out['windows'][0]['fraction'],.42)
        self.assertNotIn('borrowed-secret',json.dumps(out))
    def test_demo_does_not_read_credentials(self):
        with patch('codenotch.providers.read_json',side_effect=AssertionError('read credentials')):
            demo=demo_snapshot([self.p],DEFAULTS)
        self.assertEqual(demo['providers'][0]['status'],'demo')

if __name__=='__main__': unittest.main()
