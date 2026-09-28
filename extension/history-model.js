// Calendar-only presentation; no filesystem, GI or network access.
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
