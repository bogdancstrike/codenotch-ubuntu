// Pure calendar and analytics calculations; no filesystem, GI or network access.
export function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function calendarDays(report, today=new Date()) {
    const end=new Date(today.getFullYear(),today.getMonth(),today.getDate());
    const start=new Date(end);start.setDate(start.getDate()-364);
    start.setDate(start.getDate()-((start.getDay()+6)%7));
    const rows=new Map((report.days??[]).map(day=>[day.date,day]));
    const max=Math.max(1,...(report.days??[]).map(day=>day.tokens));
    const cells=[];
    for(const day=new Date(start);day<=end;day.setDate(day.getDate()+1)){
        const key=dateKey(day),row=rows.get(key),tokens=row?.tokens;
        const level=row?tokens===0?0:Math.max(1,Math.min(4,Math.ceil(Math.log1p(tokens)/Math.log1p(max)*4))):-1;
        cells.push({date:key,weekday:(day.getDay()+6)%7,month:day.getDate()===1?day.toLocaleDateString(undefined,{month:'short'}):'',level,tokens:tokens??null,row});
    }
    return cells;
}
export function compactCount(value) {
    return new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(value??0);
}

export const COUNTERS=['input','output','cacheRead','cacheWrite'];
const SOURCE_NAMES=new Map([['claude','Claude Code'],['codex','Codex'],['opencode','OpenCode']]);
export const sourceName=id=>SOURCE_NAMES.get(id)??id;
export function shiftDate(key,days) {
    const [year,month,day]=key.split('-').map(Number);
    return dateKey(new Date(year,month-1,day+days,12));
}
function emptyTotals() {
    return {tokens:0,records:0,input:0,output:0,cacheRead:0,cacheWrite:0,
        estimatedCost:0,unpricedTokens:0,pricedRecords:0,hours:Array(24).fill(0)};
}
function accumulate(target,row) {
    for(const key of ['tokens','records',...COUNTERS,'estimatedCost','unpricedTokens','pricedRecords'])target[key]+=row[key]??0;
    for(let hour=0;hour<24;hour++)target.hours[hour]+=row.hours?.[hour]??0;
}
export function formatUSD(value) {
    if(value>0&&value<.0001)return '<$0.0001';
    return new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:value>0&&value<.01?4:2}).format(value);
}
export function costText(row) {
    if(!row?.pricedRecords)return 'Unpriced';
    const amount=formatUSD(row.estimatedCost);
    return `${amount}${row.unpricedTokens>0?' (partial)':''}`;
}
// All views use these same filtered buckets, so drilldowns and totals reconcile.
export function usageStats(report,{span=30,source='',model=''}={}) {
    const to=report.toDate??dateKey(new Date());
    const from=[shiftDate(to,-span+1),report.fromDate??''].sort().at(-1);
    const buckets=report.enabled===false?[]:(report.breakdown??[]).filter(b=>
        b.date>=from&&b.date<=to&&(!source||b.source===source)&&(!model||b.model===model));
    const total=emptyTotals(),daily=new Map(),models=new Map(),agents=new Map(),months=new Map();
    for(const b of buckets){
        accumulate(total,b);
        for(const [map,key,label] of [[daily,b.date,b.date],[models,b.model,b.model],
            [agents,b.source,sourceName(b.source)],[months,b.date.slice(0,7),b.date.slice(0,7)]]){
            if(!map.has(key))map.set(key,{...emptyTotals(),id:key,label});
            accumulate(map.get(key),b);
        }
    }
    const days=[];
    for(let date=from;date<=to;date=shiftDate(date,1))days.push({date,...(daily.get(date)??emptyTotals()),recorded:daily.has(date)});
    const active=days.filter(d=>d.tokens>0);
    let longest=0,run=0;
    for(const day of days){run=day.tokens>0?run+1:0;longest=Math.max(longest,run);}
    // A streak may end yesterday while today's work has not started yet.
    let end=days.length-1;if(end>=0&&!days[end].tokens)end--;
    let current=0;for(let i=end;i>=0&&days[i].tokens>0;i--)current++;
    const byTokens=map=>[...map.values()].sort((a,b)=>b.tokens-a.tokens||a.label.localeCompare(b.label));
    const sortedModels=byTokens(models),sortedAgents=byTokens(agents);
    return {...total,from,to,days,models:sortedModels,agents:sortedAgents,months:byTokens(months).sort((a,b)=>b.id.localeCompare(a.id)),
        activeDays:active.length,recordedDays:daily.size,busiest:active.reduce((best,d)=>!best||d.tokens>best.tokens?d:best,null),
        currentStreak:current,longestStreak:longest,average:active.length?total.tokens/active.length:0,
        cacheShare:total.tokens?total.cacheRead/total.tokens:0,
        pricedShare:total.tokens?(total.tokens-total.unpricedTokens)/total.tokens:0,
        peakHour:total.hours.some(n=>n>0)?total.hours.indexOf(Math.max(...total.hours)):null,
        topModel:sortedModels[0]??null};
}

// Missing days add no records to the running total; their absence is not a measured zero.
export function chartSeries(stats) {
    let cumulative=0;
    const weekdays=Array.from({length:7},(_,i)=>({label:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i],value:null}));
    const running=stats.days.map(day=>{
        if(day.recorded){
            cumulative+=day.tokens;
            const [year,month,date]=day.date.split('-').map(Number);
            const index=(new Date(year,month-1,date,12).getDay()+6)%7;
            weekdays[index].value=(weekdays[index].value??0)+day.tokens;
        }
        return {label:day.date,value:stats.records?cumulative:null};
    });
    const mix=stats.days.map(day=>({label:day.date,value:day.recorded?day.tokens:null,parts:COUNTERS.map(key=>day[key])}));
    return {cumulative:running,weekdays,mix};
}
