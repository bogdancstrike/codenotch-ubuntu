"""Non-secret account configuration; credentials stay in the owning tool's files."""
from pathlib import Path
import re

KINDS=('claude','codex','grok')

def profiles(value):
    out=[];seen=set()
    for row in value if isinstance(value,list) else []:
        if not isinstance(row,dict): continue
        key=row.get('id');kind=row.get('kind');path=row.get('path');name=row.get('name')
        if not isinstance(key,str) or not re.fullmatch(r'[a-zA-Z0-9_.-]{1,60}',key) or key in seen: continue
        if kind not in KINDS or not isinstance(path,str) or not Path(path).expanduser().is_absolute(): continue
        seen.add(key)
        out.append(dict(id=key,kind=kind,path=str(Path(path).expanduser()),name=(name.strip()[:60] if isinstance(name,str) else '') or key))
    return out[:32]

def labels(value):
    return {k:v.strip()[:60] for k,v in value.items() if isinstance(k,str) and isinstance(v,str) and v.strip()} if isinstance(value,dict) else {}
