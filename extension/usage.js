// Pure presentation rules shared by the notch, panel and tests.
export function headline(provider, settings={}) {
    const windows=(provider.windows??[]).filter(w=>Number.isFinite(w.fraction)&&w.fraction>=0);
    const pin=settings.pinnedWindows?.[provider.id];
    const pinned=windows.find(w=>w.id===pin);
    if(pinned)return pinned;
    // Prefer the current five-hour session over weekly limits, never a
    // model/review subquota: Claude names it 'session', Codex reports it as
    // a primary/secondary window lasting 18000 seconds.
    const codex=(provider.kind??provider.id?.split(':')[0])==='codex';
    const session=windows.find(w=>w.id==='session')
        ??windows.find(w=>!String(w.id??'').includes('.')&&w.windowSeconds===18000)
        ??(codex?windows.find(w=>w.id==='primary'):null);
    if(session)return session;
    return windows.reduce((best,w)=>!best||w.fraction>best.fraction?w:best,null);
}

export function percentText(fraction, settings={}, suffix=false) {
    if(!Number.isFinite(fraction))return '—';
    const remaining=settings.quotaDisplay==='remaining';
    const value=remaining?Math.max(0,1-fraction):fraction;
    // 99.6% is not exhausted. Preserve that distinction at the display boundary.
    const percent=value>0&&value<.01?'<1':fraction<1&&!remaining?Math.floor(value*100):Math.round(value*100);
    return `${percent}%${suffix?(remaining?' left':' used'):''}`;
}

export function elapsedWindow(window, now=Date.now()/1000) {
    const duration=window?.windowSeconds,reset=window?.resetsAt;
    if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(reset))return null;
    const elapsed=1-(reset-now)/duration;
    return elapsed>=0&&elapsed<1?elapsed:null;
}

export function panelAccount(providers, settings={}) {
    const enabled=providers.filter(p=>p.enabled&&headline(p,settings));
    return enabled.find(p=>p.id===settings.panelAccount)??enabled.reduce((best,p)=>
        !best||headline(p,settings).fraction>headline(best,settings).fraction?p:best,null);
}

export function forecast(window, now=Date.now()/1000) {
    const elapsed=elapsedWindow(window,now),used=window?.fraction;
    if(elapsed===null||elapsed<.03||!Number.isFinite(used)||used<0)return null;
    if(used>=1)return 'Allowance exhausted';
    if(used===0)return 'Estimated to last until reset';
    const elapsedSeconds=window.windowSeconds*elapsed;
    const secondsLeft=(1-used)*elapsedSeconds/used;
    if(secondsLeft>=window.resetsAt-now)return 'Estimated to last until reset';
    if(secondsLeft<=7200)return `May run out in ~${Math.max(1,Math.round(secondsLeft/60))} min`;
    return 'May run out before reset';
}

// ------------------------------------------------------------- ring order
const WEEK=604800;
/** The weekly window shown as a second ring, never the headline itself. */
export function weeklyWindow(provider, settings={}) {
    const main=headline(provider,settings);
    const windows=(provider.windows??[]).filter(w=>w!==main&&Number.isFinite(w.fraction)&&w.fraction>=0);
    const plain=w=>!String(w.id??'').includes('.');
    return windows.find(w=>plain(w)&&Math.abs((w.windowSeconds??0)-WEEK)<=86400)
        ??windows.find(w=>['weekly_all','weekly','seven_day','limit_7d'].includes(w.id))
        ??windows.find(w=>plain(w)&&/week/i.test(`${w.id} ${w.label}`))??null;
}

/** Spent rings sink: the headline, or a weekly allowance, is used up. */
function spent(p, settings, now) {
    const live=w=>w&&w.fraction>=1&&!w.overageAllowed&&(!w.resetsAt||w.resetsAt>now);
    return live(headline(p,settings))||live(weeklyWindow(p,settings));
}

/**
 * In what order the notch draws its rings.
 *  manual    — `providerOrder`, then anything new in discovery order
 *  remaining — most left of the headline window first
 *  deficit   — remaining quota minus remaining time, highest first: 70% left
 *              with 23h of a week to go outranks 100% left with 6 days to go
 *  expiring  — the headline window that resets soonest first
 * Under every automatic sort, spent and unmeasured rings sink below usable ones.
 */
export function orderProviders(providers, settings={}, now=Date.now()/1000) {
    const mode=settings.ringOrder??'manual';
    const manual=settings.providerOrder??[];
    const position=p=>{const i=manual.indexOf(p.id);return i<0?manual.length+providers.indexOf(p):i;};
    if(mode==='manual')return [...providers].sort((a,b)=>position(a)-position(b));
    const score=p=>{
        const w=headline(p,settings);
        if(!w)return [2,0];
        if(spent(p,settings,now))return [1,0];
        const left=1-w.fraction;
        if(mode==='remaining')return [0,-left];
        const until=Number.isFinite(w.resetsAt)&&w.resetsAt>now?w.resetsAt-now:Infinity;
        if(mode==='expiring')return [0,until];
        const span=w.windowSeconds;
        if(!Number.isFinite(span)||span<=0||until===Infinity)return [0,1-left];   // unknown pace: after measurable deficits
        return [0,-(left-until/span)];
    };
    return providers.map(p=>[p,score(p)]).sort((a,b)=>a[1][0]-b[1][0]||a[1][1]-b[1][1]||position(a[0])-position(b[0])).map(r=>r[0]);
}
