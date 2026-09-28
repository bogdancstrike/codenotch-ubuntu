"""Shareable reports use a fixed allowlist, never a dump of local state."""
from . import __version__

STATES={'ok','stale','error','offline','needsAuth','expired','forbidden','unavailable','unmetered','rateLimited','disabled','notChecked'}
ROUTES={'endpoint','antigravity-local','antigravity-cli','antigravity-cloud','extension'}

def report(rows, now):
    def state(value): return value if value in STATES else 'error'
    return dict(version=__version__,generatedAt=now,connections=[dict(
        provider=r.get('kind','unknown'),enabled=bool(r.get('enabled')),
        displayState=state(r.get('status','notChecked')),
        checkedAt=r.get('checkedAt'),lastSuccessAt=r.get('updatedAt'),
        nextPoll=r.get('nextPoll'),retryAt=r.get('retryAt'),failures=r.get('failures',0),
        usesCache=r.get('status')=='stale',
        attempts=[dict(route=a['route'] if a.get('route') in ROUTES else 'endpoint',state=state(a.get('state')))
                  for a in r.get('attempts',[])[:10]]
    ) for r in rows])
