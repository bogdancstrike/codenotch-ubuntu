import assert from 'node:assert/strict';
import {geometry,point,band,P,D,cardLayout,hitTest,resetCopy} from '../extension/render.js';
for(const edge of ['right','left','top','bottom'])for(const count of [0,1,3,7,12]){
    const g=geometry(count,edge);assert(g.width>0&&g.height>0);
    for(const center of [...g.centers,g.gearAlong]){const [x,y]=point(g,edge,center,g.depth/2);assert(x>=0&&x<=g.width&&y>=0&&y<=g.height);}
    assert(g.gearAlong<g.length);assert(g.gearAlong>g.divider);
    const [gx,gy]=point(g,edge,g.gearAlong,g.depth/2);assert.equal(hitTest(g,edge,gx,gy,count),-2);
}
assert.equal(D.ring,44);assert.equal(band(.21),P.green);assert.equal(band(.52),P.yellow);assert.equal(band(.73),P.orange);
assert.equal(resetCopy(160,100),'Resets in 1 min');assert.equal(resetCopy(0,100),'');
assert(cardLayout({windows:[],sessions:Array(20).fill({})},250).sessions.length<20);
console.log('Geometry, hit targets, color thresholds, tooltip cap, and countdown checks passed.');
