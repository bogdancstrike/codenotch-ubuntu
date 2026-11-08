"""Read current sessions without installing hooks into the owning tools."""
import os
import json
from urllib.parse import quote
import time
from pathlib import Path
from .providers import read_json, sqlite_rows
from .model import timestamp
import re
from .turns import codex_turn, claude_turn, claude_title
from .autocontinue import live, target as delivery, proc_args, proc_start, proc_env

# Terminal CLIs without a session store of their own: a running process is a
# session, and tmux is its only auto-continue route.
GENERIC={'gemini':('agy','gemini'),'opencode':('opencode',),'kimi':('kimi',),'copilot':('copilot',),
         'cursor':('cursor-agent',),'grok':('grok',)}
CODEX_COMMANDS=('exec','e','app-server','mcp-server','mcp','login','logout','completion','apply','a','sandbox','debug','cloud','features','help')

def home_short(text):
    """~/project reads better than /home/name/project in a narrow card."""
    home=str(Path.home())
    text=str(text or '')
    return '~'+text[len(home):] if home and text.startswith(home) else text

def sessions(provider):
    now=time.time(); out=[]
    if provider.kind=='claude':
        for path in list((provider.path/'sessions').glob('*.json'))[:100]:
            row=read_json(path); pid=row.get('pid'); cwd=row.get('cwd')
            if not isinstance(pid,int) or pid<=0 or not isinstance(cwd,str): continue
            try:
                proc=Path('/proc')/str(pid)
                if proc.stat().st_uid!=os.getuid(): continue
                cmd=(proc/'cmdline').read_bytes().lower()
                if b'claude' not in cmd: continue
            except OSError: continue
            # Headless runs (auto-continue's own included) are not sessions to show.
            if row.get('kind') not in (None,'interactive'): continue
            args=proc_args(pid)
            if any(a in ('-p','--print') for a in args[1:]): continue
            state='waiting' if row.get('tempo')=='blocked' or row.get('status')=='waiting' else 'busy' if row.get('tempo')=='active' or row.get('status')=='busy' else 'idle'
            entry=dict(name=str(row.get('name') or Path(cwd).name),detail=home_short(row.get('waitingFor') or row.get('needs') or cwd),state=state,since=timestamp(row.get('statusUpdatedAt') or row.get('updatedAt')) or now,derived=False)
            sid=row.get('sessionId')
            transcript=claude_transcript(provider.path,sid,cwd)
            title=claude_title(transcript) if transcript else None
            if title: entry['name']=title
            if isinstance(sid,str) and sid:
                entry['key']=f'{provider.id}#{sid}'
                entry['target']=delivery('claude',sid,dict(pid=pid,args=args,cwd=cwd,start=proc_start(pid)),cwd)
            out.append(entry)
        # Also support unmodified Claude clients that only write transcripts.
        if not out and running('claude'):
            import heapq
            candidates=[]
            projects=provider.path/'projects'
            if projects.is_dir():
                for folder in projects.iterdir():
                    if not folder.is_dir(): continue
                    for path in folder.glob('*.jsonl'):
                        try: candidates.append((path.stat().st_mtime,str(path)))
                        except OSError: pass
            for _,path in heapq.nlargest(8,candidates):
                activity=claude_turn(Path(path),now)
                if activity:
                    activity['name']=claude_title(Path(path)) or Path(path).parent.name.rsplit('-',1)[-1] or 'Claude'
                    out.append(activity)
    elif provider.kind=='codex':
        out.extend(codex_sessions(provider,now))
    elif provider.kind=='cursor':
        if not running('cursor'): return []
        for (raw,) in sqlite_rows(provider.path,'SELECT value FROM composerHeaders WHERE isArchived = 0 ORDER BY recency DESC LIMIT 40'):
            try:
                row=json.loads(raw)
                touched=timestamp(row.get('conversationCheckpointLastUpdatedAt') or row.get('lastUpdatedAt') or row.get('unfinishedRunAt'))
                blocked=row.get('hasBlockingPendingActions') or row.get('hasPendingPlan')
                busy=row.get('unfinishedRunAt') and touched and 0<=now-touched<=900
                if not blocked and not busy: continue
                out.append(dict(name=str(row.get('name') or 'Untitled chat'),detail='Needs your input' if blocked else str(row.get('subtitle') or 'Cursor'),state='waiting' if blocked else 'busy',since=touched or now,derived=False))
            except (ValueError,AttributeError,TypeError): continue
    elif provider.kind=='grok':
        try:
            active=provider.path.parent/'active_sessions.json'
            with active.open() as f: rows=json.loads(f.read(1024*1024))
            if not isinstance(rows,list): return []
            for row in rows[:100]:
                id=row.get('session_id');cwd=row.get('cwd','');pid=row.get('pid')
                if not isinstance(id,str) or '/' in id or id in ('.','..') or not id: continue
                if not isinstance(pid,int) or not running('grok',pid): continue
                root=provider.path.parent/'sessions'
                candidates=[root/quote(cwd,safe='-._~')/id] if isinstance(cwd,str) else []
                candidates.extend(d/id for d in root.iterdir() if d.is_dir())
                for directory in candidates:
                    try:
                        stamp=(directory/'updates.jsonl').stat().st_mtime
                        if 0<=now-stamp<=45:
                            start=proc_start(pid)
                            entry=dict(name=Path(cwd).name or 'Grok',detail='Recent CLI updates · inferred activity',state='busy',since=stamp,derived=True)
                            if start is not None:
                                entry['key']=f'{provider.id}#pid:{pid}:{start}'
                                entry['target']=delivery('grok',None,dict(pid=pid,args=[],cwd=cwd,start=start),cwd)
                            out.append(entry)
                        break
                    except OSError: pass
        except (OSError,ValueError,AttributeError,TypeError): pass
    elif provider.kind=='lmstudio':
        from .runtimes import lmstudio_active
        if lmstudio_active(provider.path.parent,now):
            out.append(dict(name='LM Studio',detail='Generating',state='busy',since=now,derived=True))
    if provider.kind in GENERIC and ':' not in provider.id:
        out.extend(process_sessions(provider,out,now))
    return sorted(out,key=lambda r: {'waiting':0,'busy':1,'idle':2}[r['state']])[:12]


def claude_transcript(root,session_id,cwd):
    """projects/<cwd with every non-alphanumeric as '-'>/<session>.jsonl."""
    if not isinstance(session_id,str) or not re.match(r'^[A-Za-z0-9-]{1,80}$',session_id): return None
    path=Path(root)/'projects'/re.sub(r'[^A-Za-z0-9]','-',cwd)/(session_id+'.jsonl')
    if path.is_file(): return path
    try: return next((Path(root)/'projects').glob('*/'+session_id+'.jsonl'),None)
    except OSError: return None


def codex_home(process,provider):
    custom=proc_env(process['pid']).get('CODEX_HOME')
    home=Path(custom).expanduser() if custom else Path.home()/'.codex'
    try: return home.resolve()==Path(provider.path).resolve()
    except OSError: return False


def codex_sessions(provider,now):
    """Busy threads from their rollouts, plus every open Codex TUI as a
    session in its own right — idle ones too, so they can be auto-continued."""
    databases=sorted(provider.path.glob('state_*.sqlite'),key=lambda p:int(p.stem.split('_')[-1]) if p.stem.split('_')[-1].isdigit() else -1,reverse=True)
    threads=[]
    for database in databases[:3]:
        threads=sqlite_rows(database,"SELECT id, rollout_path, cwd, COALESCE(NULLIF(name,''),NULLIF(title,''),'') FROM threads WHERE archived = 0 ORDER BY updated_at_ms DESC LIMIT 40")
        if not threads:
            threads=sqlite_rows(database,"SELECT id, rollout_path, cwd, title FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT 40")
        if threads: break
    threads=[t for t in threads if len(t)==4 and all(isinstance(v,str) for v in t[:3])]
    titles={t[0]:' '.join(str(t[3] or '').split())[:120] for t in threads}
    processes=[p for p in live(('codex',),commands=CODEX_COMMANDS) if codex_home(p,provider)]
    # Which TUI owns which thread: an explicit `codex resume ID`, else the most
    # recent unclaimed thread started in the same directory.
    owner={};ids={t[0] for t in threads}
    for process in processes:
        args=process['args']
        explicit=next((a for a in args if a in ids),None)
        if explicit and explicit not in owner: owner[explicit]=process
    for process in processes:
        if process in owner.values(): continue
        thread=next((t[0] for t in threads if t[2]==process['cwd'] and t[0] not in owner),None)
        if thread: owner[thread]=process
    out=[];seen=set()
    for thread,path,cwd,_ in threads[:8]:
        activity=codex_turn(Path(path).expanduser(),now)
        if not activity: continue
        seen.add(thread)
        activity.update(name=titles.get(thread) or Path(cwd).name or 'Codex',detail=f"{activity['detail']} · {home_short(cwd)}",key=f'{provider.id}#{thread}',
                        target=delivery('codex',thread,owner.get(thread),cwd))
        out.append(activity)
    for thread,process in owner.items():
        if thread in seen: continue
        out.append(dict(name=titles.get(thread) or Path(process['cwd']).name or 'Codex',detail=home_short(process['cwd']),state='idle',
                        since=now,derived=False,key=f'{provider.id}#{thread}',target=delivery('codex',thread,process)))
    return out


def process_sessions(provider,existing,now):
    """Open terminal sessions of CLIs that keep no readable session list."""
    taken={(r.get('target') or {}).get('pid') for r in existing}
    out=[]
    for process in live(GENERIC[provider.kind]):
        if process['pid'] in taken: continue
        out.append(dict(name=Path(process['cwd']).name or provider.name,detail=home_short(process['cwd']),state='idle',since=now,derived=True,
                        key=f"{provider.id}#pid:{process['pid']}:{process['start']}",target=delivery(provider.kind,None,process)))
    return out


def running(name,pid=None):
    candidates=[Path('/proc')/str(pid)] if pid else Path('/proc').iterdir()
    for directory in candidates:
        if not directory.name.isdigit(): continue
        try:
            if directory.stat().st_uid!=os.getuid(): continue
            executable=(directory/'cmdline').read_bytes().split(b'\0',1)[0].decode(errors='replace').lower()
            if name in Path(executable).name: return True
        except OSError: continue
    return False
