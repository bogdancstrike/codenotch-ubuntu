import unittest
from codenotch.alerts import evaluate

class Alerts(unittest.TestCase):
    def row(self, fraction=.95, reset=2000, status='ok'):
        return dict(id='codex',name='Codex',enabled=True,status=status,updatedAt=1000,windows=[dict(id='week',label='Weekly',fraction=fraction,resetsAt=reset)])
    def test_dedup_reset_and_stale(self):
        settings=dict(notifyQuota=True,notifyReset=True)
        memory=evaluate([self.row()],settings,{},1000)
        self.assertEqual(len(memory['pending']),1)
        memory['pending']=[]
        for fraction in (.89,.93,.95):
            memory=evaluate([self.row(fraction)],settings,memory,1001)
            self.assertEqual(memory['pending'],[])
        memory=evaluate([self.row(.01,3000,'stale')],settings,memory,1002)
        self.assertEqual(memory['pending'],[])
        memory=evaluate([self.row(.01,3000)],settings,memory,1002)
        self.assertEqual(len(memory['pending']),1)
        self.assertIn('available',memory['pending'][0]['message'])
    def test_disabled_and_expired_never_warn(self):
        self.assertEqual(evaluate([self.row()],{}, {},1000)['pending'],[])
        self.assertEqual(evaluate([self.row(reset=900)],dict(notifyQuota=True),{},1000)['pending'],[])
    def test_outage_once_until_recovery(self):
        row={**self.row(status='stale'),'failures':3}
        settings=dict(notifyFailures=True)
        memory=evaluate([row],settings,{},1000)
        self.assertEqual(len(memory['pending']),1)
        memory['pending']=[]
        self.assertEqual(evaluate([row],settings,memory,1001)['pending'],[])
