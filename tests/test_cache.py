import unittest
from codenotch.cache import current

class Cache(unittest.TestCase):
    def test_partial_expiry_preserves_retry(self):
        row=dict(updatedAt=100,windows=[dict(resetsAt=150),dict(resetsAt=300)],retryAt=400)
        result=current(row,200)
        self.assertEqual(result['windows'],[dict(resetsAt=300)])
        self.assertEqual(result['retryAt'],400)
        self.assertEqual(len(row['windows']),2)
    def test_undated_old_and_future_readings_expire(self):
        for stamp in (None,0,200000):
            result=current(dict(updatedAt=stamp,windows=[dict(resetsAt=None)]),100000)
            self.assertEqual(result['windows'],[])
            self.assertEqual(result['status'],'stale')
    def test_fresh_unknown_reset_is_kept(self):
        row=dict(updatedAt=100,windows=[dict(resetsAt=None)])
        self.assertEqual(current(row,200),row)
