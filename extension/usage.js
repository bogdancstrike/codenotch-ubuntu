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
