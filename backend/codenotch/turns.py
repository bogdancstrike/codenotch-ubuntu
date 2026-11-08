"""Bounded transcript inspection; only lifecycle metadata leaves this module."""
import json
import time
from .model import timestamp

TAIL_BYTES=131072

def tail_records(path):
    try:
        with path.open('rb') as stream:
            size=stream.seek(0,2);start=max(0,size-TAIL_BYTES);stream.seek(start)
            if start: stream.readline()
            raw=stream.read(TAIL_BYTES)
        # An incomplete final line belongs to the next scan.
        for line in raw.splitlines(keepends=True):
            if not line.endswith(b'\n'): continue
            try:
                value=json.loads(line)
                if isinstance(value,dict): yield value
            except (ValueError,UnicodeError): continue
    except OSError:
        return

def codex_turn(path, now=None):
    now=time.time() if now is None else now
    state=None;stamp=None;waiting_tool=False
    for record in tail_records(path):
        payload=record.get('payload') or {}
        if not isinstance(payload,dict): continue
        kind=payload.get('type')
        when=timestamp(record.get('timestamp'))
        if record.get('type')=='event_msg':
            if kind=='task_started': state='busy';waiting_tool=False;stamp=when
            elif kind in ('task_complete','turn_aborted'): state='idle';stamp=when
        elif record.get('type')=='response_item':
            if kind in ('function_call','custom_tool_call'):
                state='busy';waiting_tool=True;stamp=when
            elif kind in ('function_call_output','custom_tool_call_output'):
                state='busy';waiting_tool=False;stamp=when
    # Abandoned turns must eventually stop. Slow tools get a longer grace period.
    if state!='busy' or stamp is None or not 0 <= now-stamp <= (1800 if waiting_tool else 300):
        return None
    return dict(name='Codex',detail='Tool running' if waiting_tool else 'Turn in progress',state='busy',since=stamp,derived=False)


def claude_turn(path, now=None):
    now=time.time() if now is None else now
    busy=False;tool=False;stamp=None
    for row in tail_records(path):
        typ=row.get('type');when=timestamp(row.get('timestamp'))
        if typ=='assistant':
            reason=(row.get('message') or {}).get('stop_reason')
            if reason in ('end_turn','stop_sequence','max_tokens'): busy=False
            elif reason=='tool_use': busy=True;tool=True
            else: continue
            stamp=when
        elif typ=='user':
            # Interruptions are terminal records, not new prompts.
            content=(row.get('message') or {}).get('content')
            interrupted=isinstance(content,str) and content.startswith('[Request interrupted by user')
            if isinstance(content,list): interrupted=any(isinstance(p,dict) and str(p.get('text','')).startswith('[Request interrupted by user') for p in content)
            busy=not interrupted;tool=False;stamp=when
    if not busy or stamp is None or not 0<=now-stamp<=(1800 if tool else 300): return None
    return dict(name='Claude',detail='Tool running' if tool else 'Turn in progress',state='busy',since=stamp,derived=False)


def claude_title(path):
    """What a Claude Code session is called: its `/rename` name, else the title
    Claude Code generated. The registry's own name is the folder plus two
    characters, so three sessions in one project would read as one.

    A rename beats a newer generated title: Claude Code keeps appending
    `ai-title` after a `/rename`, and the chosen name is the one people look for."""
    generated=None
    for row in reversed(list(tail_records(path))):
        kind=row.get('type')
        if kind=='custom-title':
            title=str(row.get('customTitle') or '').strip()
            if title: return title[:120]
        elif kind=='ai-title' and generated is None:
            title=str(row.get('aiTitle') or '').strip()
            if title: generated=title[:120]
    return generated
