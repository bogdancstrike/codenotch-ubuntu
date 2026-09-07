// Geometry and palette ported from vinzdg/codenotch (MIT, Copyright 2026 Vinz).
// Pure drawing module; used unchanged by GNOME and the screenshot harness.
import {GLYPHS} from './glyphs.js';
export const PX=44/117;
export const D={depth:186*PX,flare:103*PX,corner:78.8*PX,ring:44,track:15.5*PX,stroke:8*PX,glyph:46*PX,gap:26.9*PX,line:17,padStart:69.5*PX,padEnd:50.1*PX,spacing:83.5*PX,cardWidth:600*PX,cardPad:32*PX,cardCorner:49.5*PX,tail:75*PX,tailHeight:87*PX,tailGap:28*PX};
export const P={black:'#000000',track:'#303030',bar:'#2D2D2D',green:'#00FF88',yellow:'#F2FF00',orange:'#FF3F00',white:'#FFFFFF',muted:'#808080'};
export function band(f) {return f<.5?P.green:f<.7?P.yellow:P.orange;}
export function color(cr,hex,alpha=1) {const n=parseInt(hex.slice(1),16);cr.setSourceRGBA((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,alpha);}
export function text(cr,value,x,y,size=10,colorHex=P.white,align='left',weight=false) {
    color(cr,colorHex);cr.selectFontFace('sans-serif',0,weight?1:0);cr.setFontSize(size);
    const ex=cr.textExtents(String(value));
    const width=ex.width??ex.x_advance??0;
    cr.moveTo(x-(align==='center'?width/2:align==='right'?width:0),y);cr.showText(String(value));
}
export function roundRect(cr,x,y,w,h,r) {
    r=Math.min(r,w/2,h/2);cr.newPath();cr.moveTo(x+r,y);cr.lineTo(x+w-r,y);cr.arc(x+w-r,y+r,r,-Math.PI/2,0);cr.lineTo(x+w,y+h-r);cr.arc(x+w-r,y+h-r,r,0,Math.PI/2);cr.lineTo(x+r,y+h);cr.arc(x+r,y+h-r,r,Math.PI/2,Math.PI);cr.lineTo(x,y+r);cr.arc(x+r,y+r,r,Math.PI,Math.PI*1.5);cr.closePath();
}
export function glyph(cr,name,cx,cy,size=D.glyph) {
    const scale={claude:.97,cursor:.97,openai:.94,glm:.95,opencode:.95}[name]??1;size*=scale;
    const loops=GLYPHS[name]??GLYPHS.claude;
    cr.newPath();for(const loop of loops) {loop.forEach(([x,y],i)=>{const a=cx+(x-.5)*size,b=cy+(y-.5)*size;i?cr.lineTo(a,b):cr.moveTo(a,b);});cr.closePath();}
    color(cr,P.white);cr.setFillRule(1);cr.fill();cr.setFillRule(0);
}
export function gear(cr,cx,cy,size=21) {
    cr.newPath();for(let i=0;i<64;i++){const a=i*Math.PI/32,r=size*(i%8<4?.49:.37),x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r;i?cr.lineTo(x,y):cr.moveTo(x,y);}cr.closePath();
    cr.arc(cx,cy,size*.2,0,Math.PI*2);color(cr,P.white);cr.setFillRule(1);cr.fill();cr.setFillRule(0);
}
export function geometry(count,edge='right',folded=false) {
    const vertical=edge==='right'||edge==='left';
    const cell=D.ring+D.gap+D.line;
    const start=vertical?D.padStart:(D.padStart+D.padEnd)/2;
    const end=vertical?D.padEnd:start;
    const depth=folded?26*PX:vertical?D.depth:D.depth+D.gap+D.line;
    // Settings is a real final cell with its own divider and hot target.
    const extent=vertical?cell:D.ring;
    const length=folded?210*PX:2*D.flare+start+count*extent+Math.max(0,count-1)*D.spacing+end+(count?16:0)+D.ring;
    const providerLength=count*extent+Math.max(0,count-1)*D.spacing;
    const centers=Array.from({length:count},(_,i)=>D.flare+start+D.ring/2+i*(extent+D.spacing));
    const gearAlong=D.flare+start+providerLength+end+(count?16:0)+D.ring/2;
    const divider=D.flare+start+providerLength+end/2+4;
    return {vertical,depth,length,cell,centers,gearAlong,divider,width:vertical?depth:length,height:vertical?length:depth};
}
export function point(g,edge,along,across) {
    if(edge==='right')return [g.depth-across,along];
    if(edge==='left')return [across,along];
    if(edge==='top')return [along,across];
    return [along,g.depth-across];
}
function notchPath(cr,depth,length) {
    const wanted=Math.max(0,Math.min(D.corner,depth/2));
    const curl=Math.max(0,Math.min(D.flare,length/2,depth-wanted));
    const corner=Math.max(0,Math.min(wanted,(length-2*curl)/2));
    cr.newPath();cr.moveTo(depth,0);cr.arc(depth-curl,0,curl,0,Math.PI/2);
    cr.lineTo(corner,curl);cr.arcNegative(corner,curl+corner,corner,-Math.PI/2,-Math.PI);
    cr.lineTo(0,length-curl-corner);cr.arcNegative(corner,length-curl-corner,corner,Math.PI,Math.PI/2);
    cr.lineTo(depth-curl,length-curl);cr.arc(depth-curl,length,curl,-Math.PI/2,0);cr.closePath();
}
export function ring(cr,p,cx,cy,phase=0) {
    const f=p.windows?.[0]?.fraction;
    const stale=!['ok','demo'].includes(p.status);
    cr.setLineCap(1);cr.newPath();cr.arc(cx,cy,(D.ring-D.track)/2,0,Math.PI*2);color(cr,P.track);cr.setLineWidth(D.track);cr.stroke();
    if(Number.isFinite(f)&&f>0){cr.newPath();cr.arc(cx,cy,(D.ring-D.track)/2,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(1,f));color(cr,band(f),stale?.4:1);cr.setLineWidth(D.stroke);cr.stroke();}
    const activity=p.sessions?.find(s=>s.state==='waiting')??p.sessions?.find(s=>s.state==='busy');
    if(activity){const busy=activity.state==='busy';cr.newPath();cr.arc(cx,cy,72*PX/2,busy?phase:0,(busy?phase:0)+Math.PI*(busy?1.5:2));color(cr,busy?P.green:'#FFBC4A',busy?1:.6+.4*Math.sin(phase));cr.setLineWidth(5.5*PX);cr.stroke();}
    glyph(cr,p.glyph,cx,cy);
    const label=Number.isFinite(f)?`${Math.round(f*100)}%`:'—';
    text(cr,label,cx,cy+D.ring/2+D.gap+13,27*PX/.714,stale?P.muted:P.white,'center',true);
}
export function drawNotch(cr,providers,edge,folded=false,phase=0,progress=1) {
    const g=geometry(providers.length,edge,folded);
    cr.save();if(edge==='left'){cr.translate(g.depth,0);cr.scale(-1,1);}else if(edge==='top'){cr.translate(0,g.depth);cr.rotate(-Math.PI/2);}else if(edge==='bottom'){cr.rotate(Math.PI/2);cr.scale(1,-1);}
    const pill=geometry(0,edge,true);
    const depth=folded?g.depth:pill.depth+(g.depth-pill.depth)*progress;
    const length=folded?g.length:pill.length+(g.length-pill.length)*progress;
    cr.translate(g.depth-depth,(g.length-length)/2);
    notchPath(cr,depth,length);color(cr,P.black);cr.fill();cr.restore();
    if(folded||progress<.88)return g;
    const across=(D.depth-D.ring)/2+D.ring/2;
    providers.forEach((p,i)=>{const [x,y]=point(g,edge,g.centers[i],g.vertical?g.depth/2:edge==='top'?across:g.depth-across);ring(cr,p,x,y,phase);});
    if(providers.length){const [x1,y1]=point(g,edge,g.divider,18);const [x2,y2]=point(g,edge,g.divider,g.depth-18);cr.newPath();cr.moveTo(x1,y1);cr.lineTo(x2,y2);color(cr,P.track);cr.setLineWidth(1);cr.stroke();}
    const [gx,gy]=point(g,edge,g.gearAlong,g.depth/2);gear(cr,gx,gy);
    return g;
}
export function resetCopy(at,now=Date.now()/1000) {
    if(!at)return '';
    const seconds=at-now;if(seconds<=0)return 'Reset pending';
    if(seconds<3600)return `Resets in ${Math.ceil(seconds/60)} min`;
    if(seconds<86400)return `Resets in ${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`;
    return `Resets ${new Date(at*1000).toLocaleDateString(undefined,{weekday:'short',hour:'2-digit',minute:'2-digit'})}`;
}
export function clipped(s,max=36){s=String(s??'');return s.length>max?s.slice(0,max-1)+'…':s;}
function wrap(s,width=42){const words=String(s).split(/\s+/);const lines=[];let line='';for(const word of words){if((line+' '+word).length>width&&line){lines.push(line);line='';}line+=(line?' ':'')+word;}if(line)lines.push(line);return lines.slice(0,5);}
export function cardLayout(p,maxHeight=650) {
    const windows=(p.windows??[]).slice(0,8),notes=['ok'].includes(p.status)?[]:wrap(p.message??'No usage available.');
    const base=2*D.cardPad+D.glyph+8+notes.length*13+windows.length*46;
    const cap=Math.max(0,Math.min(12,Math.floor((maxHeight-base-28)/38)));
    const sessions=(p.sessions??[]).slice(0,cap);
    return {windows,notes,sessions,height:base+(sessions.length?15+sessions.length*38:0)+((p.sessions?.length??0)>sessions.length?16:0)};
}
export function drawCard(cr,p,width=D.cardWidth,maxHeight=650) {
    const l=cardLayout(p,maxHeight),pad=D.cardPad;
    roundRect(cr,0,0,width,l.height,D.cardCorner);color(cr,P.black);cr.fill();
    glyph(cr,p.glyph,pad+D.glyph/2,pad+D.glyph/2);
    text(cr,clipped(p.name+' Usage',26),pad+D.glyph+17*PX,pad+13,26*PX/.714,P.white,'left',true);
    let y=pad+D.glyph+10;
    for(const line of l.notes){text(cr,line,pad,y+9,9.5,P.muted);y+=13;}
    for(const w of l.windows){text(cr,clipped(w.label,22),pad,y+9,18*PX/.714);text(cr,resetCopy(w.resetsAt),width-pad,y+9,8.2,P.muted,'right');y+=16;
        roundRect(cr,pad,y,width-2*pad,10.5*PX,2);color(cr,P.bar);cr.fill();
        if(Number.isFinite(w.fraction)&&w.fraction>0){roundRect(cr,pad,y,(width-2*pad)*Math.min(1,w.fraction),10.5*PX,2);color(cr,band(w.fraction));cr.fill();}
        y+=17;text(cr,`${Math.round(w.fraction*100)}% Used`,pad,y,18*PX/.714);y+=13;
    }
    if(l.sessions.length){cr.newPath();cr.moveTo(pad,y);cr.lineTo(width-pad,y);color(cr,P.track);cr.setLineWidth(1);cr.stroke();y+=15;}
    for(const s of l.sessions){text(cr,clipped(s.name,25),pad,y+8,9.5);text(cr,s.state==='busy'?'working':s.state,width-pad,y+8,9,s.state==='waiting'?'#FFBC4A':s.state==='busy'?P.green:P.muted,'right');text(cr,clipped(s.detail,40),pad,y+23,8.5,P.muted);y+=38;}
    if((p.sessions?.length??0)>l.sessions.length)text(cr,`and ${p.sessions.length-l.sessions.length} more`,pad,y+8,9,P.muted);
    return l;
}
export function hitTest(g,edge,x,y,count){const along=g.vertical?y:x;for(let i=0;i<count;i++)if(along>=g.centers[i]-D.ring/2-8&&along<=g.centers[i]+D.ring/2+D.gap+D.line)return i;return along>=g.divider?-2:-1;}
