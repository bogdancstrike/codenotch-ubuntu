"""Local model runtimes: Ollama and LM Studio.

Neither has an allowance, so neither reports usage windows. What they report is
which models are loaded right now, read from each server's own listing on the
loopback interface. Nothing is loaded, unloaded or generated from here, and
nothing about a prompt is read: LM Studio's speed comes from the timing line
its own server log already writes.
"""
import json
import os
import re
import shutil
import time
from pathlib import Path
from .model import ProviderError, timestamp

KINDS=('ollama','lmstudio')
CADENCE=20          # loaded models change by the minute; a loopback read is cheap
LOG_TAIL=262144
ACTIVE_LOG=12       # seconds: a log written this recently means a generation is running
MAX_BYTES=1048576

# ----------------------------------------------------------------- endpoints
def ollama_base():
    """OLLAMA_HOST may name another port; any host other than loopback is refused."""
    raw=os.environ.get('OLLAMA_HOST','').strip()
    port=11434
    if raw:
        host,_,tail=raw.removeprefix('http://').partition(':')
        if host not in ('','127.0.0.1','localhost','0.0.0.0'): return None
        if tail.split('/')[0].isdigit(): port=int(tail.split('/')[0])
    return f'http://127.0.0.1:{port}'

def lmstudio_base(home):
    port=1234
    try:
        with (Path(home)/'.lmstudio/.internal/http-server-config.json').open('rb') as f:
            value=json.loads(f.read(65536)).get('port')
        if isinstance(value,int) and 0<value<65536: port=value
    except (OSError,ValueError,AttributeError): pass
    return f'http://127.0.0.1:{port}'

def installed(kind,home):
    home=Path(home)
    if kind=='ollama':
        return bool(shutil.which('ollama') or Path('/usr/local/bin/ollama').exists() or (home/'.ollama/models').is_dir())
    if kind=='lmstudio':
        return (home/'.lmstudio').is_dir()
    return False

def loopback_json(url,name):
    """Plain HTTP to 127.0.0.1 only: no proxy, no redirects, small and quick."""
    import urllib.error, urllib.parse, urllib.request
    from .providers import no_redirect
    if urllib.parse.urlparse(url).hostname!='127.0.0.1': raise ProviderError('error','Local runtimes are read on loopback only.')
    opener=urllib.request.build_opener(no_redirect()(),urllib.request.ProxyHandler({}))
    request=urllib.request.Request(url,headers={'Accept':'application/json','User-Agent':'Codenotch-Ubuntu/0.2'})
    try:
        with opener.open(request,timeout=2) as response:
            raw=response.read(MAX_BYTES+1)
    except urllib.error.HTTPError as err:
        if err.code in (401,403): raise ProviderError('needsAuth',f'{name}’s server requires an API token, which Codenotch does not send.')
        if err.code==404: raise ProviderError('unavailable',f'{name} answered, but not with a model listing.')
        raise ProviderError('offline',f'{name} answered HTTP {err.code}.')
    except (urllib.error.URLError,OSError,TimeoutError):
        raise ProviderError('offline',f'{name} is not running. Start its server to see loaded models.')
    if len(raw)>MAX_BYTES: raise ProviderError('error','Model listing exceeds the size limit.')
    try: data=json.loads(raw)
    except ValueError: raise ProviderError('error',f'{name} did not answer with JSON.')
    if not isinstance(data,dict): raise ProviderError('error',f'{name} did not answer with a model listing.')
    return data

# ------------------------------------------------------------------- parsers
def _int(value):
    return value if isinstance(value,int) and not isinstance(value,bool) and value>=0 else None

def ollama(data,now):
    """`GET /api/ps`: {"models":[{"name","size","size_vram","expires_at","context_length",
    "details":{"parameter_size","quantization_level"}}]}"""
    rows=data.get('models')
    if not isinstance(rows,list): raise ProviderError('error','Ollama did not answer with a model listing.')
    models=[]
    for row in rows[:20]:
        if not isinstance(row,dict) or not isinstance(row.get('name') or row.get('model'),str): continue
        details=row.get('details') if isinstance(row.get('details'),dict) else {}
        size=_int(row.get('size'));vram=_int(row.get('size_vram'))
        models.append(dict(name=str(row.get('name') or row.get('model'))[:120],size=size,
                           gpu=(min(1,vram/size) if size and vram is not None else None),
                           context=_int(row.get('context_length')),
                           params=str(details.get('parameter_size') or '')[:20] or None,
                           quant=str(details.get('quantization_level') or '')[:20] or None,
                           expiresAt=timestamp(row.get('expires_at'))))
    return dict(windows=[],runtime=dict(models=models))

def lmstudio(data,now):
    """`GET /api/v1/models` (0.4+): one entry per *loaded instance* of an LLM.
    `GET /api/v0/models` (older): `state` is `loaded` or `not-loaded`."""
    rows=data.get('models') if isinstance(data.get('models'),list) else data.get('data')
    if not isinstance(rows,list): raise ProviderError('error','LM Studio did not answer with a model listing.')
    models=[]
    for row in rows[:100]:
        if not isinstance(row,dict) or row.get('type') not in ('llm','vlm'): continue
        quant=row.get('quantization');quant=quant.get('name') if isinstance(quant,dict) else quant
        base=dict(size=_int(row.get('size_bytes')),params=str(row.get('params_string') or '')[:20] or None,
                  quant=str(quant or '')[:20] or None,gpu=None,expiresAt=None)
        if isinstance(row.get('loaded_instances'),list):
            for instance in row['loaded_instances'][:8]:
                if not isinstance(instance,dict) or not isinstance(instance.get('id'),str): continue
                config=instance.get('config') if isinstance(instance.get('config'),dict) else {}
                models.append(dict(base,name=instance['id'][:120],context=_int(config.get('context_length'))))
        elif row.get('state')=='loaded' and isinstance(row.get('id'),str):
            models.append(dict(base,name=row['id'][:120],context=_int(row.get('loaded_context_length'))))
    return dict(windows=[],runtime=dict(models=models[:20]))

# ------------------------------------------------------------ LM Studio logs
SPEED=re.compile(rb'(?<!prompt )eval time =\s*[\d.]+ ms /\s*(\d+) tokens \([^,]*,\s*([\d.]+) tokens per second\)')

def lmstudio_log(home):
    """The newest server log, if any."""
    root=Path(home)/'.lmstudio/server-logs'
    try:
        months=sorted((p for p in root.iterdir() if p.is_dir()),reverse=True)[:2]
        logs=[p for m in months for p in m.glob('*.log')]
        return max(logs,key=lambda p:p.stat().st_mtime) if logs else None
    except OSError: return None

def lmstudio_speed(home):
    """Generation speed of the most recent completion, from llama.cpp's own
    timing line. The prompt-processing line ("prompt eval time") is skipped."""
    path=lmstudio_log(home)
    if not path: return None
    try:
        stamp=path.stat().st_mtime
        with path.open('rb') as stream:
            size=stream.seek(0,2);stream.seek(max(0,size-LOG_TAIL));raw=stream.read(LOG_TAIL)
    except OSError: return None
    found=SPEED.findall(raw)
    if not found: return None
    tokens,speed=found[-1]
    return dict(speed=round(float(speed),1),tokens=int(tokens),at=stamp)

def lmstudio_active(home,now):
    path=lmstudio_log(home)
    try: return bool(path) and 0<=now-path.stat().st_mtime<=ACTIVE_LOG
    except OSError: return False

# ------------------------------------------------------------------- fetch
def fetch(kind,home):
    now=time.time()
    if kind=='ollama':
        base=ollama_base()
        if not base: raise ProviderError('unavailable','OLLAMA_HOST points away from this computer; only a local Ollama is read.')
        return ollama(loopback_json(base+'/api/ps','Ollama'),now)
    base=lmstudio_base(home)
    try: out=lmstudio(loopback_json(base+'/api/v1/models','LM Studio'),now)
    except ProviderError as err:
        if err.status!='unavailable': raise
        out=lmstudio(loopback_json(base+'/api/v0/models','LM Studio'),now)
    speed=lmstudio_speed(home)
    if speed: out['runtime']['speed']=speed
    return out

def message(kind,result):
    models=result.get('runtime',{}).get('models',[])
    name='Ollama' if kind=='ollama' else 'LM Studio'
    if not models: return f'{name} is running with no model loaded.'
    return f'{name} is running with {len(models)} model{"s" if len(models)!=1 else ""} loaded.'
