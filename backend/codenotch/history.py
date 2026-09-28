"""Private incremental token ledger. Never store prompts, responses or credentials."""
from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
from .model import number, timestamp

COUNTERS=('input','output','cacheRead','cacheWrite')
MAX_LINE=1024*1024
MAX_BYTES=16*1024*1024
SCHEMA='''
CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, inode INTEGER, offset INTEGER, size INTEGER, mtime INTEGER, state TEXT);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, source TEXT, model TEXT, project TEXT, at REAL,
 input INTEGER, output INTEGER, cacheRead INTEGER, cacheWrite INTEGER);
CREATE INDEX IF NOT EXISTS events_at ON events(at);
'''


def integer(value):
    n=number(value)
    return int(n) if n is not None and 0<=n<=10**15 else None


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def event(source, key, model, project, at, counts):
    stamp=timestamp(at)
    if stamp is None or stamp<=0 or stamp>time.time()+86400: return None
    values=[integer(counts.get(k,0)) for k in COUNTERS]
    if any(n is None for n in values): return None
    return (digest(source+'|'+str(key)),str(source)[:80],str(model or 'Unknown model')[:120],str(project or 'Unknown project')[:240],stamp,*values)


def parse_record(row, source, state, file_key, offset):
    if not isinstance(row,dict): return None
    if source=='codex':
        payload=row.get('payload') or {}
        if not isinstance(payload,dict): return None
        if row.get('type')=='session_meta':
            state['session']=str(payload.get('id') or file_key);state['project']=payload.get('cwd','')
        elif row.get('type')=='turn_context':
            state['model']=payload.get('model',state.get('model'));state['project']=payload.get('cwd',state.get('project'))
        elif row.get('type')=='event_msg' and payload.get('type')=='token_count':
            info=payload.get('info') or {};total=info.get('total_token_usage') or {}
            incoming=[integer(total.get(k)) for k in ('input_tokens','output_tokens','cached_input_tokens')]
            if any(n is None for n in incoming): return None
            old=state.get('totals',[0,0,0])
            # Repeated totals are no additional consumption. A counter restart
            # starts a new epoch rather than subtracting somebody else's usage.
            if incoming[0]<old[0] or incoming[1]<old[1]:
                old=[0,0,0];state['epoch']=state.get('epoch',0)+1
            delta=[max(0,a-b) for a,b in zip(incoming,old)]
            state['totals']=incoming
            if not any(delta): return None
            inp,out,cached=delta
            if cached>inp: cached=inp
            key=f"{state.get('session',file_key)}:{state.get('epoch',0)}:{incoming}"
            return event(source,key,state.get('model'),state.get('project'),row.get('timestamp'),dict(input=inp-cached,output=out,cacheRead=cached))
    elif source=='claude':
        message=row.get('message') or {};usage=message.get('usage') or {}
        if row.get('type')!='assistant' or not isinstance(usage,dict): return None
        inp=integer(usage.get('input_tokens'));out=integer(usage.get('output_tokens'))
        if inp is None or out is None: return None
        # Claude's input counter excludes cached input; these are disjoint.
        return event(source,message.get('id') or row.get('uuid') or f'{file_key}:{offset}',message.get('model'),row.get('cwd'),row.get('timestamp'),
                     dict(input=inp,output=out,cacheRead=usage.get('cache_read_input_tokens',0),cacheWrite=usage.get('cache_creation_input_tokens',0)))
    elif source=='import':
        if row.get('schemaVersion')!=1 or not isinstance(row.get('source'),str) or not isinstance(row.get('id'),str): return None
        counts=row.get('tokens')
        if not isinstance(counts,dict) or integer(counts.get('input')) is None or integer(counts.get('output')) is None: return None
        return event(row['source'],row['id'],row.get('model'),row.get('project'),row.get('timestamp'),counts)
    return None


def put(db, entry):
    if entry is None: return
    # Streaming Claude records can repeat a message with larger counters.
    db.execute('''INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      input=max(input,excluded.input),output=max(output,excluded.output),
      cacheRead=max(cacheRead,excluded.cacheRead),cacheWrite=max(cacheWrite,excluded.cacheWrite)''',entry)


def paths(providers, data, enabled):
    seen=set()
    for provider in providers:
        if not enabled(provider): continue
        root=provider.path
        if provider.kind not in ('claude','codex'): continue
        subdirs=('projects',) if provider.kind=='claude' else ('sessions','archived_sessions')
        for subdir in subdirs:
            folder=root/subdir
            if not folder.is_dir(): continue
            for path in folder.rglob('*.jsonl'):
                resolved=str(path.resolve())
                if resolved in seen: continue
                seen.add(resolved);yield path,provider.kind
                if len(seen)>=20000: return
    folder=data/'codenotch/usage-imports'
    if folder.is_dir():
        for path in sorted(folder.glob('*.jsonl'))[:128]: yield path,'import'


def scan_file(db, path, source, deadline, budget):
    try: stat=path.stat()
    except OSError: return 0,False
    key=str(path.resolve());old=db.execute('SELECT inode,offset,size,mtime,state FROM files WHERE path=?',(key,)).fetchone()
    offset=0;state={}
    if old and old[0]==stat.st_ino and old[1]<=stat.st_size:
        offset=old[1];state=json.loads(old[4])
        if old[2]==stat.st_size and old[3]==stat.st_mtime_ns and offset==stat.st_size: return 0,False
        if old[1]==stat.st_size and old[3]!=stat.st_mtime_ns: offset=0;state={}
    start=offset
    try:
        with path.open('rb') as stream:
            stream.seek(offset)
            while time.monotonic()<deadline and offset-start<budget:
                position=stream.tell();line=stream.readline(MAX_LINE+1)
                if not line: break
                if not line.endswith(b'\n'):
                    # Leave partial writes for the next pass. Oversized lines
                    # are discarded without ever loading their contents whole.
                    if len(line)>MAX_LINE:
                        while line and not line.endswith(b'\n') and time.monotonic()<deadline:
                            line=stream.readline(MAX_LINE+1)
                        offset=stream.tell();continue
                    break
                offset=stream.tell()
                try: row=json.loads(line)
                except (ValueError,UnicodeError): continue
                try: put(db,parse_record(row,source,state,key,position))
                except (ValueError,TypeError,AttributeError,OverflowError): continue
    except OSError: return 0,False
    db.execute('INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?)',(key,stat.st_ino,offset,stat.st_size,stat.st_mtime_ns,json.dumps(state)))
    # A partial final line is not a reason to spin forever in preferences.
    more=offset<stat.st_size and (offset-start>=budget or time.monotonic()>=deadline)
    return offset-start,more


def scan_opencode(db, path, deadline):
    if not path.is_file(): return False
    marker='sqlite:'+str(path.resolve())
    prior=db.execute('SELECT state FROM files WHERE path=?',(marker,)).fetchone()
    state=json.loads(prior[0]) if prior else {};stamp=state.get('updated',0);last_id=state.get('id','')
    try:
        with sqlite3.connect(path.absolute().as_uri()+'?mode=ro',uri=True,timeout=.2) as source:
            source.execute('PRAGMA query_only=ON')
            rows=source.execute('SELECT id,session_id,time_created,time_updated,data FROM message WHERE time_updated>? OR (time_updated=? AND id>?) ORDER BY time_updated,id LIMIT 2000',(stamp,stamp,last_id))
            count=0
            for key,session,created,updated,raw in rows:
                if time.monotonic()>=deadline: return True
                count+=1;state={'updated':updated,'id':key}
                try:
                    row=json.loads(raw);tokens=row.get('tokens') or {};cache=tokens.get('cache') or {}
                    if row.get('role')!='assistant' or integer(tokens.get('input')) is None or integer(tokens.get('output')) is None: continue
                    timing=row.get('time') or {}
                    # Only completed messages have final token counters.
                    if not timing.get('completed'): continue
                    project_row=source.execute('SELECT directory FROM session WHERE id=?',(session,)).fetchone()
                    entry=event('opencode',key,row.get('modelID'),project_row[0] if project_row else '',timestamp(timing.get('created') or created),
                                dict(input=tokens['input'],output=tokens['output']+(integer(tokens.get('reasoning')) or 0),cacheRead=cache.get('read',0),cacheWrite=cache.get('write',0)))
                    put(db,entry)
                except (ValueError,TypeError,AttributeError): continue
            return count==2000
    except sqlite3.Error: return False
    finally:
        db.execute('INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?)',(marker,0,0,0,0,json.dumps(state)))


def clean_prices(value):
    if not isinstance(value,dict): return {}
    out={}
    for model,rates in value.items():
        if not isinstance(model,str) or not isinstance(rates,dict): continue
        parsed={k:number(rates.get(k)) for k in COUNTERS}
        if all(v is not None and v>=0 for v in parsed.values()): out[model[:120]]=parsed
    return out


def summary(db, prices, days=365, now=None, excluded=()):
    today=datetime.fromtimestamp(time.time() if now is None else now).date();first=today-timedelta(days=days-1)
    since=datetime.combine(first,datetime.min.time()).timestamp()
    daily={};models={};total=0;priced=0;estimated=0.0;sources=set()
    for source,model,project,at,inp,out,read,write in db.execute('SELECT source,model,project,at,input,output,cacheRead,cacheWrite FROM events WHERE at>=? ORDER BY at',(since,)):
        if source in excluded: continue
        day=datetime.fromtimestamp(at).date().isoformat()
        if day>today.isoformat(): continue
        counts=dict(zip(COUNTERS,(inp,out,read,write)));tokens=sum(counts.values());rates=prices.get(model)
        cost=sum(counts[k]*rates[k] for k in COUNTERS)/1e6 if rates else None
        sources.add(source);total+=tokens
        if cost is not None: priced+=tokens;estimated+=cost
        item=daily.setdefault(day,dict(date=day,tokens=0,records=0,models={},sources=set()))
        item['tokens']+=tokens;item['records']+=1;item['sources'].add(source)
        for target,key in ((models,model),(item['models'],model)):
            bucket=target.setdefault(key,dict(model=model,tokens=0,records=0,estimatedCost=0.0,unpricedTokens=0,**{k:0 for k in COUNTERS}))
            bucket['tokens']+=tokens;bucket['records']+=1
            for k in COUNTERS: bucket[k]+=counts[k]
            if cost is None: bucket['unpricedTokens']+=tokens
            else: bucket['estimatedCost']+=cost
    for item in daily.values():
        item['sources']=sorted(item['sources']);item['models']=sorted(item['models'].values(),key=lambda m:-m['tokens'])
    return dict(days=sorted(daily.values(),key=lambda d:d['date']),models=sorted(models.values(),key=lambda m:-m['tokens']),
                tokens=total,estimatedCost=estimated if priced else None,unpricedTokens=total-priced,sources=sorted(sources),
                fromDate=first.isoformat(),toDate=today.isoformat(),timezone=time.tzname[0])


def collect(root, providers, data, settings, enabled, refresh=True):
    if not settings.get('usageHistory'):
        return dict(enabled=False,days=[],models=[],tokens=0,sources=[])
    root.mkdir(mode=0o700,parents=True,exist_ok=True)
    path=root/'history.sqlite';fd=os.open(path,os.O_CREAT|os.O_RDWR,0o600);os.close(fd);os.chmod(path,0o600)
    with sqlite3.connect(path,timeout=2) as db:
        db.executescript(SCHEMA);more=False;scanned=0
        if refresh:
            deadline=time.monotonic()+2
            for file,source in paths(providers,data,enabled):
                if scanned>=MAX_BYTES or time.monotonic()>=deadline: more=True;break
                read,pending=scan_file(db,file,source,deadline,MAX_BYTES-scanned);scanned+=read;more|=pending
            if any(p.kind=='opencode' and enabled(p) for p in providers):
                more|=scan_opencode(db,data/'opencode/opencode.db',deadline)
            db.commit()
        result=summary(db,settings.get('modelPrices',{}),settings.get('historyDays',365),excluded=settings.get('disabled',[]))
        return dict(result,enabled=True,more=more,scannedBytes=scanned,
                    coverage=['Claude Code JSONL','Codex JSONL','OpenCode SQLite','Versioned JSONL imports'],
                    note='Local records only. Missing days mean no recorded data, not zero usage. Cost estimates use your configured USD API prices, not subscription charges.')
