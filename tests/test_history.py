from datetime import datetime, timedelta
import json
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch
from codenotch.history import parse_record, SCHEMA, put, summary, scan_file, collect, clean_prices, scan_opencode

class History(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.db=sqlite3.connect(':memory:');self.db.executescript(SCHEMA);self.addCleanup(self.db.close)
        self.now=time.time()
    def test_codex_cumulative_counters_are_differenced_and_cache_exclusive(self):
        state={}
        def record(inp,out,cache):
            return dict(type='event_msg',timestamp=self.now,payload=dict(type='token_count',info=dict(total_token_usage=dict(input_tokens=inp,output_tokens=out,cached_input_tokens=cache))))
        put(self.db,parse_record(record(100,20,40),'codex',state,'file',0))
        put(self.db,parse_record(record(100,20,40),'codex',state,'file',1))
        put(self.db,parse_record(record(150,30,60),'codex',state,'file',2))
        result=summary(self.db,{})
        self.assertEqual(result['tokens'],180);self.assertEqual(result['models'][0]['input'],90)
        self.assertEqual(result['models'][0]['cacheRead'],60)
        self.assertIsNone(result['estimatedCost'])
    def test_claude_repeated_streaming_message_is_upserted(self):
        for output in (10,20,15):
            row=dict(type='assistant',timestamp=self.now,message=dict(id='same',model='claude-test',usage=dict(input_tokens=100,output_tokens=output,cache_read_input_tokens=50)))
            put(self.db,parse_record(row,'claude',{},'file',0))
        result=summary(self.db,{'claude-test':dict(input=1,output=4,cacheRead=.1,cacheWrite=1)})
        self.assertEqual(result['tokens'],170);self.assertEqual(result['days'][0]['records'],1)
        self.assertAlmostEqual(result['estimatedCost'],.000185)
    def test_incremental_scan_and_partial_final_line(self):
        path=self.root/'usage.jsonl'
        row=dict(schemaVersion=1,id='1',source='kimi',model='test',timestamp=self.now,tokens=dict(input=10,output=2))
        path.write_text(json.dumps(row)+'\n'+json.dumps({**row,'id':'2'}))
        first,_=scan_file(self.db,path,'import',time.monotonic()+1,100000)
        self.assertGreater(first,0);self.assertEqual(summary(self.db,{})['tokens'],12)
        with path.open('a') as stream:stream.write('\n')
        scan_file(self.db,path,'import',time.monotonic()+1,100000)
        self.assertEqual(summary(self.db,{})['tokens'],24)
        self.assertEqual(scan_file(self.db,path,'import',time.monotonic()+1,100000),(0,False))
    def test_disabled_history_does_not_scan_or_create_database(self):
        with patch('codenotch.history.paths',side_effect=AssertionError('scanned')):
            result=collect(self.root,[],self.root,{},lambda p:True)
        self.assertFalse(result['enabled']);self.assertFalse((self.root/'history.sqlite').exists())
    def test_import_requires_real_counters(self):
        self.assertIsNone(parse_record(dict(schemaVersion=1,id='1',source='test',timestamp=self.now,tokens=dict(output=1)),'import',{},'',0))
        self.assertEqual(clean_prices({'bad':dict(input=1),'good':dict(input=1,output=2,cacheRead=0,cacheWrite=0)}),{'good':dict(input=1,output=2,cacheRead=0,cacheWrite=0)})
    def test_opencode_incremental_completed_messages(self):
        path=self.root/'opencode.db'
        with sqlite3.connect(path) as source:
            source.executescript('CREATE TABLE session(id TEXT,directory TEXT); CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);')
            source.execute('INSERT INTO session VALUES (?,?)',('s','/project'))
            row=dict(role='assistant',modelID='model',time=dict(created=self.now*1000,completed=self.now*1000),tokens=dict(input=100,output=10,reasoning=5,cache=dict(read=50,write=0)))
            source.execute('INSERT INTO message VALUES (?,?,?,?,?)',('m','s',self.now*1000,self.now*1000,json.dumps(row)))
        self.assertFalse(scan_opencode(self.db,path,time.monotonic()+2))
        self.assertEqual(summary(self.db,{})['tokens'],165)
        scan_opencode(self.db,path,time.monotonic()+2)
        self.assertEqual(summary(self.db,{})['tokens'],165)

    def test_dashboard_buckets_reconcile_sources_models_hours_and_prices(self):
        today=datetime.now().replace(hour=10,minute=0,second=0,microsecond=0)
        samples=[('claude','priced',today,100,20,50,10),
                 ('codex','priced',today.replace(hour=14),200,40,60,0),
                 ('claude','unknown',today-timedelta(days=1),30,5,0,0),
                 ('codex','free',today,0,0,0,0)]
        for i,(source,model,at,*counts) in enumerate(samples):
            self.db.execute('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)',
                            (str(i),source,model,'private/project',at.timestamp(),*counts))
        rates={'priced':dict(input=1,output=4,cacheRead=.1,cacheWrite=2),
               'free':dict(input=0,output=0,cacheRead=0,cacheWrite=0)}
        result=summary(self.db,rates,now=today.timestamp())
        buckets=result['breakdown']
        self.assertEqual(sum(b['tokens'] for b in buckets),result['tokens'])
        self.assertEqual(sum(b['records'] for b in buckets),4)
        self.assertEqual(sum(sum(b['hours']) for b in buckets),result['tokens'])
        self.assertAlmostEqual(sum(b['estimatedCost'] for b in buckets),result['estimatedCost'])
        self.assertEqual(sum(b['unpricedTokens'] for b in buckets),35)
        self.assertEqual(next(b for b in buckets if b['model']=='free')['pricedRecords'],1)
        self.assertEqual(next(b for b in buckets if b['model']=='unknown')['pricedRecords'],0)
        self.assertNotIn('private/project',json.dumps(buckets))
        filtered=summary(self.db,rates,now=today.timestamp(),excluded=('claude',))
        self.assertEqual({b['source'] for b in filtered['breakdown']},{'codex'})
        self.assertEqual(sum(b['tokens'] for b in filtered['breakdown']),300)

    def test_dashboard_range_uses_local_calendar_boundaries(self):
        today=datetime.now().replace(hour=12,minute=0,second=0,microsecond=0)
        for i,age in enumerate((0,6,7,-1)):
            self.db.execute('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)',
                            (str(i),'claude','test','', (today-timedelta(days=age)).timestamp(),10,0,0,0))
        result=summary(self.db,{},days=7,now=today.timestamp())
        self.assertEqual(result['tokens'],20)
        self.assertEqual(len(result['breakdown']),2)
        self.assertTrue(all(b['hours'][12]==10 for b in result['breakdown']))

    def test_explicit_zero_prices_and_zero_tokens_are_not_unpriced(self):
        self.db.execute('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)',
                        ('zero','claude','free','',self.now,0,0,0,0))
        result=summary(self.db,{'free':dict(input=0,output=0,cacheRead=0,cacheWrite=0)})
        self.assertEqual(result['estimatedCost'],0)
        self.assertEqual(result['pricedRecords'],1)
        self.assertEqual(result['breakdown'][0]['pricedRecords'],1)
