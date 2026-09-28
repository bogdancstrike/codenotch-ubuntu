import json
import tempfile
import unittest
from pathlib import Path
from codenotch.custom import CustomProvider, parse, run
from codenotch.model import ProviderError

class Custom(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
    def program(self,script):
        path=self.root/'run';path.write_text('#!/usr/bin/python3\n'+script);path.chmod(0o700);return path
    def test_valid_program_and_minimal_environment(self):
        path=self.program('import json,os\nprint(json.dumps({"schemaVersion":1,"limits":[{"label":"Monthly","used":25,"limit":100}],"env":list(os.environ)}))')
        output=run(path,self.root,2,'test')
        self.assertEqual(parse(output)[0]['fraction'],.25)
        self.assertNotIn('SSH_AUTH_SOCK',output['env'])
    def test_timeout_and_output_cap(self):
        for script in ('import time\ntime.sleep(10)','print("x"*300000)'):
            with self.assertRaises(ProviderError): run(self.program(script),self.root,.1,'test')
    def test_manifest_cannot_escape_folder(self):
        p=CustomProvider(self.root,dict(schemaVersion=1,id='test',executable='/bin/echo'))
        self.assertIsNotNone(p.problem)
    def test_invalid_schema_and_missing_counters(self):
        for data in ({'schemaVersion':2},{'schemaVersion':1,'limits':[{'label':'Missing'}]}):
            with self.assertRaises(ProviderError): parse(data)
