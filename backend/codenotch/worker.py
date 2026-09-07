"""Short-lived, locked polling worker. stdout is a secret-free JSON snapshot."""
import argparse
import concurrent.futures
import fcntl
import json
import os
import tempfile
import time
from pathlib import Path
from . import __version__
from .model import ProviderError
from .providers import read_json, discover, detected
from .activity import sessions

DEFAULTS=dict(edge='right',visibility='hover',scale=1.0,monitor=-1,disabled=[],demo=False,panelIcon=True,hideFullscreen=True)

def locations():
    home=Path.home()
    return home,Path(os.environ.get('XDG_CONFIG_HOME',str(home/'.config'))),Path(os.environ.get('XDG_DATA_HOME',str(home/'.local/share'))),Path(os.environ.get('XDG_CACHE_HOME',str(home/'.cache')))

def atomic_json(path, value):
    path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix='.tmp-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as stream:
            json.dump(value,stream,ensure_ascii=False,allow_nan=False); stream.flush(); os.fsync(stream.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def configuration(config):
    raw=read_json(config/'codenotch/settings.json')
    out={**DEFAULTS,**{k:v for k,v in raw.items() if k in DEFAULTS}}
    if out['edge'] not in ('right','left','top','bottom'): out['edge']='right'
    if out['visibility'] not in ('hover','always','hidden'): out['visibility']='hover'
    if not isinstance(out['disabled'],list): out['disabled']=[]
    out['disabled']=[x for x in out['disabled'] if isinstance(x,str)]
    if not isinstance(out['scale'],(int,float)) or not 0.75<=out['scale']<=2: out['scale']=1.0
    if not isinstance(out['monitor'],int): out['monitor']=-1
    return out

def demo_snapshot(providers,settings):
    values={'claude':[73,7],'codex':[21,9],'cursor':[52,28],'gemini':[35,18],'glm':[12,8],'grok':[8],'opencode':[32,10,4]}
    now=time.time(); out=[]
    for p in providers:
        enabled=p.id not in settings['disabled']
        out.append({**p.meta(),'enabled':enabled,'detected':True,'status':'demo' if enabled else 'disabled','message':'Sample data — no credentials read or network requests made.','updatedAt':now,'source':source_name(p),'windows':[dict(id=str(i),label='Current session' if i==0 else 'All models' if i==1 else 'Monthly limit',fraction=n/100,resetsAt=now+(3060 if i==0 else 172800)) for i,n in enumerate(values[p.kind])] if enabled else [],'sessions':[dict(name='scraper-manager',detail='Terminal · ~/projects/scraper-manager',state='busy',since=now-125,derived=False)] if p.kind=='claude' and enabled else []})
    return dict(version=__version__,settings=settings,providers=out,generatedAt=now)

def source_name(p):
    return {'claude':'Claude Code OAuth · '+str(p.path/'.credentials.json'),'codex':'Codex sign-in · '+str(p.path/'auth.json'),'cursor':'Cursor signed-in SQLite session','gemini':'Antigravity local language server','glm':'Z.ai key borrowed from Claude Code, OpenCode, or ZCode','grok':'Grok CLI session · '+str(p.path),'opencode':'OpenCode Go key · '+str(p.path)}[p.kind]

def update_provider(p,old,settings,home,config,data,force=None):
    now=time.time(); meta={**p.meta(),'source':source_name(p),'enabled':p.id not in settings['disabled']}
    # This is before detection: disabled providers' credentials are never inspected.
    if not meta['enabled']:
        return {**meta,'status':'disabled','detected':False,'windows':[],'sessions':[],'message':'Disconnected here. The owning tool remains signed in.'}
    try:
        exists=detected(p,home,config,data)
        activity=sessions(p)
    except (OSError,ValueError,TypeError,AttributeError):
        return {**meta,'detected':True,'status':'error','windows':[], 'sessions':[], 'message':'The owning tool’s local state could not be read.'}
    base={**old,**meta,'detected':exists,'sessions':activity}
    if not exists:
        return {**meta,'detected':False,'status':'needsAuth','windows':[],'sessions':[],'message':'No local sign-in found. Open the owning tool and sign in.'}
    deadline=max(old.get('retryAt',0),old.get('nextPoll',0) if force not in ('all',p.id) else 0)
    if deadline>now and old.get('status'):
        return base
    try:
        windows=p.fetch(home,config,data)
        # Settings may change while HTTP is in flight. A later lock holder will
        # discard this reading before it can be emitted for a disabled provider.
        return {**base,'status':'ok','windows':windows,'message':'Connection verified. Usage returned by the provider.','updatedAt':now,'checkedAt':now,'nextPoll':now+(60 if base['sessions'] else 300),'retryAt':0,'failures':0}
    except ProviderError as err:
        count=min(10,old.get('failures',0)+1)
        delay=max(60*2**min(count-1,4),err.retry) if err.status=='rateLimited' else 60
        return {**base,'status':'stale' if old.get('windows') else err.status,'errorStatus':err.status,'message':err.message,'windows':old.get('windows',[]),'checkedAt':now,'nextPoll':now+delay,'retryAt':now+delay if err.status=='rateLimited' else 0,'failures':count}
    except (ValueError,TypeError,KeyError,AttributeError,OSError):
        return {**base,'status':'stale' if old.get('windows') else 'error','message':'Local state or provider response could not be parsed.','windows':old.get('windows',[]),'checkedAt':now,'nextPoll':now+60}

def collect(args):
    home,config,data,cache=locations(); root=cache/'codenotch'; root.mkdir(mode=0o700,parents=True,exist_ok=True)
    with (root/'worker.lock').open('a') as lock:
        os.chmod(root/'worker.lock',0o600); fcntl.flock(lock,fcntl.LOCK_EX)
        settings=configuration(config)
        if args.set:
            key,value=args.set
            if key not in DEFAULTS: raise ValueError('Unknown setting')
            settings[key]=json.loads(value); atomic_json(config/'codenotch/settings.json',settings)
            settings=configuration(config)
        if args.enable or args.disable:
            disabled=set(settings['disabled'])
            if args.enable: disabled.discard(args.enable)
            if args.disable: disabled.add(args.disable)
            settings['disabled']=sorted(disabled); atomic_json(config/'codenotch/settings.json',settings)
        providers=discover(home,config,data)
        if args.demo or settings['demo']: return demo_snapshot(providers,settings)
        archive=read_json(root/'usage.json'); old={p['id']:p for p in archive.get('providers',[]) if isinstance(p,dict) and 'id' in p}
        # Status/info never performs HTTP. Explicit verification or scheduled
        # snapshot polling does; all jobs are outside GNOME Shell's main thread.
        if args.info:
            return dict(version=__version__,settings=settings,providers=[{**p.meta(),'enabled':p.id not in settings['disabled'],'source':source_name(p),**{k:v for k,v in old.get(p.id,{}).items() if k not in ('source','enabled')}} for p in providers])
        with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
            futures=[pool.submit(update_provider,p,old.get(p.id,{}),settings,home,config,data,args.verify) for p in providers]
            rows=[f.result() for f in futures]
        snapshot=dict(version=__version__,settings=settings,providers=rows,generatedAt=time.time())
        atomic_json(root/'usage.json',snapshot)
        return snapshot

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',action='store_true'); parser.add_argument('--demo',action='store_true')
    parser.add_argument('--info',action='store_true'); parser.add_argument('--verify',metavar='PROVIDER',help='Provider ID or all; respects Retry-After')
    parser.add_argument('--set',nargs=2,metavar=('KEY','JSON'))
    group=parser.add_mutually_exclusive_group(); group.add_argument('--enable'); group.add_argument('--disable')
    args=parser.parse_args()
    try: print(json.dumps(collect(args),ensure_ascii=False,allow_nan=False))
    except (OSError,ValueError,TypeError):
        print(json.dumps({'error':'Codenotch could not read or write its local settings/cache.'})); return 1
    return 0

if __name__=='__main__': raise SystemExit(main())
