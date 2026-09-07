"""Wire models and defensive parsers. No credentials enter these models."""
import math
from datetime import datetime, timezone

class ProviderError(Exception):
    def __init__(self, status, message, retry=0):
        super().__init__(message)
        self.status, self.message, self.retry = status, message, retry

def number(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None

def timestamp(value):
    n = number(value)
    if n is not None:
        return n / 1000 if n > 1e11 else n
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return dt.replace(tzinfo=dt.tzinfo or timezone.utc).timestamp()
        except (ValueError, OverflowError):
            pass
    return None

def window(id, label, percent, reset=None):
    n = number(percent)
    if n is None or n < 0:
        raise ProviderError('error', 'The provider returned an invalid usage percentage.')
    return dict(id=id, label=label, fraction=n / 100, resetsAt=timestamp(reset))

def require(windows):
    if not windows:
        raise ProviderError('unmetered', 'This account reports no usage windows.')
    return windows

def claude(data, now):
    labels = {'session': 'Current session', 'weekly_all': 'All models', 'weekly_opus': 'Opus', 'weekly_sonnet': 'Sonnet'}
    out = {}
    for row in data.get('limits') or []:
        if isinstance(row, dict) and row.get('resets_at') and number(row.get('percent')) is not None:
            key = str(row.get('kind', 'usage'))
            out[key] = window(key, labels.get(key, key.replace('_', ' ').title()), row['percent'], row['resets_at'])
    for key, field in [('session','five_hour'),('weekly_all','seven_day'),('weekly_opus','seven_day_opus'),('weekly_sonnet','seven_day_sonnet')]:
        row = data.get(field)
        if key not in out and isinstance(row,dict) and number(row.get('utilization')) is not None:
            out[key] = window(key, labels[key], row['utilization'], row.get('resets_at'))
    return require(sorted(out.values(), key=lambda w: (0 if w['id']=='session' else 1 if w['id']=='weekly_all' else 2, w['id'])))

def duration_label(seconds, fallback):
    n = number(seconds)
    if n is None or n <= 0: return fallback
    if n < 3600: return f'{int(n/60)}m limit'
    if n < 86400: return f'{int(n/3600)}h limit'
    d = round(n/86400)
    return {7:'Weekly limit',30:'Monthly limit'}.get(d, f'{d}d limit')

def codex(data, now):
    out=[]
    limits=data.get('rate_limit') or {}
    for key, fallback in [('primary','Current session'),('secondary','Longer window')]:
        row=limits.get(key+'_window')
        if not isinstance(row, dict): continue
        reset=timestamp(row.get('reset_at'))
        if reset is None and number(row.get('reset_after_seconds')) is not None:
            reset=now+row['reset_after_seconds']
        out.append(window(key,duration_label(row.get('limit_window_seconds'),fallback),row.get('used_percent'),reset))
    return require(out)

def cursor(data, now):
    usage=data.get('individualUsage') or {}; plan=usage.get('plan') or {}; out=[]
    for field,key,label in [('totalPercentUsed','included','Included usage'),('apiPercentUsed','api','API usage')]:
        n=number(plan.get(field))
        if n is not None and (key=='included' or n>0): out.append(window(key,label,n,data.get('billingCycleEnd')))
    demand=usage.get('onDemand') or {}
    if demand.get('enabled') and (number(demand.get('limit')) or 0)>0 and number(demand.get('used')) is not None:
        out.append(window('on_demand','On demand',100*demand['used']/demand['limit'],data.get('billingCycleEnd')))
    return require(out)

def glm(data, now):
    code=data.get('code')
    if data.get('success') is False or code not in (None,200):
        status='needsAuth' if code in (401,403) else 'rateLimited' if code==429 else 'error'
        raise ProviderError(status,'Z.ai rejected the usage request.')
    out=[]
    for row in (data.get('data') or {}).get('limits') or []:
        if number(row.get('percentage')) is None: continue
        key,label=('mcp','MCP (1 month)') if row.get('type')=='TIME_LIMIT' else { (3,5):('session','Current session'), (6,1):('weekly','Weekly') }.get((row.get('unit'),row.get('number')),('usage','Usage'))
        out.append(window(key,label,row['percentage'],row.get('nextResetTime')))
    return require(sorted(out,key=lambda w:{'session':0,'weekly':1,'mcp':2}.get(w['id'],3)))

def grok(data, now):
    cfg=data.get('config') or {}; reset=(cfg.get('currentPeriod') or {}).get('end') or cfg.get('billingPeriodEnd')
    if number(cfg.get('creditUsagePercent')) is not None:
        return [window('credits','Grok Build',cfg['creditUsagePercent'],reset)]
    return require([window('credits' if i==0 else str(i),r.get('product','Usage').replace('GrokBuild','Grok Build'),r['usagePercent'],reset) for i,r in enumerate(cfg.get('productUsage') or []) if number(r.get('usagePercent')) is not None])

def opencode(data, now):
    usage=data.get('usage') or {}; out=[]
    for key,label in [('rolling','5h limit'),('weekly','Weekly limit'),('monthly','Monthly limit')]:
        row=usage.get(key) or {}
        if number(row.get('percent')) is not None: out.append(window(key,label,row['percent'],row.get('resetsAt')))
    return require(out)

def antigravity(data, now):
    out=[]
    for group in (data.get('response') or {}).get('groups') or []:
        for row in group.get('buckets') or []:
            n=number(row.get('remainingFraction'))
            if n is not None and 0<=n<=1:
                out.append(window(row.get('bucketId','quota'),group.get('displayName') or row.get('displayName','Usage'),100*(1-n),row.get('resetTime')))
    return require(out)

PARSERS = dict(claude=claude,codex=codex,cursor=cursor,glm=glm,grok=grok,opencode=opencode,gemini=antigravity)
