"""Expiry applies equally to cached CLI output and worker polling."""
from .model import number

MAX_AGE=86400

def current(row, now):
    result=dict(row)
    windows=row.get('windows',[])
    if not windows:
        return result
    stamp=number(row.get('updatedAt'))
    valid=stamp is not None and 0 <= now-stamp <= MAX_AGE
    kept=[w for w in windows if not w.get('resetsAt') or w['resetsAt'] > now] if valid else []
    if len(kept) != len(windows):
        result['windows']=kept
        if not kept:
            result['status']='stale'
            result['message']='Awaiting fresh reading — the previous quota windows expired.'
        result['cacheExpired']=True
    return result
