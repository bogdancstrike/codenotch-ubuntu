"""Read current sessions without installing hooks into the owning tools."""
import os
import json
from urllib.parse import quote
import time
from pathlib import Path
from .providers import read_json, sqlite_rows
from .model import timestamp

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
            state='waiting' if row.get('tempo')=='blocked' or row.get('status')=='waiting' else 'busy' if row.get('tempo')=='active' or row.get('status')=='busy' else 'idle'
            out.append(dict(name=str(row.get('name') or Path(cwd).name),detail=home_short(row.get('waitingFor') or row.get('needs') or cwd),state=state,since=timestamp(row.get('statusUpdatedAt') or row.get('updatedAt')) or now,derived=False))
    elif provider.kind=='codex':
        paths=sqlite_rows(provider.path/'state_5.sqlite','SELECT rollout_path FROM threads WHERE archived = 0 ORDER BY updated_at_ms DESC LIMIT 8')
        for (path,) in paths:
            try:
                stamp=Path(path).expanduser().stat().st_mtime
                if 0<=now-stamp<=8: out.append(dict(name='Codex',detail='Recent rollout writes · inferred activity',state='busy',since=stamp,derived=True))
            except (OSError,TypeError): continue
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
                        if 0<=now-stamp<=45: out.append(dict(name=Path(cwd).name or 'Grok',detail='Recent CLI updates · inferred activity',state='busy',since=stamp,derived=True))
                        break
                    except OSError: pass
        except (OSError,ValueError,AttributeError,TypeError): pass
    return sorted(out,key=lambda r: {'waiting':0,'busy':1,'idle':2}[r['state']])[:12]


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
