"""Short-lived polling worker. stdout is a secret-free JSON snapshot.

Locking rule that matters for the desktop: settings reads and writes take a
short lock and never wait for the network. Polling takes a *separate*,
non-blocking lock, so a slow provider can never make a settings change — or the
preferences window — hang behind it.
"""
import argparse
import errno
import fcntl
import json
import os
import time
from pathlib import Path
from . import __version__
from .model import ProviderError
from .providers import read_json, discover, detected
from .activity import sessions
from . import widgets as widget_module

DEFAULTS=dict(
    edge='right',visibility='hover',scale=1.0,monitor=-1,disabled=[],demo=False,
    panelIcon=True,hideFullscreen=True,
    peek=True,corner='center',
    pollSeconds=150,idlePollSeconds=600,
    widgets=['clock','date'],
    clock24=True,clockSeconds=False,dateStyle='medium',
    weatherPlace='',weatherLat=None,weatherLon=None,weatherUnits='metric',
    textContrast='high',
)
EDGES=('right','left','top','bottom')
VISIBILITIES=('hover','always','hidden')
CORNERS=('start','center','end')
DATE_STYLES=('short','medium','long')
POLL_CHOICES=(60,90,150,300,600,1800)

def locations():
    home=Path.home()
    return home,Path(os.environ.get('XDG_CONFIG_HOME',str(home/'.config'))),Path(os.environ.get('XDG_DATA_HOME',str(home/'.local/share'))),Path(os.environ.get('XDG_CACHE_HOME',str(home/'.cache')))

def atomic_json(path, value):
    """Write privately, then rename. Hand-rolled rather than via tempfile, whose
    import alone costs more than the rest of an idle run."""
    path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    tmp=path.parent/f'.tmp-{os.getpid()}-{path.name}'
    try:
        try:
            fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        except FileExistsError:
            os.unlink(tmp)   # a crashed run left this behind; we hold the lock
            fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as stream:
            json.dump(value,stream,ensure_ascii=False,allow_nan=False); stream.flush(); os.fsync(stream.fileno())
        os.replace(tmp,path)
    finally:
        if tmp.exists(): os.unlink(tmp)

class Lock:
    """flock helper. `blocking=False` reports contention instead of waiting."""
    def __init__(self,path,blocking=True):
        self.path,self.blocking,self.handle,self.held=path,blocking,None,False
    def __enter__(self):
        self.path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.handle=self.path.open('a')
        try: os.chmod(self.path,0o600)
        except OSError: pass
        try:
            fcntl.flock(self.handle,fcntl.LOCK_EX if self.blocking else fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.held=True
        except OSError as err:
            if self.blocking or err.errno not in (errno.EAGAIN,errno.EACCES): raise
        return self
    def __exit__(self,*_):
        try:
            if self.held: fcntl.flock(self.handle,fcntl.LOCK_UN)
        finally:
            self.handle.close()
        return False

def clamp_widgets(value):
    if not isinstance(value,list): return list(DEFAULTS['widgets'])
    seen,out=set(),[]
    for item in value:
        if isinstance(item,str) and item in widget_module.KINDS and item not in seen:
            seen.add(item); out.append(item)
    return out

def configuration(config):
    raw=read_json(config/'codenotch/settings.json')
    out={**DEFAULTS,**{k:v for k,v in raw.items() if k in DEFAULTS}}
    if out['edge'] not in EDGES: out['edge']='right'
    if out['visibility'] not in VISIBILITIES: out['visibility']='hover'
    if out['corner'] not in CORNERS: out['corner']='center'
    if out['dateStyle'] not in DATE_STYLES: out['dateStyle']='medium'
    if out['weatherUnits'] not in ('metric','imperial'): out['weatherUnits']='metric'
    if out['textContrast'] not in ('normal','high','higher'): out['textContrast']='high'
    if not isinstance(out['disabled'],list): out['disabled']=[]
    out['disabled']=[x for x in out['disabled'] if isinstance(x,str)]
    if not isinstance(out['scale'],(int,float)) or not 0.75<=out['scale']<=2: out['scale']=1.0
    if not isinstance(out['monitor'],int): out['monitor']=-1
    out['widgets']=clamp_widgets(out['widgets'])
    for key,low,high in (('pollSeconds',60,3600),('idlePollSeconds',60,7200)):
        if not isinstance(out[key],int) or not low<=out[key]<=high: out[key]=DEFAULTS[key]
    out['idlePollSeconds']=max(out['idlePollSeconds'],out['pollSeconds'])
    for key in ('weatherLat','weatherLon'):
        value=out[key]
        out[key]=float(value) if isinstance(value,(int,float)) and not isinstance(value,bool) else None
    # A place is its name *and* its coordinates; half of one is not a location.
    if out['weatherLat'] is None or out['weatherLon'] is None:
        out['weatherLat']=out['weatherLon']=None; out['weatherPlace']=''
    out['weatherPlace']=str(out['weatherPlace'])[:120] if isinstance(out['weatherPlace'],str) else ''
    for key in ('demo','panelIcon','hideFullscreen','peek','clock24','clockSeconds'):
        out[key]=bool(out[key])
    return out

def apply_settings(args,config,root):
    """Mutate settings under a short lock. Never runs while HTTP is in flight."""
    path=config/'codenotch/settings.json'
    with Lock(root/'settings.lock'):
        settings=configuration(config)
        changed=False
        if args.set:
            key,value=args.set
            if key not in DEFAULTS: raise ValueError('Unknown setting')
            if key in ('weatherPlace','weatherLat','weatherLon'):
                raise ValueError('Use --location: a place name and its coordinates must be written together')
            settings[key]=json.loads(value); changed=True
        if getattr(args,'location',None) is not None:
            # One write, because configuration() drops a half-set location and a
            # key-at-a-time update could therefore never complete one.
            place=json.loads(args.location) or {}
            if not isinstance(place,dict): raise ValueError('Location must be a JSON object')
            settings['weatherPlace']=str(place.get('label') or place.get('name') or '')[:120]
            settings['weatherLat']=place.get('latitude'); settings['weatherLon']=place.get('longitude')
            changed=True
        if args.enable or args.disable:
            disabled=set(settings['disabled'])
            if args.enable: disabled.discard(args.enable)
            if args.disable: disabled.add(args.disable)
            settings['disabled']=sorted(disabled); changed=True
        if changed:
            atomic_json(path,{k:settings.get(k) for k in DEFAULTS})
            settings=configuration(config)
        return settings

def demo_snapshot(providers,settings,cache_root):
    values={'claude':[73,7],'codex':[21,9],'cursor':[52,28],'gemini':[35,18],'glm':[12,8],'grok':[8],'opencode':[32,10,4]}
    now=time.time(); out=[]
    for p in providers:
        enabled=p.id not in settings['disabled']
        out.append({**p.meta(),'enabled':enabled,'detected':True,'status':'demo' if enabled else 'disabled','message':'Sample data — no credentials read or network requests made.','updatedAt':now,'source':source_name(p),'windows':[dict(id=str(i),label='Current session' if i==0 else 'All models' if i==1 else 'Monthly limit',fraction=n/100,resetsAt=now+(3060 if i==0 else 172800)) for i,n in enumerate(values[p.kind])] if enabled else [],'sessions':[dict(name='scraper-manager',detail='Terminal · ~/projects/scraper-manager',state='busy',since=now-125,derived=False)] if p.kind=='claude' and enabled else []})
    demo_widgets={}
    if 'weather' in settings['widgets']:
        demo_widgets['weather']=dict(temp=21,feels=20,high=24,low=13,humidity=48,wind=9,code=2,text='Partly cloudy',symbol='partly',unit='C',windUnit='km/h',place=settings['weatherPlace'] or 'Sample city',updatedAt=now,status='ok',message='')
    if 'battery' in settings['widgets']:
        demo_widgets['battery']=dict(percent=76,charging=False,state='Discharging',name='BAT0')
    if 'system' in settings['widgets']:
        demo_widgets['system']=dict(cpu=.34,mem=.52,memUsed=8.3,memTotal=16.0)
    return dict(version=__version__,settings=settings,providers=out,widgets=demo_widgets,generatedAt=now)

def source_name(p):
    return {'claude':'Claude Code OAuth · '+str(p.path/'.credentials.json'),'codex':'Codex sign-in · '+str(p.path/'auth.json'),'cursor':'Cursor signed-in SQLite session','gemini':'Antigravity IDE or `agy` CLI sign-in','glm':'Z.ai key borrowed from Claude Code, OpenCode, or ZCode','grok':'Grok CLI session · '+str(p.path),'opencode':'OpenCode Go key · '+str(p.path)}[p.kind]

def local_state(p,old,settings,home,config,data,force=None):
    """Everything that cannot block: enablement, detection, running sessions.

    Returns (row, needs_fetch). Runs serially, so a snapshot with nothing due
    never creates a thread pool."""
    now=time.time(); meta={**p.meta(),'source':source_name(p),'enabled':p.id not in settings['disabled']}
    # This is before detection: disabled providers' credentials are never inspected.
    if not meta['enabled']:
        return {**meta,'status':'disabled','detected':False,'windows':[],'sessions':[],'message':'Disconnected here. The owning tool remains signed in.'},False
    try:
        exists=detected(p,home,config,data)
        activity=sessions(p)
    except (OSError,ValueError,TypeError,AttributeError):
        return {**meta,'detected':True,'status':'error','windows':[], 'sessions':[], 'message':'The owning tool’s local state could not be read.'},False
    base={**old,**meta,'detected':exists,'sessions':activity}
    if not exists:
        return {**meta,'detected':False,'status':'needsAuth','windows':[],'sessions':[],'message':'No local sign-in found. Open the owning tool and sign in.'},False
    deadline=max(old.get('retryAt',0),old.get('nextPoll',0) if force not in ('all',p.id) else 0)
    if deadline>now and old.get('status'):
        return base,False
    return base,True

def fetch_provider(p,base,old,settings,home,config,data):
    """The blocking half: one usage request, with backoff bookkeeping."""
    now=time.time()
    cadence=settings['pollSeconds'] if base.get('sessions') else settings['idlePollSeconds']
    try:
        windows=p.fetch(home,config,data)
        return {**base,'status':'ok','windows':windows,'message':'Connection verified. Usage returned by the provider.','updatedAt':now,'checkedAt':now,'nextPoll':now+cadence,'retryAt':0,'failures':0}
    except ProviderError as err:
        count=min(10,old.get('failures',0)+1)
        delay=max(60*2**min(count-1,4),err.retry) if err.status=='rateLimited' else max(60,cadence)
        return {**base,'status':'stale' if old.get('windows') else err.status,'errorStatus':err.status,'message':err.message,'windows':old.get('windows',[]),'checkedAt':now,'nextPoll':now+delay,'retryAt':now+delay if err.status=='rateLimited' else 0,'failures':count}
    except (ValueError,TypeError,KeyError,AttributeError,OSError):
        return {**base,'status':'stale' if old.get('windows') else 'error','message':'Local state or provider response could not be parsed.','windows':old.get('windows',[]),'checkedAt':now,'nextPoll':now+max(60,cadence)}

def update_provider(p,old,settings,home,config,data,force=None):
    row,needs=local_state(p,old,settings,home,config,data,force)
    return fetch_provider(p,row,old,settings,home,config,data) if needs else row

def info_snapshot(providers,settings,old,widget_cache):
    return dict(version=__version__,settings=settings,widgets=widget_cache.get('current',{}),providers=[
        {**p.meta(),'enabled':p.id not in settings['disabled'],'source':source_name(p),
         **{k:v for k,v in old.get(p.id,{}).items() if k not in ('source','enabled')}} for p in providers])

def collect(args):
    home,config,data,cache=locations(); root=cache/'codenotch'; root.mkdir(mode=0o700,parents=True,exist_ok=True)
    settings=apply_settings(args,config,root)
    if args.search:
        return dict(version=__version__,query=args.search,results=widget_module.search_places(args.search))
    providers=discover(home,config,data)
    if args.demo or settings['demo']:
        return demo_snapshot(providers,settings,root)
    archive=read_json(root/'usage.json'); old={p['id']:p for p in archive.get('providers',[]) if isinstance(p,dict) and 'id' in p}
    widget_cache=read_json(root/'widgets.json')
    # Status/info never performs HTTP. Explicit verification or scheduled
    # snapshot polling does; all jobs are outside GNOME Shell's main thread.
    if args.info:
        return info_snapshot(providers,settings,old,widget_cache)
    with Lock(root/'poll.lock',blocking=False) as poll:
        if not poll.held:
            # Another worker owns this cycle. Answer from cache instead of
            # queueing behind its network calls.
            return {**info_snapshot(providers,settings,old,widget_cache),'busy':True}
        force_widgets=bool(args.verify or args.widgets)
        rows=[];jobs=[]
        for p in providers:
            row,needs=local_state(p,old.get(p.id,{}),settings,home,config,data,args.verify)
            rows.append(row)
            if needs: jobs.append((len(rows)-1,p,row,old.get(p.id,{})))
        if jobs or widget_module.needs_network(settings,widget_cache,force_widgets):
            # Only now is a thread pool worth its import and its threads.
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(8,len(jobs)+1)) as pool:
                pending={pool.submit(fetch_provider,p,row,previous,settings,home,config,data):index
                         for index,p,row,previous in jobs}
                widget_job=pool.submit(safe_widgets,settings,widget_cache,force_widgets)
                for future,index in pending.items(): rows[index]=future.result()
                current=widget_job.result()
        else:
            current=safe_widgets(settings,widget_cache,force_widgets)
        snapshot=dict(version=__version__,settings=settings,providers=rows,widgets=current,generatedAt=time.time())
        with Lock(root/'settings.lock'):
            atomic_json(root/'usage.json',snapshot)
            atomic_json(root/'widgets.json',{**widget_cache,'current':current})
        return snapshot

def safe_widgets(settings,cache,force):
    try:
        return widget_module.collect(settings,cache,force)
    except (ProviderError,OSError,ValueError,TypeError,KeyError,AttributeError):
        return cache.get('current',{}) if isinstance(cache.get('current'),dict) else {}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',action='store_true'); parser.add_argument('--demo',action='store_true')
    parser.add_argument('--info',action='store_true'); parser.add_argument('--verify',metavar='PROVIDER',help='Provider ID or all; respects Retry-After')
    parser.add_argument('--set',nargs=2,metavar=('KEY','JSON'))
    parser.add_argument('--search',metavar='PLACE',help='Search weather locations by name')
    parser.add_argument('--widgets',action='store_true',help='Force a widget refresh (weather, system)')
    parser.add_argument('--location',metavar='JSON',help='Set the weather place and its coordinates together; {} clears it')
    group=parser.add_mutually_exclusive_group(); group.add_argument('--enable'); group.add_argument('--disable')
    args=parser.parse_args()
    try: print(json.dumps(collect(args),ensure_ascii=False,allow_nan=False))
    except (OSError,ValueError,TypeError):
        print(json.dumps({'error':'Codenotch could not read or write its local settings/cache.'})); return 1
    return 0

if __name__=='__main__': raise SystemExit(main())
