// Pure presentation rules shared by the notch, panel and tests.
export function headline(provider, settings={}) {
    const windows=(provider.windows??[]).filter(w=>Number.isFinite(w.fraction)&&w.fraction>=0);
    const pin=settings.pinnedWindows?.[provider.id];
    return windows.find(w=>w.id===pin)??windows.reduce((best,w)=>!best||w.fraction>best.fraction?w:best,null);
}
