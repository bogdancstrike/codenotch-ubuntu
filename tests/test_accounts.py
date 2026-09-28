import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from codenotch.accounts import profiles, labels
from codenotch.providers import discover

class Accounts(unittest.TestCase):
    def test_profile_config_validation(self):
        self.assertEqual(profiles([dict(id='../bad',kind='codex',path='/tmp')]),[])
        self.assertEqual(profiles([dict(id='work',kind='codex',path='relative')]),[])
        self.assertEqual(labels({'codex':' Work ','grok':42}),{'codex':'Work'})
    def test_discover_does_not_read_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory)
            for name in ('.codex-work','.grok-work'):
                (home/name).mkdir();(home/name/'auth.json').write_text('not readable as JSON')
            settings=dict(accountLabels={'codex:.codex-work':'Work'},accountProfiles=[dict(id='extra',kind='codex',path=str(home/'extra'),name='Extra')])
            with patch('codenotch.providers.read_json',side_effect=AssertionError('read credential')):
                rows=discover(home,home/'.config',home/'.local/share',settings)
            self.assertEqual(next(p.name for p in rows if p.id=='codex:.codex-work'),'Work')
            self.assertTrue(any(p.id=='profile:extra' for p in rows))
