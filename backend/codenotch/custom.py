"""Opt-in quota programs, isolated from the shell and bounded by time and output."""
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import time
from .model import ProviderError, number, window, require
from .providers import Provider, read_json

MAX_OUTPUT=262144


def run(executable, folder, timeout, extension_id):
    allowed=('HOME','USER','LOGNAME','LANG','LC_ALL','LC_CTYPE','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME')
    env={key:os.environ[key] for key in allowed if key in os.environ}
    env.update(PATH='/usr/local/bin:/usr/bin:/bin',CODENOTCH_EXTENSION_ID=extension_id,CODENOTCH_EXTENSION_SCHEMA='1')
    process=subprocess.Popen([str(executable)],cwd=folder,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
    result=bytearray();deadline=time.monotonic()+timeout
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout,selectors.EVENT_READ)
            while True:
                remaining=deadline-time.monotonic()
                if remaining<=0: raise ProviderError('error','The quota program timed out.')
                if not selector.select(remaining): raise ProviderError('error','The quota program timed out.')
                chunk=os.read(process.stdout.fileno(),65536)
                if not chunk: break
                result.extend(chunk)
                if len(result)>MAX_OUTPUT: raise ProviderError('error','The quota program exceeded its output limit.')
        try: code=process.wait(timeout=max(.01,deadline-time.monotonic()))
        except subprocess.TimeoutExpired: raise ProviderError('error','The quota program timed out.')
        if code: raise ProviderError('error','The quota program stopped with an error.')
        try: return json.loads(result)
        except (ValueError,UnicodeError): raise ProviderError('error','The quota program returned invalid JSON.')
    finally:
        # Kill the entire group, including children that kept stdout open.
        try: os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError: pass
        try: process.wait(timeout=.2)
        except subprocess.TimeoutExpired: pass
        try: os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError: pass
        process.wait();process.stdout.close()


def parse(data):
    if not isinstance(data,dict) or data.get('schemaVersion')!=1:
        raise ProviderError('error','Unsupported quota program schema.')
    status=data.get('status','ok')
    if status!='ok':
        status=status if status in ('needsAuth','offline','rateLimited','unavailable') else 'error'
        raise ProviderError(status,'The quota program could not provide a fresh reading.')
    out=[]
    for index,row in enumerate((data.get('limits') or [])[:32]):
        if not isinstance(row,dict): continue
        percent=number(row.get('usedPercent'))
        if percent is None:
            used=number(row.get('used'));limit=number(row.get('limit'))
            if used is not None and limit is not None and limit>0: percent=100*used/limit
        if percent is None or percent<0: continue
        label=row.get('label');key=row.get('id',str(index))
        if not isinstance(label,str) or not isinstance(key,str) or any(w['id']==key for w in out): continue
        out.append(window(key[:120],label[:80],percent,row.get('resetsAt'),row.get('windowSeconds')))
    return require(out)


class CustomProvider(Provider):
    __slots__=('executable','timeout','problem')
    def __init__(self,folder,manifest):
        key=manifest.get('id',folder.name)
        super().__init__('extension:'+key,manifest.get('name',key)[:60],'extension',folder)
        self.problem=None;self.timeout=20;self.executable=None
        try:
            if manifest.get('schemaVersion')!=1: raise ValueError('Unsupported manifest schema.')
            raw=manifest.get('executable')
            if not isinstance(raw,str) or Path(raw).is_absolute(): raise ValueError('Executable must be a relative path.')
            target=(folder/raw).resolve()
            if not target.is_relative_to(folder.resolve()) or not target.is_file() or not os.access(target,os.X_OK):
                raise ValueError('Executable must be an executable file inside its extension folder.')
            timeout=number(manifest.get('timeoutSeconds',20))
            if timeout is None: raise ValueError('Timeout must be a number.')
            self.executable=target;self.timeout=max(1,min(30,timeout))
        except (ValueError,OSError) as err: self.problem=str(err)
    def fetch(self,home,config,data):
        if self.problem: raise ProviderError('error',self.problem)
        result=parse(run(self.executable,self.path,self.timeout,self.id))
        self.attempts=[dict(route='extension',state='ok')]
        return result


def discover(data):
    root=data/'codenotch/extensions';out=[];seen=set()
    if not root.is_dir(): return out
    for folder in sorted(root.iterdir())[:64]:
        if not folder.is_dir(): continue
        manifest=read_json(folder/'codenotch-extension.json')
        key=manifest.get('id',folder.name)
        if not isinstance(key,str) or not re.fullmatch(r'[a-zA-Z0-9_.-]{1,60}',key) or key in seen: continue
        if not isinstance(manifest.get('name',key),str): continue
        seen.add(key);out.append(CustomProvider(folder,manifest))
    return out
