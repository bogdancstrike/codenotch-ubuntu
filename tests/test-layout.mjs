import assert from 'node:assert/strict';
import {geometry,plan,point,band,P,D,W,cardLayout,widgetCard,widgetCardLayout,hitTest,resetCopy,
        clockParts,dateParts,spring,settled,stagger,clamp,tone,CONTRAST} from '../extension/render.js';

const EDGES=['right','left','top','bottom'];
const WIDGETS=['clock','date','weather','battery','system'];

// Every cell, divider, and the gear must stay inside the drawn silhouette.
for(const edge of EDGES)for(const count of [0,1,3,7,12])for(const widgets of [[],['clock'],WIDGETS]){
    const providers=Array.from({length:count},(_,i)=>({id:i,glyph:'claude',windows:[],sessions:[]}));
    const g=plan(providers,widgets,edge);
    assert(g.width>0&&g.height>0,'positive box');
    assert.equal(g.cells.length,count+widgets.length);
    for(const cell of g.cells){
        assert(cell.start>=0&&cell.start+cell.extent<=g.length,`cell inside ${edge}/${count}`);
        const [x,y]=point(g,edge,cell.center,g.depth/2);
        assert(x>=0&&x<=g.width&&y>=0&&y<=g.height);
    }
    for(let i=1;i<g.cells.length;i++)
        assert(g.cells[i].start>=g.cells[i-1].start+g.cells[i-1].extent,'cells never overlap');
    assert(g.gearAlong+D.gearCell/2<g.length,'gear fits before the flare');
    for(const at of g.dividers)assert(at>0&&at<g.gearAlong,'dividers precede the gear');
    // The gear is centred in its own cell, not pushed against the end.
    const [gx,gy]=point(g,edge,g.gearAlong,g.depth/2);
    assert.equal(hitTest(g,edge,gx,gy).kind,'gear');
    if(g.cells.length){
        const first=g.cells[0];
        const [cx,cy]=point(g,edge,first.center,g.depth/2);
        const hit=hitTest(g,edge,cx,cy);
        assert.equal(hit.index,0);
        assert.equal(hit.kind,count?'provider':'widget');
    }
}

// Backwards-compatible wrapper still answers the original questions.
const legacy=geometry(3,'right');
assert.equal(legacy.centers.length,3);
assert(legacy.divider<legacy.gearAlong);

// Folded sliver is small enough to never cover the desktop.
for(const edge of EDGES){
    const pill=plan([],[],edge,true);
    assert(pill.depth<12&&pill.length<90,'resting sliver stays a sliver');
}

assert.equal(D.ring,44);
assert.equal(band(.21),P.green);assert.equal(band(.52),P.yellow);assert.equal(band(.73),P.orange);
assert.equal(resetCopy(160,100),'Resets in 1 min');assert.equal(resetCopy(0,100),'');
assert(cardLayout({windows:[],sessions:Array(20).fill({})},250).sessions.length<20);

// Widgets: formatting is local, never invented, and every kind has a card.
const noon=new Date(2026,8,7,14,5,9);
assert.equal(clockParts({clock24:true},noon).time,'14:05');
assert.equal(clockParts({clock24:false},noon).time,'2:05');
assert.equal(clockParts({clock24:false},noon).suffix,'PM');
assert.equal(clockParts({clockSeconds:true},noon).seconds,'09');
assert(dateParts({dateStyle:'medium'},noon).weekday.length>0);
for(const kind of WIDGETS){
    const card=widgetCard(kind,undefined,{},noon);
    assert(card.title&&Array.isArray(card.rows),`${kind} card`);
    assert(widgetCardLayout(card).height>0);
}
assert.equal(widgetCard('weather',{temp:21,unit:'C',text:'Clear'},{},noon).headline,'21°C · Clear');
assert.equal(widgetCard('weather',{},{},noon).headline,'No reading');

// Spring motion converges and never runs away.
let value=0,velocity=0;
for(let i=0;i<400&&!settled(value,velocity,1);i++)[value,velocity]=spring(value,velocity,1,1/60);
assert(settled(value,velocity,1),'spring settles open');
for(let i=0;i<400&&!settled(value,velocity,0);i++)[value,velocity]=spring(value,velocity,0,1/60);
assert(settled(value,velocity,0),'spring settles closed');
assert.equal(clamp(2),1);assert.equal(clamp(-1),0);
assert.equal(stagger(1,4,5),1);assert(stagger(.1,4,5)<=0);

// Contrast tiers only ever get lighter.
assert.equal(tone({textContrast:'high'},'muted'),CONTRAST.high.muted);
assert.equal(tone({},'muted'),CONTRAST.high.muted);
assert.equal(W.semi,600);

console.log('Geometry, gear centring, sliver size, widgets, spring motion, and contrast checks passed.');
