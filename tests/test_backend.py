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
from codenotch import widgets
from codenotch.providers import Provider, discover, sqlite_rows, request_json, NoRedirect, glm_key, claude_profile, antigravity_signed_in
from codenotch.worker import DEFAULTS, Lock, atomic_json, configuration, update_provider, local_state, demo_snapshot, collect

def namespace(**overrides):
    base=dict(set=None,enable=None,disable=None,demo=False,info=False,verify=None,search=None,widgets=False,location=None,snapshot=True)
    return argparse.Namespace(**{**base,**overrides})

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
        for name in ('.claude-work','.claude-alpha'):
            (self.home/name).mkdir();atomic_json(self.home/name/'settings.json',{})
        self.assertEqual([p.id for p in discover(self.home,self.config,self.data)][:3],['claude','claude:.claude-alpha','claude:.claude-work'])
    def test_unrelated_dotclaude_directory_is_not_a_profile(self):
        (self.home/'.claude-flow').mkdir();(self.home/'.claude-flow'/'neural').mkdir()
        self.assertFalse(claude_profile(self.home/'.claude-flow'))
        self.assertNotIn('claude:.claude-flow',[p.id for p in discover(self.home,self.config,self.data)])
    def test_antigravity_cli_counts_as_signed_in(self):
        self.assertFalse(antigravity_signed_in(self.home,self.config))
        cli=self.home/'.gemini/antigravity-cli'; cli.mkdir(parents=True)
        self.assertFalse(antigravity_signed_in(self.home,self.config))  # installed but never run
        (cli/'cache').mkdir()
        self.assertTrue(antigravity_signed_in(self.home,self.config))
    def test_detection_never_touches_the_keyring(self):
        # A gi import plus a DBus round trip on every snapshot would dwarf the
        # cost of the rest of the run.
        (self.home/'.gemini/antigravity-cli/cache').mkdir(parents=True)
        with patch('codenotch.providers.keyring_token',side_effect=AssertionError('keyring read during detection')):
            self.assertTrue(antigravity_signed_in(self.home,self.config))
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
        args=namespace(disable='claude')
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
            demo=demo_snapshot([self.p],DEFAULTS,self.root/'cache')
        self.assertEqual(demo['providers'][0]['status'],'demo')

    def test_location_is_written_in_one_piece(self):
        # Writing lat and lon separately could never complete a location: the
        # validator drops a half-set pair, so the second write read back nulls.
        from codenotch.worker import apply_settings
        root=self.root/'cache'/'codenotch'
        place={'label':'Bucharest, Romania','latitude':44.4323,'longitude':26.1063}
        out=apply_settings(namespace(location=json.dumps(place)),self.config,root)
        self.assertEqual((out['weatherPlace'],out['weatherLat'],out['weatherLon']),
                         ('Bucharest, Romania',44.4323,26.1063))
        self.assertEqual(configuration(self.config)['weatherLat'],44.4323)   # survives a re-read
        cleared=apply_settings(namespace(location='{}'),self.config,root)
        self.assertEqual((cleared['weatherPlace'],cleared['weatherLat'],cleared['weatherLon']),('',None,None))
    def test_coordinates_cannot_be_set_one_at_a_time(self):
        from codenotch.worker import apply_settings
        with self.assertRaises(ValueError):
            apply_settings(namespace(set=['weatherLat','44.4']),self.config,self.root/'cache'/'codenotch')
    def test_half_a_location_names_nothing(self):
        atomic_json(self.config/'codenotch/settings.json',{'weatherPlace':'Bucharest','weatherLat':44.4})
        out=configuration(self.config)
        self.assertEqual((out['weatherPlace'],out['weatherLat'],out['weatherLon']),('',None,None))
    def test_new_settings_are_validated(self):
        atomic_json(self.config/'codenotch/settings.json',
                    {'widgets':['clock','nope','clock'],'pollSeconds':2,'weatherLat':'x','weatherLon':4.0,'textContrast':'neon','dateStyle':'huge'})
        out=configuration(self.config)
        self.assertEqual(out['widgets'],['clock'])
        self.assertEqual(out['pollSeconds'],DEFAULTS['pollSeconds'])
        self.assertIsNone(out['weatherLat']);self.assertIsNone(out['weatherLon'])
        self.assertEqual(out['textContrast'],'high');self.assertEqual(out['dateStyle'],'medium')
    def test_idle_poll_never_faster_than_active_poll(self):
        atomic_json(self.config/'codenotch/settings.json',{'pollSeconds':600,'idlePollSeconds':60})
        self.assertEqual(configuration(self.config)['idlePollSeconds'],600)
    def test_settings_write_does_not_wait_for_a_running_poll(self):
        cache=self.root/'cache'/'codenotch'
        with Lock(cache/'poll.lock') as held:
            self.assertTrue(held.held)
            with Lock(cache/'poll.lock',blocking=False) as second:
                self.assertFalse(second.held)   # a second poll declines instead of queueing
            with Lock(cache/'settings.lock') as settings:
                self.assertTrue(settings.held)  # settings use their own lock and never wait
    def test_local_state_never_asks_for_a_fetch_before_the_deadline(self):
        old={'status':'ok','nextPoll':time.time()+300,'windows':[{'fraction':.5}]}
        with patch('codenotch.worker.detected',return_value=True),patch('codenotch.worker.sessions',return_value=[]):
            row,needs=local_state(self.p,old,DEFAULTS,self.home,self.config,self.data)
        self.assertFalse(needs);self.assertEqual(row['windows'],old['windows'])
        with patch('codenotch.worker.detected',return_value=True),patch('codenotch.worker.sessions',return_value=[]):
            _,forced=local_state(self.p,old,DEFAULTS,self.home,self.config,self.data,'all')
        self.assertTrue(forced)
    def test_idle_snapshot_creates_no_thread_pool(self):
        # The pool costs an import and eight threads every few seconds; an idle
        # run must not pay for it.
        cache=self.root/'cache'
        atomic_json(self.home/'.claude/.credentials.json',{'claudeAiOauth':{'accessToken':'x'}})
        atomic_json(cache/'codenotch'/'usage.json',{'providers':[
            {'id':p.id,'status':'ok','windows':[],'nextPoll':time.time()+900} for p in discover(self.home,self.config,self.data)]})
        import concurrent.futures
        with patch('codenotch.worker.locations',return_value=(self.home,self.config,self.data,cache)), \
             patch.object(concurrent.futures,'ThreadPoolExecutor',side_effect=AssertionError('pool created while idle')):
            out=collect(namespace())
        self.assertTrue(out['providers'])
    def test_snapshot_falls_back_to_cache_while_another_poll_runs(self):
        cache=self.root/'cache'
        atomic_json(self.home/'.claude/.credentials.json',{'claudeAiOauth':{'accessToken':'x'}})
        with patch('codenotch.worker.locations',return_value=(self.home,self.config,self.data,cache)):
            with Lock(cache/'codenotch'/'poll.lock'):
                with patch.object(Provider,'fetch',side_effect=AssertionError('polled while busy')):
                    out=collect(namespace())
        self.assertTrue(out['busy'])

class Widgets(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def test_weather_is_cached_between_calls(self):
        settings={**DEFAULTS,'weatherLat':44.4,'weatherLon':26.1}
        cache={'weather':{'temp':21,'updatedAt':time.time(),'key':'44.4,26.1,metric'}}
        with patch('codenotch.widgets.fetch_weather',side_effect=AssertionError('refetched inside the window')):
            self.assertEqual(widgets.weather(settings,cache)['temp'],21)
    def test_weather_refetches_when_the_place_changes(self):
        settings={**DEFAULTS,'weatherLat':1.0,'weatherLon':2.0}
        cache={'weather':{'temp':21,'updatedAt':time.time(),'key':'44.4,26.1,metric'}}
        with patch('codenotch.widgets.fetch_weather',return_value={'temp':30}):
            self.assertEqual(widgets.weather(settings,cache)['temp'],30)
    def test_weather_keeps_the_last_reading_when_offline(self):
        settings={**DEFAULTS,'weatherLat':44.4,'weatherLon':26.1}
        cache={'weather':{'temp':21,'updatedAt':0,'key':'44.4,26.1,metric'}}
        with patch('codenotch.widgets.fetch_weather',side_effect=model.ProviderError('offline','no network')):
            out=widgets.weather(settings,cache)
        self.assertEqual(out['temp'],21);self.assertEqual(out['status'],'stale')
    def test_weather_needs_a_location(self):
        with self.assertRaises(model.ProviderError):widgets.fetch_weather({**DEFAULTS})
    def test_device_batteries_are_ignored(self):
        mouse=self.root/'hidpp_battery_0';mouse.mkdir()
        (mouse/'type').write_text('Battery\n');(mouse/'scope').write_text('Device\n');(mouse/'capacity').write_text('55\n')
        self.assertIsNone(widgets.battery(self.root))
        system=self.root/'BAT0';system.mkdir()
        (system/'type').write_text('Battery\n');(system/'capacity').write_text('76\n');(system/'status').write_text('Charging\n')
        self.assertEqual(widgets.battery(self.root),{'percent':76,'charging':True,'state':'Charging','name':'BAT0'})
    def test_cpu_needs_two_samples_and_never_invents_a_value(self):
        proc=self.root;(proc/'stat').write_text('cpu 100 0 100 800 0 0 0 0 0 0\n')
        (proc/'meminfo').write_text('MemTotal: 16000000 kB\nMemFree: 2000000 kB\nMemAvailable: 8000000 kB\n')
        cache={}
        first=widgets.system(cache,proc)
        self.assertNotIn('cpu',first);self.assertAlmostEqual(first['mem'],.5)
        (proc/'stat').write_text('cpu 200 0 200 900 0 0 0 0 0 0\n')
        second=widgets.system(cache,proc)
        self.assertAlmostEqual(second['cpu'],1-100/300)
    def test_search_ignores_short_queries(self):
        with patch('codenotch.widgets.request_json',side_effect=AssertionError('searched')):
            self.assertEqual(widgets.search_places('a'),[])
    def test_search_drops_rows_without_coordinates(self):
        payload={'results':[{'name':'Nowhere'},{'name':'Cluj','admin1':'Cluj','country':'Romania','latitude':46.77,'longitude':23.6}]}
        with patch('codenotch.widgets.request_json',return_value=payload):
            out=widgets.search_places('cluj')
        self.assertEqual([r['name'] for r in out],['Cluj'])
        self.assertEqual(out[0]['label'],'Cluj, Cluj, Romania')
    def test_needs_network_matches_the_cache_state(self):
        settings={**DEFAULTS,'widgets':['weather'],'weatherLat':1.0,'weatherLon':2.0}
        fresh={'weather':{'updatedAt':time.time(),'key':'1.0,2.0,metric'}}
        self.assertFalse(widgets.needs_network(settings,fresh))
        self.assertTrue(widgets.needs_network(settings,fresh,force=True))
        self.assertTrue(widgets.needs_network(settings,{'weather':{'updatedAt':0,'key':'1.0,2.0,metric'}}))
        self.assertTrue(widgets.needs_network(settings,{'weather':{'updatedAt':time.time(),'key':'9,9,metric'}}))
        self.assertFalse(widgets.needs_network({**DEFAULTS,'widgets':['clock']},{}))
    def test_collect_reuses_the_cache_it_writes(self):
        # The reading has to land where weather() looks for it, or every poll
        # becomes a fresh request and one failure blanks the widget.
        settings={**DEFAULTS,'widgets':['weather'],'weatherLat':44.4,'weatherLon':26.1}
        cache={}
        reading=dict(temp=21,unit='C',symbol='sun',updatedAt=time.time())
        with patch('codenotch.widgets.fetch_weather',return_value=reading):
            first=widgets.collect(settings,cache)
        self.assertEqual(first['weather']['temp'],21)
        self.assertFalse(widgets.needs_network(settings,cache))
        with patch('codenotch.widgets.fetch_weather',side_effect=AssertionError('refetched within the window')):
            second=widgets.collect(settings,cache)
        self.assertEqual(second['weather']['temp'],21)
    def test_collect_only_gathers_enabled_widgets(self):
        with patch('codenotch.widgets.weather',side_effect=AssertionError('weather not requested')):
            self.assertEqual(widgets.collect({**DEFAULTS,'widgets':['clock','date']},{}),{})

if __name__=='__main__': unittest.main()
