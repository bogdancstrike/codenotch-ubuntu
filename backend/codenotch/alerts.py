"""Pure alert transitions. Persist memory under the worker's polling lock."""
import math


def evaluate(rows, settings, memory, now):
    enabled = settings.get('notifyQuota') or settings.get('notifyFailures') or settings.get('notifyReset') or settings.get('notifySessions')
    if not enabled:
        return {'accounts': {}, 'pending': [], 'serial': memory.get('serial', 0)}
    accounts = memory.setdefault('accounts', {})
    pending = [e for e in memory.get('pending', []) if 0 <= now-e['createdAt'] < 3600]
    serial = memory.get('serial', 0)

    def emit(row, message, title=None):
        nonlocal serial
        serial += 1
        pending.append(dict(id=str(serial), account=row['id'], title=title or row['name'], message=message, createdAt=now))

    live_ids = {r['id'] for r in rows if r.get('enabled')}
    accounts = {key:value for key,value in accounts.items() if key in live_ids}
    pending = [e for e in pending if e['account'] in live_ids]
    for row in rows:
        if not row.get('enabled'):
            continue
        state = accounts.setdefault(row['id'], {'windows': {}, 'outage': False})
        if settings.get('notifyFailures') and row.get('failures', 0) >= 3 and not state['outage']:
            emit(row, 'Usage checks have repeatedly failed. Open Connections to verify the sign-in.')
            state['outage'] = True
        if row.get('status') != 'ok' or not 0 <= now-row.get('updatedAt', 0) <= 86400:
            continue
        state['outage'] = False
        for w in row.get('windows', []):
            fraction=w.get('fraction'); reset=w.get('resetsAt')
            if not isinstance(fraction,(int,float)) or not math.isfinite(fraction) or (reset and reset <= now):
                continue
            old=state['windows'].get(w['id'], {})
            renewed=(reset and old.get('reset') and reset > old['reset']+60) or fraction <= old.get('fraction',fraction)-.4
            warned=old.get('warned',0)
            if renewed:
                if warned and settings.get('notifyReset'):
                    emit(row, f"{w['label']} is available again.")
                warned=0
            threshold=settings.get('notifyThreshold',90)/100
            step=100 if fraction >= 1 else settings.get('notifyThreshold',90) if fraction >= threshold else 0
            if step > warned and settings.get('notifyQuota'):
                emit(row, f"{w['label']}: {'included allowance used (overage enabled)' if step == 100 and w.get('overageAllowed') else 'allowance exhausted' if step == 100 else str(int(fraction*100))+'% used'}.")
                warned=step
            state['windows'][w['id']]={'fraction':fraction,'reset':reset,'warned':warned}
    sessions = session_transitions(rows, settings, memory.get('sessions'), live_ids, emit)
    return {'accounts':accounts,'pending':pending[-50:],'serial':serial,'sessions':sessions}


def session_transitions(rows, settings, seen, live_ids, emit):
    """Say when an agent stops working or starts waiting on you. Only a change
    seen between two scans counts: a session first met already idle, or
    Codenotch starting up beside one, announces nothing."""
    if not settings.get('notifySessions'):
        return {}
    seen = seen if isinstance(seen, dict) else {}
    current = {}
    for row in rows:
        if not row.get('enabled'):
            continue
        for s in row.get('sessions') or []:
            # Inferred activity (file mtimes) flickers; it would cry wolf.
            if not isinstance(s, dict) or s.get('derived') or s.get('state') not in ('busy', 'idle', 'waiting'):
                continue
            sid = s.get('key') or f"{row['id']}:{s.get('name')}"
            title = f"{row['name']} · {str(s.get('name') or 'Session')[:80]}"
            current[sid] = dict(state=s['state'], account=row['id'], title=title)
            before = (seen.get(sid) or {}).get('state')
            if before == 'busy' and s['state'] == 'idle':
                emit(row, 'Finished working.', title)
            elif before in ('busy', 'idle') and s['state'] == 'waiting':
                emit(row, 'Waiting for your input.', title)
    rows_by_id = {r['id']: r for r in rows}
    for sid, old in seen.items():
        # A working session that is simply gone has finished too (a Codex turn
        # that completes with no TUI open leaves no row behind).
        if sid not in current and isinstance(old, dict) and old.get('state') == 'busy' and old.get('account') in live_ids:
            emit(rows_by_id[old['account']], 'Finished working.', old.get('title'))
    return dict(list(current.items())[:100])
