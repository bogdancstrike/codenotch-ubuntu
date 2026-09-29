import assert from 'node:assert/strict';
import {usageStats,costText,shiftDate,sourceName} from '../extension/history-model.js';
const row=(date,source,model,input,cached,priced=true)=>({date,source,model,input,output:0,cacheRead:cached,cacheWrite:0,
    tokens:input+cached,records:1,pricedRecords:priced?1:0,estimatedCost:priced?input/100:0,unpricedTokens:priced?0:input+cached,
    hours:Array.from({length:24},(_,i)=>i===14?input+cached:0)});
const report={enabled:true,fromDate:'2026-08-01',toDate:'2026-09-29',breakdown:[
    row('2026-09-29','claude','a',10,90),row('2026-09-28','codex','a',20,0),
    row('2026-09-28','claude','b',30,0,false),row('2026-09-26','claude','a',40,0),
    row('2026-08-01','claude','a',1000,0)]};
let stats=usageStats(report,{span:7});
assert.equal(stats.tokens,190);assert.equal(stats.days.length,7);assert.equal(stats.activeDays,3);
assert.equal(stats.currentStreak,2);assert.equal(stats.longestStreak,2);assert.equal(stats.peakHour,14);
assert.equal(stats.cacheShare,90/190);assert.equal(stats.busiest.date,'2026-09-29');
assert.equal(stats.agents.reduce((s,a)=>s+a.tokens,0),stats.tokens);
assert.equal(stats.models.reduce((s,a)=>s+a.tokens,0),stats.tokens);
assert.equal(stats.months.reduce((s,a)=>s+a.tokens,0),stats.tokens);
assert.equal(stats.hours.reduce((s,a)=>s+a,0),stats.tokens);
assert.equal(stats.days[0].recorded,false);assert.match(costText(stats),/partial/);
stats=usageStats(report,{span:7,source:'claude',model:'a'});
assert.equal(stats.tokens,140);assert.equal(stats.unpricedTokens,0);assert.equal(stats.currentStreak,1);
assert.equal(stats.models.length,1);assert.equal(stats.agents.length,1);
assert.equal(usageStats(report,{span:7,source:'codex',model:'b'}).tokens,0);
assert.equal(costText(usageStats(report,{span:7,model:'b'})),'Unpriced');
const zero=usageStats({...report,breakdown:[row('2026-09-29','claude','free',0,0)]});
assert.notEqual(costText(zero),'Unpriced');assert.equal(zero.activeDays,0);assert.equal(zero.peakHour,null);
assert.equal(zero.days.at(-1).recorded,true);
assert.equal(usageStats({...report,enabled:false}).tokens,0);
assert.equal(usageStats({...report,breakdown:[]}).busiest,null);
assert.equal(usageStats({...report,toDate:'2026-09-30'},{span:7}).currentStreak,2);
assert.equal(usageStats({...report,toDate:'2026-10-01'},{span:7}).currentStreak,0);
assert.equal(usageStats({...report,fromDate:'2026-09-28'},{span:365}).days.length,2);
assert.equal(shiftDate('2026-03-01',-1),'2026-02-28');
assert.equal(shiftDate('2024-03-01',-1),'2024-02-29');
assert.equal(shiftDate('2026-01-01',-1),'2025-12-31');
assert.equal(shiftDate('2026-03-08',1),'2026-03-09');
assert.equal(sourceName('constructor'),'constructor');
assert.equal(sourceName('__proto__'),'__proto__');
assert.equal(usageStats({...report,breakdown:[row('2026-09-29','constructor','__proto__',1,0)]}).agents[0].label,'constructor');
console.log('Usage aggregation, filters, cost coverage, sparse days, streaks and calendar boundaries passed.');

assert.notEqual(costText({pricedRecords:1,estimatedCost:.003,unpricedTokens:0}),'$0.00');
assert.equal(costText({pricedRecords:1,estimatedCost:.000001,unpricedTokens:0}),'<$0.0001');
