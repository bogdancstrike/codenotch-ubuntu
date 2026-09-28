"""Opt-in adapters. Credentials are borrowed only from the named client files."""
from urllib.parse import urlparse
from .model import number, window, require, duration_label


def count(value):
    if isinstance(value,str):
        try: value=float(value)
        except ValueError: return None
    return number(value)


def copilot(data, now):
    out=[];snapshots=data.get('quota_snapshots') or {}
    reset=data.get('quota_reset_date_utc') or data.get('quota_reset_date')
    for key,label in [('premium_interactions','Premium requests'),('chat','Chat'),('completions','Completions')]:
        row=snapshots.get(key)
        if not isinstance(row,dict) or row.get('unlimited') or row.get('has_quota') is False: continue
        remaining=count(row.get('percent_remaining'))
        if remaining is None or not 0 <= remaining <= 100: continue
        if row.get('has_quota') is None and (count(row.get('entitlement')) or 0)<=0 and remaining==100: continue
        w=window(key,label,100-remaining,reset)
        if row.get('overage_permitted'): w['overageAllowed']=True
        out.append(w)
    return require(out)


def kimi(data, now):
    out=[]
    units={'TIME_UNIT_SECOND':1,'TIME_UNIT_MINUTE':60,'TIME_UNIT_HOUR':3600,'TIME_UNIT_DAY':86400}
    def add(key,label,row,duration=None):
        if not isinstance(row,dict): return
        limit=count(row.get('limit'));used=count(row.get('used'));remaining=count(row.get('remaining'))
        if limit is None or limit<=0: return
        if used is None and remaining is not None: used=limit-remaining
        if used is None or used<0: return
        out.append(window(key,label,used/limit*100,row.get('resetTime'),duration))
    for index,row in enumerate(data.get('limits') or []):
        timing=row.get('window') or {};duration=count(timing.get('duration'));unit=units.get(timing.get('timeUnit'))
        if duration is None or duration<=0 or unit is None: continue
        seconds=duration*unit
        add(f'limit.{index}.{int(seconds)}',duration_label(seconds,'Usage'),row.get('detail'),seconds)
    add('weekly','Weekly allowance',data.get('usage'))
    return require(out)


def copilot_token(config):
    from .providers import read_json, secret
    for name in ('hosts.json','apps.json'):
        for host,row in read_json(config/'github-copilot'/name).items():
            if host!='github.com' and not host.startswith('github.com:'): continue
            if isinstance(row,dict):
                token=secret(row.get('oauth_token'))
                if token: return token
    return None


def kimi_token(home,data):
    from .providers import read_json, pick_key, secret
    import tomllib
    try:
        with (home/'.kimi/config.toml').open('rb') as stream:
            raw=stream.read(1024*1024)
        config=tomllib.loads(raw.decode())
        for row in (config.get('providers') or {}).values():
            if not isinstance(row,dict): continue
            if urlparse(str(row.get('base_url',''))).hostname=='api.kimi.com':
                key=secret(row.get('api_key'))
                if key: return key
    except (OSError,ValueError,UnicodeError): pass
    auth=read_json(data/'opencode/auth.json')
    return pick_key(auth.get('kimi-for-coding')) or pick_key(auth.get('kimi-code'))
