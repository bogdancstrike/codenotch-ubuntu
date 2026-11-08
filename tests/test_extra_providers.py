import unittest
from unittest.mock import patch
from pathlib import Path
from codenotch.extra_providers import copilot, kimi
from codenotch.model import ProviderError
from codenotch.providers import Provider
from codenotch.worker import DEFAULTS, local_state

class ExtraProviders(unittest.TestCase):
    def test_copilot_ignores_unlimited_and_placeholder_pools(self):
        rows=copilot(dict(quota_snapshots=dict(premium_interactions=dict(percent_remaining=25,has_quota=True),chat=dict(unlimited=True,percent_remaining=0),completions=dict(has_quota=False,percent_remaining=0))),0)
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['fraction'],.75)
        self.assertNotIn('windowSeconds',rows[0])
    def test_kimi_usages_ratios_add_monthly_and_replace_counts(self):
        rows=kimi(dict(limits=[dict(window=dict(duration=300,timeUnit='TIME_UNIT_MINUTE'),detail=dict(limit='100',used='8'))],usage=dict(limit='100',used='2'),
                       usages=dict(limit_5h=dict(used_ratio=0.083,reset_time='2026-11-08T16:00:00Z'),limit_7d=dict(used_ratio='0.021'),
                                   limit_month_total=dict(used_ratio=0.4,reset_time='2026-12-01T00:00:00Z'),limit_month_code=dict(used_ratio=True))),0)
        self.assertEqual([r['id'] for r in rows],['rolling','weekly','monthly-total'])
        self.assertAlmostEqual(rows[0]['fraction'],.083);self.assertAlmostEqual(rows[1]['fraction'],.021)
        self.assertEqual(rows[2]['label'],'Monthly limit');self.assertIsNotNone(rows[2]['resetsAt'])
    def test_kimi_string_counts_and_reported_duration(self):
        rows=kimi(dict(limits=[dict(window=dict(duration=300,timeUnit='TIME_UNIT_MINUTE'),detail=dict(limit='100',remaining='75'))],usage=dict(limit='1000',used='200')),0)
        self.assertEqual(rows[0]['fraction'],.25);self.assertEqual(rows[0]['windowSeconds'],18000)
        self.assertNotIn('windowSeconds',rows[1])
    def test_missing_data_is_not_zero(self):
        for parser in (copilot,kimi):
            with self.assertRaises(ProviderError):parser({},0)
    def test_disabled_extra_does_not_detect(self):
        for kind in ('copilot','kimi'):
            with patch('codenotch.worker.detected',side_effect=AssertionError('credential read')):
                row,due=local_state(Provider(kind,kind,kind,Path('/tmp')),{},DEFAULTS,Path('/tmp'),Path('/tmp'),Path('/tmp'))
            self.assertFalse(due);self.assertEqual(row['status'],'disabled')
