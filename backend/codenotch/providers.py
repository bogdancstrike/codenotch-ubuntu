"""Read-only Linux adapters for upstream's provider endpoints.

Import cost matters here: the worker is spawned every few seconds and usually
has nothing due. urllib/ssl/sqlite3/dataclasses together cost more CPU than the
rest of a no-op run, so they are imported only on the paths that need them.
"""
import json
import os
import time
import urllib.parse
from pathlib import Path
from .model import ProviderError, PARSERS, timestamp

MAX_BYTES=4*1024*1024
CLOUD_QUOTA='https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary'

def read_json(path):
    try:
        with Path(path).open('rb') as f: data=f.read(MAX_BYTES+1)
        if len(data)>MAX_BYTES: return {}
        value=json.loads(data)
        return value if isinstance(value,dict) else {}
    except (OSError, ValueError): return {}

def sqlite_rows(path, sql, args=()):
    if not Path(path).is_file(): return []
    import sqlite3
    try:
        # Do NOT use immutable=1: it would ignore a running editor's WAL.
        with sqlite3.connect(Path(path).absolute().as_uri()+'?mode=ro', uri=True, timeout=0.2) as db:
            db.execute('PRAGMA query_only=ON')
            return db.execute(sql,args).fetchmany(100)
    except sqlite3.Error: return []

def secret(value):
    if isinstance(value,str) and value.strip() and '\n' not in value and '\r' not in value: return value.strip()
    return None

def pick_key(entry):
    if secret(entry): return secret(entry)
    if isinstance(entry,dict):
        return next((secret(entry.get(k)) for k in ['key','apiKey','api_key','token','accessToken','access_token','auth_token'] if secret(entry.get(k))),None)
    return None

def auth_error():
    raise ProviderError('needsAuth','Open the owning tool and sign in, then refresh here.')

def check_expiry(value):
    expiry=timestamp(value)
    if expiry and expiry<=time.time():
        raise ProviderError('expired','Saved login expired. Open the owning tool to refresh it.')

_redirect_handler=None
def no_redirect():
    """Built on first use so importing this module does not pull in urllib."""
    global _redirect_handler
    if _redirect_handler is None:
        import urllib.request
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                # Never forward a borrowed credential to a redirect destination.
                raise ProviderError('error','The usage endpoint redirected. Update Codenotch to check the new endpoint.')
        _redirect_handler=NoRedirect
    return _redirect_handler

def __getattr__(name):
    if name=='NoRedirect': return no_redirect()
    raise AttributeError(name)

def request_json(url, headers, body=None, local=False):
    import ssl, urllib.error, urllib.request
    parsed=urllib.parse.urlparse(url)
    if parsed.scheme!='https': raise ProviderError('error','HTTPS is required.')
    context=ssl.create_default_context()
    if local:
        if parsed.hostname!='127.0.0.1': raise ProviderError('error','Local bridge must use loopback.')
        # Only the discovered, current user's LS port uses a self-signed certificate.
        context.check_hostname=False; context.verify_mode=ssl.CERT_NONE
    handlers=[no_redirect()(),urllib.request.HTTPSHandler(context=context)]
    if local: handlers.append(urllib.request.ProxyHandler({}))
    opener=urllib.request.build_opener(*handlers)
    req=urllib.request.Request(url,headers={'Accept':'application/json','User-Agent':'Codenotch-Ubuntu/0.2',**headers},data=json.dumps(body).encode() if body is not None else None)
    try:
        with opener.open(req,timeout=5 if local else 15) as response:
            raw=response.read(MAX_BYTES+1)
        if len(raw)>MAX_BYTES: raise ProviderError('error','Usage response exceeds the size limit.')
        data=json.loads(raw)
        if not isinstance(data,dict): raise ValueError()
        return data
    except urllib.error.HTTPError as e:
        if e.code==401: auth_error()
        if e.code==403: raise ProviderError('forbidden','The provider refused this account for usage reads.')
        if e.code==429:
            raw=e.headers.get('Retry-After','0')
            try: retry=float(raw)
            except ValueError:
                try:
                    from email.utils import parsedate_to_datetime
                    retry=max(0,parsedate_to_datetime(raw).timestamp()-time.time())
                except (ValueError,TypeError,OverflowError): retry=0
            raise ProviderError('rateLimited','Provider rate limited requests; waiting before retrying.',retry)
        raise ProviderError('error',f'Usage endpoint returned HTTP {e.code}.')
    except (urllib.error.URLError,TimeoutError,OSError):
        raise ProviderError('offline','Could not reach the provider. Last successful reading is retained.')
    except (ValueError,TypeError):
        raise ProviderError('error','The usage response format was not recognized.')

class Provider:
    __slots__=('id','name','kind','path')
    def __init__(self, id, name, kind, path):
        self.id, self.name, self.kind, self.path = id, name, kind, path
    def __repr__(self):
        return f'Provider({self.id!r}, {self.kind!r})'
    def __eq__(self, other):
        return isinstance(other,Provider) and (self.id,self.name,self.kind,self.path)==(other.id,other.name,other.kind,other.path)
    def meta(self):
        return dict(id=self.id,name=self.name,kind=self.kind,glyph={'codex':'openai','gemini':'antigravity'}.get(self.kind,self.kind))
    def fetch(self, home, config, data):
        headers={}; body=None; local=False
        if self.kind=='claude':
            entry=read_json(self.path/'.credentials.json').get('claudeAiOauth') or {}
            token=secret(entry.get('accessToken')); check_expiry(entry.get('expiresAt'))
            url='https://api.anthropic.com/api/oauth/usage'; headers['anthropic-beta']='oauth-2025-04-20'
        elif self.kind=='codex':
            entry=read_json(self.path/'auth.json').get('tokens') or {}
            token=secret(entry.get('access_token'))
            account=secret(entry.get('account_id'))
            if account: headers['ChatGPT-Account-Id']=account
            url='https://chatgpt.com/backend-api/wham/usage'; headers['Cache-Control']='no-cache, no-store'
        elif self.kind=='cursor':
            values=dict(sqlite_rows(self.path,'SELECT key,value FROM ItemTable WHERE key IN (?,?)',('cursorAuth/accessToken','cursorAuth/stripeMembershipAuthId')))
            token=secret(values.get('cursorAuth/accessToken')); account=secret(values.get('cursorAuth/stripeMembershipAuthId'))
            if not token or not account: auth_error()
            headers['Cookie']=f'WorkosCursorSessionToken={account}::{token}'
            token=None; url='https://cursor.com/api/usage-summary'
        elif self.kind=='glm':
            found=glm_key(home,config,data)
            if not found: auth_error()
            key,host=found; token=None; headers['Authorization']=key
            url=host+'/api/monitor/usage/quota/limit'
        elif self.kind=='grok':
            entries=[v for k,v in read_json(self.path).items() if isinstance(v,dict) and (k=='https://auth.x.ai' or k.startswith('https://auth.x.ai::') or v.get('oidc_issuer')=='https://auth.x.ai')]
            entries.sort(key=lambda e: (timestamp(e.get('expires_at')) or float('inf'))<=time.time())
            if not entries: auth_error()
            token=secret(entries[0].get('key')); check_expiry(entries[0].get('expires_at'))
            url='https://cli-chat-proxy.grok.com/v1/billing?format=credits'
        elif self.kind=='opencode':
            token=pick_key(read_json(self.path).get('opencode-go')); url='https://opencode.ai/zen/go/v1/usage'
        elif self.kind=='gemini':
            return antigravity_quota(home,config)
        else: raise ProviderError('error','Unknown provider.')
        if self.kind not in ('cursor','glm') and not token: auth_error()
        if token: headers['Authorization']='Bearer '+token
        return PARSERS[self.kind](request_json(url,headers,body,local),time.time())

def glm_key(home,config,data):
    for path in [home/'.claude/settings.json', *sorted(home.glob('.claude-*/settings.json'))]:
        env=read_json(path).get('env') or {}
        host=urllib.parse.urlparse(str(env.get('ANTHROPIC_BASE_URL',''))).hostname or ''
        if host in ('api.z.ai','open.bigmodel.cn') or host.endswith(('.z.ai','.bigmodel.cn')):
            key=secret(env.get('ANTHROPIC_AUTH_TOKEN')) or secret(env.get('ANTHROPIC_API_KEY'))
            if key: return key, 'https://open.bigmodel.cn' if host.endswith('bigmodel.cn') else 'https://api.z.ai'
    auth=read_json(data/'opencode/auth.json')
    for id in ('zai-coding-plan','zai','z-ai','z.ai','zhipu','zhipuai'):
        key=pick_key(auth.get(id))
        if key: return key,'https://open.bigmodel.cn' if id.startswith('zhipu') else 'https://api.z.ai'
    for path in [config/'zcode/config.json',home/'.zcode/config.json']:
        for id,entry in (read_json(path).get('provider') or {}).items():
            if not isinstance(entry,dict) or 'coding-plan' not in id or entry.get('enabled') is False: continue
            options=entry.get('options') or {}; key=secret(options.get('apiKey'))
            host=urllib.parse.urlparse(str(options.get('baseURL','https://api.z.ai'))).hostname
            if key and host in ('api.z.ai','open.bigmodel.cn'): return key,'https://'+host
    return None

def claude_profile(path):
    """A Claude Code profile owns a login or its own settings; ~/.claude-flow and
    friends are other tools' data directories and must not become empty rings."""
    return any((path/name).exists() for name in ('.credentials.json','settings.json','sessions','statsig'))

def discover(home,config,data):
    profiles=[home/'.claude']
    extra=sorted(p for p in home.glob('.claude-*') if p.is_dir() and claude_profile(p))
    custom=os.environ.get('CLAUDE_CONFIG_DIR')
    if custom and Path(custom).expanduser() not in profiles+extra: extra.append(Path(custom).expanduser())
    profiles+=extra
    out=[Provider('claude' if i==0 else 'claude:'+p.name,'Claude' if i==0 else f'Claude ({p.name.removeprefix(".claude-")})','claude',p) for i,p in enumerate(profiles)]
    codex_path=Path(os.environ.get('CODEX_HOME',str(home/'.codex'))).expanduser()
    out.extend([
        Provider('codex','Codex','codex',codex_path),
        Provider('cursor','Cursor','cursor',config/'Cursor/User/globalStorage/state.vscdb'),
        Provider('gemini','Antigravity','gemini',home/'.gemini'),
        Provider('glm','GLM','glm',home),
        Provider('grok','Grok','grok',home/'.grok/auth.json'),
        Provider('opencode','OpenCode','opencode',data/'opencode/auth.json'),
    ])
    return out

def detected(provider,home,config,data):
    if provider.kind=='claude': return (provider.path/'.credentials.json').is_file()
    if provider.kind=='codex': return (provider.path/'auth.json').is_file()
    if provider.kind=='glm': return bool(glm_key(home,config,data))
    if provider.kind=='gemini': return antigravity_signed_in(home,config)
    return provider.path.exists()

def antigravity_signed_in(home,config):
    """True for the Antigravity IDE or an installed `agy` CLI.

    Filesystem evidence only. The CLI keeps its Google login in the session
    keyring, and touching that costs a gi import plus a DBus round trip, so it
    is left to the quota request that actually needs the token."""
    if (config/'Antigravity').exists(): return True
    cli=home/'.gemini/antigravity-cli'
    return cli.is_dir() and any((cli/name).exists() for name in ('cache','settings.json','conversations'))

def keyring_token(peek=False):
    """Read the agy CLI's Google access token from the session keyring.

    `peek` only reports whether the item exists, so ordinary polling never pulls
    the secret out of the keyring. Nothing is written, refreshed, or cached."""
    try:
        import gi
        gi.require_version('Secret','1')
        from gi.repository import Secret
    except (ImportError,ValueError): return None
    attributes={'service':'gemini','username':'antigravity'}
    flags=Secret.SearchFlags.UNLOCK if peek else Secret.SearchFlags.UNLOCK|Secret.SearchFlags.LOAD_SECRETS
    try:
        items=Secret.password_search_sync(None,attributes,flags,None)
        if not items: return None
        if peek: return True
        value=items[0].retrieve_secret_sync(None)
        entry=json.loads(value.get_text() if value else '{}').get('token') or {}
        token=secret(entry.get('access_token'))
        if token and timestamp(entry.get('expiry')) and timestamp(entry.get('expiry'))<=time.time():
            raise ProviderError('expired','Antigravity’s saved login expired. Run `agy` once to refresh it.')
        return token
    except ProviderError: raise
    except Exception: return None

def agy_cli_quota(home):
    """Query the agy CLI directly in non-interactive print mode."""
    import shutil, subprocess
    cmd = shutil.which('agy')
    if not cmd:
        for p in (home/'.local/bin/agy', Path('/usr/local/bin/agy'), Path('/usr/bin/agy')):
            if p.is_file() and os.access(p, os.X_OK):
                cmd = str(p); break
    if not cmd: return None
    try:
        res = subprocess.run([cmd, '-p', '/quota', '--output-format', 'json'],
                             capture_output=True, text=True, timeout=12)
        if res.returncode == 0 and res.stdout.strip():
            data = json.loads(res.stdout)
            return PARSERS['gemini'](data, time.time())
    except (subprocess.SubprocessError, ValueError, KeyError, OSError, ProviderError):
        pass
    return None

def antigravity_quota(home,config):
    """Prefer the running language server; fall back to the CLI, then cloud quota."""
    endpoints=bridge_endpoints()
    for port,token in endpoints:
        try:
            body=request_json(f'https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary',{'x-codeium-csrf-token':token,'Content-Type':'application/json'},{'forceRefresh':True},True)
            return PARSERS['gemini'](body,time.time())
        except ProviderError: pass
    windows=agy_cli_quota(home)
    if windows: return windows
    token=keyring_token()
    if token:
        try:
            body=request_json(CLOUD_QUOTA,{'Authorization':'Bearer '+token,'Content-Type':'application/json'},{})
            return PARSERS['gemini'](body,time.time())
        except ProviderError as err:
            if err.status=='forbidden':
                raise ProviderError('unavailable','Signed in to Antigravity, but Google does not expose this account’s allowance to other apps. Start Antigravity to read the local quota.')
            raise
    if (config/'Antigravity').exists():
        raise ProviderError('unavailable','Start Antigravity to publish its local quota service.')
    auth_error()

def bridge_endpoints(proc=Path('/proc')):
    """Only inspect same-UID Antigravity servers; map owned socket inodes to ports."""
    out=[]
    for directory in proc.iterdir():
        if not directory.name.isdigit(): continue
        try:
            if directory.stat().st_uid!=os.getuid(): continue
            args=(directory/'cmdline').read_bytes().decode(errors='replace').split('\0')
            joined=' '.join(args)
            lowered=joined.lower()
            if not (('language_server' in joined and 'antigravity' in lowered) or ('jetski' in lowered and '--csrf_token' in joined)): continue
            token=None
            for i,arg in enumerate(args):
                if arg=='--csrf_token' and i+1<len(args): token=secret(args[i+1])
                elif arg.startswith('--csrf_token='): token=secret(arg.split('=',1)[1])
            if not token: continue
            sockets=set()
            for fd in (directory/'fd').iterdir():
                try: sockets.add(os.readlink(fd))
                except OSError: pass
            ports=set()
            for filename in ('tcp','tcp6'):
                for line in (directory/'net'/filename).read_text().splitlines()[1:]:
                    fields=line.split()
                    if fields[3]=='0A' and 'socket:['+fields[9]+']' in sockets:
                        ports.add(int(fields[1].split(':')[1],16))
            for port in sorted(ports): out.append((port,token))
        except (OSError,ValueError,IndexError): continue
    return out[:8]

def local_quota():
    return antigravity_quota(Path.home(),Path.home()/'.config')
