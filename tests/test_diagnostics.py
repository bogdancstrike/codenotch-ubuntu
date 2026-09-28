import json
import unittest
from codenotch.diagnostics import report

class Diagnostics(unittest.TestCase):
    def test_allowlist_does_not_leak_paths_labels_or_unknown_messages(self):
        row=dict(kind='codex',id='private-account',name='Secret team',source='/home/private/auth.json',message='token-value',sessions=[dict(name='private-project')],attempts=[dict(route='https://secret',state='token-value',message='secret')])
        output=json.dumps(report([row],100))
        for secret in ('private','Secret','token-value','https://secret'):
            self.assertNotIn(secret,output)
        self.assertIn('endpoint',output)
