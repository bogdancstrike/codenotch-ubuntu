"""Auto-continue: nudge an idle agent session once its usage limit allows it.

A session the user switched on is sent the configured prompt after it has been
idle for the configured interval. While a provider window is exhausted the
nudge waits for that window's reset (plus a short grace), so a session stopped
by a 5-hour or weekly limit resumes shortly after the limit lifts instead of
burning a request that would only be refused.

Delivery, most faithful first:

1. **tmux** — the session's own pane gets the prompt typed and submitted,
   exactly as if the user had typed it. Works for every terminal agent.
2. **headless resume** — Claude Code (`claude -p --resume ID`) and Codex
   (`codex exec resume ID`), run detached in the session's directory. Only the
   permission and model flags the user already started the session with are
   mirrored; nothing is escalated.

Everything here reads `/proc` entries owned by the current user only.
"""
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

INTERVALS=(15,30,60,120,180,300)
DEFAULT_MINUTES=60
DEFAULT_PROMPT='continue if there are still tasks to implement that are not ready'
RESET_GRACE=90
MAX_KEYS=50
KEY=re.compile(r'^[A-Za-z0-9:._#@/-]{1,200}$')
WRAPPERS=('node','nodejs','bun','deno','python','python3')
EXTRA_PATH=('.local/bin','.npm-global/bin','.bun/bin','.cargo/bin','bin')

# ------------------------------------------------------------------ settings
def clean_keys(value):
    """{session key: enabled-at epoch}. Bounded, newest kept."""
    if not isinstance(value,dict): return {}
    rows=[(k,float(v)) for k,v in value.items()
          if isinstance(k,str) and KEY.match(k) and isinstance(v,(int,float)) and not isinstance(v,bool) and v>0]
    return dict(sorted(rows,key=lambda r:r[1],reverse=True)[:MAX_KEYS])

def clean_prompt(value):
    """One line: a newline would submit a half-typed prompt through tmux, and a
    leading dash would be read as a flag by a headless CLI."""
    if not isinstance(value,str): return DEFAULT_PROMPT
    text=' '.join(value.split()).lstrip('-').strip()[:500]
    return text or DEFAULT_PROMPT

def clean_minutes(value):
    return value if isinstance(value,int) and not isinstance(value,bool) and value in INTERVALS else DEFAULT_MINUTES

# ----------------------------------------------------------------- processes
_TABLE=(0.0,[])

def _read(path,limit=262144):
    with open(path,'rb') as stream: return stream.read(limit)

def proc_args(pid):
    try: return [a.decode(errors='replace') for a in _read(f'/proc/{pid}/cmdline').split(b'\0') if a]
    except OSError: return []

def proc_env(pid,wanted=('TMUX','TMUX_PANE','CODEX_HOME','CLAUDE_CONFIG_DIR')):
    out={}
    try:
        for item in _read(f'/proc/{pid}/environ',1048576).split(b'\0'):
            name,_,value=item.partition(b'=')
            name=name.decode(errors='replace')
            if name in wanted: out[name]=value.decode(errors='replace')
    except OSError: pass
    return out

def proc_start(pid):
    """Clock-tick start time: (pid, start) survives pid reuse, pid alone does not."""
    try:
        raw=_read(f'/proc/{pid}/stat',4096).decode(errors='replace')
        return int(raw[raw.rindex(')')+2:].split()[19])
    except (OSError,ValueError,IndexError): return None

def alive(pid,start):
    if not (isinstance(pid,int) and pid>0 and start is not None and proc_start(pid)==start): return False
    try:
        raw=_read(f'/proc/{pid}/stat',4096).decode(errors='replace')
        return raw[raw.rindex(')')+2:].split()[0] not in ('Z','X')   # exited, not yet reaped
    except (OSError,ValueError,IndexError): return False

def program(args):
    """The tool a command line runs, seeing through node/bun launchers."""
    if not args: return ''
    name=Path(args[0]).name
    if name in WRAPPERS and len(args)>1 and not args[1].startswith('-'): name=Path(args[1]).name
    return name.removesuffix('.js').removesuffix('.mjs')

def table():
    """Same-uid processes, read once per worker run."""
    global _TABLE
    now=time.monotonic()
    if now-_TABLE[0]<2: return _TABLE[1]
    rows=[];uid=os.getuid()
    try: entries=os.listdir('/proc')
    except OSError: entries=[]
    for entry in entries:
        if not entry.isdigit(): continue
        try:
            if os.stat(f'/proc/{entry}').st_uid!=uid: continue
        except OSError: continue
        args=proc_args(entry)
        if args: rows.append((int(entry),args))
    _TABLE=(now,rows)
    return rows

def proc_parent(pid):
    try:
        raw=_read(f'/proc/{pid}/stat',4096).decode(errors='replace')
        return int(raw[raw.rindex(')')+2:].split()[1])
    except (OSError,ValueError,IndexError): return None

def live(names,commands=(),flags=()):
    """Interactive processes of a CLI: [{pid,args,cwd,start}], oldest first.

    `commands` excludes a first positional argument (`codex exec`), `flags`
    any matching flag (`claude -p`): those are headless runs, ours included.
    A launcher and the native binary it spawns count once, as the launcher."""
    out=[]
    for pid,args in table():
        if program(args) not in names: continue
        rest=args[2:] if Path(args[0]).name in WRAPPERS else args[1:]
        positional=next((a for a in rest if not a.startswith('-')),None)
        if positional in commands or any(a in flags for a in rest): continue
        try: cwd=os.readlink(f'/proc/{pid}/cwd')
        except OSError: continue
        start=proc_start(pid)
        if start is not None: out.append(dict(pid=pid,args=args,cwd=cwd,start=start,parent=proc_parent(pid)))
    pids={r['pid'] for r in out}
    return sorted((r for r in out if r['parent'] not in pids),key=lambda r:r['start'])

def tmux_target(pid):
    """(socket, pane) when the process lives in a tmux pane."""
    if not isinstance(pid,int): return None
    env=proc_env(pid)
    socket=env.get('TMUX','').split(',')[0];pane=env.get('TMUX_PANE','')
    if socket.startswith('/') and re.match(r'^%\d+$',pane): return [socket,pane]
    return None

# ------------------------------------------------------------ resume command
def _flag(args,names):
    for i,a in enumerate(args):
        for n in names:
            if a==n and i+1<len(args): return args[i+1]
            if n.startswith('--') and a.startswith(n+'='): return a[len(n)+1:]
    return None

def resume_command(kind,session_id,args):
    """Headless resume argv minus the prompt, mirroring only flags the user chose."""
    if not isinstance(session_id,str) or not re.match(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',session_id): return None
    args=args or []
    if kind=='claude':
        out=['claude','-p','--resume',session_id]
        if '--dangerously-skip-permissions' in args: out.append('--dangerously-skip-permissions')
        for flag in ('--permission-mode','--model'):
            value=_flag(args,(flag,))
            if value and not value.startswith('-'): out+=[flag,value]
        return out
    if kind=='codex':
        out=['codex','exec','resume','--skip-git-repo-check']
        if '--dangerously-bypass-approvals-and-sandbox' in args or '--yolo' in args:
            out.append('--dangerously-bypass-approvals-and-sandbox')
        sandbox=_flag(args,('--sandbox','-s')) or ('workspace-write' if '--full-auto' in args else None)
        if sandbox in ('read-only','workspace-write','danger-full-access'): out+=['-c',f'sandbox_mode="{sandbox}"']
        model=_flag(args,('--model','-m'))
        if model and not model.startswith('-'): out+=['-m',model]
        return out+[session_id]
    return None

def target(kind,session_id=None,process=None,cwd=None):
    """Everything delivery needs. Stripped from the row before it is written."""
    pid=process['pid'] if process else None
    return dict(kind=kind,pid=pid,start=process['start'] if process else None,cwd=cwd or (process or {}).get('cwd'),
                tmux=tmux_target(pid),resume=resume_command(kind,session_id,(process or {}).get('args')))

# ------------------------------------------------------------------ delivery
def _search_path():
    home=Path.home()
    return os.pathsep.join([os.environ.get('PATH','/usr/bin:/bin'),*(str(home/p) for p in EXTRA_PATH),'/usr/local/bin','/snap/bin'])

def executable(name,pid=None):
    """GNOME Shell's PATH rarely includes ~/.local/bin, where these CLIs live."""
    if pid and name=='claude':
        try:
            exe=os.readlink(f'/proc/{pid}/exe')
            if Path(exe).name not in WRAPPERS and os.access(exe,os.X_OK): return exe
        except OSError: pass
    return shutil.which(name,path=_search_path())

def send_tmux(where,prompt):
    tmux=executable('tmux')
    if not tmux: raise OSError('tmux is not installed')
    socket,pane=where
    base=[tmux,'-S',socket]
    quiet=dict(check=True,timeout=5,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(base+['send-keys','-t',pane,'-l',prompt],**quiet)
    # TUIs treat a burst of keys as a paste; a beat later, Enter submits it.
    time.sleep(.35)
    subprocess.run(base+['send-keys','-t',pane,'Enter'],**quiet)

def start_resume(t,prompt,log):
    argv=list(t['resume'])
    binary=executable(argv[0],t.get('pid'))
    if not binary: raise OSError(f'{argv[0]} was not found on PATH')
    argv[0]=binary
    cwd=t.get('cwd') if t.get('cwd') and os.path.isdir(t['cwd']) else str(Path.home())
    log.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    try:
        # A new session: the worker exits in milliseconds, the agent may run for an hour.
        child=subprocess.Popen(argv+[prompt],cwd=cwd,stdin=subprocess.DEVNULL,stdout=fd,stderr=subprocess.STDOUT,
                               start_new_session=True,env={**os.environ,'PATH':_search_path()},close_fds=True)
    finally:
        os.close(fd)
    return child.pid,proc_start(child.pid)

def deliver(t,prompt,log):
    """Returns the outcome; never raises."""
    errors=[]
    if t.get('tmux'):
        try:
            send_tmux(t['tmux'],prompt)
            return dict(ok=True,via='tmux')
        except (OSError,subprocess.SubprocessError) as err:
            errors.append(f'tmux: {err}')
    if t.get('resume'):
        try:
            pid,start=start_resume(t,prompt,log)
            return dict(ok=True,via='resume',child=pid,childStart=start)
        except (OSError,subprocess.SubprocessError,ValueError) as err:
            errors.append(f'resume: {err}')
    return dict(ok=False,via=None,error='; '.join(errors)[:300] or 'No delivery route')

# ---------------------------------------------------------------- scheduling
def blocked_until(row,now):
    """Latest reset among exhausted windows that block work (overage does not)."""
    until=0
    for w in row.get('windows') or []:
        f=w.get('fraction');reset=w.get('resetsAt')
        if isinstance(f,(int,float)) and f>=1 and not w.get('overageAllowed') and isinstance(reset,(int,float)) and reset>now:
            until=max(until,reset)
    return until

def evaluate(rows,settings,memory,now,send=None):
    """Annotates every keyed session with `autoContinue` and fires due nudges.

    `target` is always removed from the rows: process ids, tmux sockets and
    command lines never reach the snapshot."""
    enabled=settings.get('autoContinue') or {}
    interval=settings.get('autoContinueMinutes',DEFAULT_MINUTES)*60
    prompt=settings.get('autoContinuePrompt') or DEFAULT_PROMPT
    known=memory.get('sessions') if isinstance(memory.get('sessions'),dict) else {}
    # Sessions flicker (a scan can miss one); keep memory for every enabled key.
    out={k:v for k,v in known.items() if k in enabled and isinstance(v,dict)}
    for row in rows:
        blocked=blocked_until(row,now)
        for s in row.get('sessions') or []:
            t=s.pop('target',None);key=s.get('key')
            if not key: continue
            routes=[r for r in ('tmux','resume') if t and t.get(r)]
            info=dict(available=bool(routes),on=key in enabled,via=routes[0] if routes else None)
            if key in enabled and routes:
                mem=dict(out.get(key,{}))
                last=max(mem.get('last',0),enabled[key])
                running=alive(mem.get('child'),mem.get('childStart'))
                # The interval measures idleness: any activity restarts it.
                if s.get('state')!='idle' or running: last=max(last,now)
                due=max(last+interval,blocked+RESET_GRACE if blocked else 0)
                if s.get('state')=='idle' and not running and now>=due and send:
                    result=send(key,t,prompt)
                    mem.update(sentAt=now,via=result.get('via'),error=result.get('error'),
                               child=result.get('child'),childStart=result.get('childStart'))
                    running=bool(result.get('child'))
                    last=now;due=now+interval
                mem['last']=last
                out[key]=mem
                info.update(next=due,running=running,blockedUntil=blocked or None,sentAt=mem.get('sentAt'),error=mem.get('error'),
                            via=mem.get('via') if running else info['via'])
            s['autoContinue']=info
    return {'sessions':out}

def strip(rows):
    """For paths that skip evaluation: targets must still never be written."""
    for row in rows:
        for s in row.get('sessions') or []: s.pop('target',None)
    return rows

def log_path(root,key):
    return root/'auto-continue'/(re.sub(r'[^A-Za-z0-9._-]','_',key)[:120]+'.log')
