// Pure presentation rules shared by the notch, panel and tests.
export function headline(provider, settings={}) {
    const windows=(provider.windows??[]).filter(w=>Number.isFinite(w.fraction)&&w.fraction>=0);
    const pin=settings.pinnedWindows?.[provider.id];
    return windows.find(w=>w.id===pin)??windows.reduce((best,w)=>!best||w.fraction>best.fraction?w:best,null);
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
