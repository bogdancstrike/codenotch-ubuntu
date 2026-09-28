import json
import tempfile
import unittest
from pathlib import Path
from codenotch.turns import codex_turn, tail_records

class Turns(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'rollout.jsonl'
    def write(self,events):
        self.path.write_text(''.join(json.dumps(dict(timestamp=stamp,type=typ,payload=dict(type=kind)))+'\n' for stamp,typ,kind in events))
    def test_slow_tool_survives_eight_seconds(self):
        self.write([(100,'event_msg','task_started'),(110,'response_item','function_call')])
        self.assertEqual(codex_turn(self.path,800)['state'],'busy')
        self.assertIsNone(codex_turn(self.path,2000))
    def test_completed_or_interrupted_turn_stops_immediately(self):
        for kind in ('task_complete','turn_aborted'):
            self.write([(100,'event_msg','task_started'),(110,'event_msg',kind)])
            self.assertIsNone(codex_turn(self.path,111))
    def test_partial_and_unrelated_records_are_ignored(self):
        self.path.write_text('{bad}\n{"type":"session_meta"}\n{"unfinished":')
        self.assertIsNone(codex_turn(self.path,100))
        self.assertEqual(len(list(tail_records(self.path))),1)
    def test_no_unbounded_read(self):
        self.path.write_bytes(b'x'*200000+b'\n'+json.dumps(dict(timestamp=100,type='event_msg',payload=dict(type='task_started'))).encode()+b'\n')
        self.assertIsNotNone(codex_turn(self.path,101))
