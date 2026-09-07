// Geometry and palette ported from vinzdg/codenotch (MIT, Copyright 2026 Vinz).
// Pure drawing module; used unchanged by GNOME and the screenshot harness.
import {GLYPHS} from './glyphs.js';

export const PX=44/117;
export const D={
    depth:186*PX,flare:103*PX,corner:78.8*PX,ring:44,track:15.5*PX,stroke:8*PX,glyph:46*PX,
    gap:26.9*PX,line:19,padStart:69.5*PX,padEnd:50.1*PX,spacing:83.5*PX,
    widgetSpacing:19,groupGap:26,dividerGap:15,gearCell:34,gear:15,
    peekDepth:26*PX,peekLength:210*PX,handle:3,handleLength:34,
    cardWidth:306,cardPad:22,cardCorner:24,cardGlyph:22,tail:75*PX,tailHeight:87*PX,tailGap:10,
};
// Weight names map onto Pango weights; the cairo fallback only knows bold or not.
export const W={regular:400,medium:500,semi:600,bold:700};
export const P={
    black:'#000000',shell:'#0A0A0A',track:'#333333',bar:'#2D2D2D',line:'#3A3A3A',
    green:'#00FF88',yellow:'#F2FF00',orange:'#FF3F00',amber:'#FFBC4A',
    white:'#FFFFFF',dim:'#C8CCD0',muted:'#9AA0A6',faint:'#6E7378',
};
// Readability: the muted tones lift together instead of every call site guessing.
export const CONTRAST={normal:{dim:'#B4B4B4',muted:'#8A8A8A',faint:'#606060'},
    high:{dim:P.dim,muted:P.muted,faint:P.faint},
    higher:{dim:'#F2F4F6',muted:'#C6CBD1',faint:'#93999F'}};
export function tone(settings,name){return (CONTRAST[settings?.textContrast]??CONTRAST.high)[name]??P[name];}

export function band(f) {return f<.5?P.green:f<.7?P.yellow:P.orange;}
export function color(cr,hex,alpha=1) {const n=parseInt(hex.slice(1),16);cr.setSourceRGBA((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,alpha);}

// ---------------------------------------------------------------- typography
function cairoText(cr,value,x,y,size,hex,align,weight,opts) {
    color(cr,hex,opts.alpha??1);cr.selectFontFace('sans-serif',0,weight>=W.semi?1:0);cr.setFontSize(size);
    const ex=cr.textExtents(value),width=ex.width??ex.x_advance??0;
    cr.moveTo(x-(align==='center'?width/2:align==='right'?width:0),y);cr.showText(value);
}
function cairoMeasure(cr,value,size,weight) {
    cr.selectFontFace('sans-serif',0,weight>=W.semi?1:0);cr.setFontSize(size);
    const ex=cr.textExtents(value);return ex.width??ex.x_advance??0;
}
let engine=cairoText,measure=cairoMeasure;
// GNOME swaps in a Pango engine: real hinting and metrics, far crisper small text.
export function setTextEngine(fn,measureFn) {engine=fn??cairoText;measure=measureFn??cairoMeasure;}
export function text(cr,value,x,y,size=12,hex=P.white,align='left',weight=W.regular,opts={}) {
    engine(cr,String(value),x,y,size,hex,align,weight,opts);
}
export function textWidth(cr,value,size,weight=W.regular) {return measure(cr,String(value),size,weight);}
/** Trim to a pixel budget. Paths lose their head, everything else its tail. */
export function fit(cr,value,size,weight,maxWidth,fromStart=false) {
    const full=String(value??'');
    if(!full||textWidth(cr,full,size,weight)<=maxWidth)return full;
    let low=0,high=full.length;
    while(low<high){
        const mid=Math.ceil((low+high)/2);
        const candidate=fromStart?'…'+full.slice(full.length-mid):full.slice(0,mid)+'…';
        if(textWidth(cr,candidate,size,weight)<=maxWidth)low=mid;else high=mid-1;
    }
    if(!fromStart)return full.slice(0,low)+'…';
    // Start the visible tail at a path separator: "…/dev/project" beats "…v/project".
    let tail=full.slice(full.length-low);
    const cut=tail.indexOf('/');
    if(cut>0&&cut<=8)tail=tail.slice(cut);
    return '…'+tail;
}

export function roundRect(cr,x,y,w,h,r) {
    r=Math.min(r,w/2,h/2);cr.newPath();cr.moveTo(x+r,y);cr.lineTo(x+w-r,y);cr.arc(x+w-r,y+r,r,-Math.PI/2,0);cr.lineTo(x+w,y+h-r);cr.arc(x+w-r,y+h-r,r,0,Math.PI/2);cr.lineTo(x+r,y+h);cr.arc(x+r,y+h-r,r,Math.PI/2,Math.PI);cr.lineTo(x,y+r);cr.arc(x+r,y+r,r,Math.PI,Math.PI*1.5);cr.closePath();
}
export function glyph(cr,name,cx,cy,size=D.glyph,alpha=1) {
    const scale={claude:.97,cursor:.97,openai:.94,glm:.95,opencode:.95}[name]??1;size*=scale;
    const loops=GLYPHS[name]??GLYPHS.claude;
    cr.newPath();for(const loop of loops) {loop.forEach(([x,y],i)=>{const a=cx+(x-.5)*size,b=cy+(y-.5)*size;i?cr.lineTo(a,b):cr.moveTo(a,b);});cr.closePath();}
    color(cr,P.white,alpha);cr.setFillRule(1);cr.fill();cr.setFillRule(0);
}
export function gear(cr,cx,cy,size=D.gear,alpha=1) {
    // Eight teeth on a ring, drawn about (cx,cy) so the cell centre is the centre.
    const outer=size*.5,inner=size*.36;
    cr.newPath();
    for(let i=0;i<64;i++){const a=i*Math.PI/32-Math.PI/8,r=i%8<4?outer:inner,x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r;i?cr.lineTo(x,y):cr.moveTo(x,y);}
    cr.closePath();cr.newSubPath?.();cr.arc(cx,cy,size*.18,0,Math.PI*2);
    color(cr,P.white,alpha);cr.setFillRule(1);cr.fill();cr.setFillRule(0);
}

// ------------------------------------------------------------------- motion
// Apple-ish spring: critically damped by default, with a touch of overshoot on
// the way open. Integrated per frame so an interrupted gesture keeps velocity.
export function spring(value,velocity,target,dt,stiffness=190,damping=26) {
    const steps=Math.max(1,Math.ceil(dt/.008)),step=dt/steps;
    for(let i=0;i<steps;i++){
        velocity+=(-stiffness*(value-target)-damping*velocity)*step;
        value+=velocity*step;
    }
    return [value,velocity];
}
export function settled(value,velocity,target) {return Math.abs(value-target)<.0015&&Math.abs(velocity)<.02;}
export const ease={
    // Standard/decelerate pairs matching the feel of system sheets.
    out(t){return 1-Math.pow(1-t,3);},
    inOut(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;},
};
export function clamp(value,low=0,high=1){return value<low?low:value>high?high:value;}
// Content fades in slightly after the shell, per cell, so the notch unfolds.
export function stagger(progress,index,count,share=.42) {
    if(count<=0)return clamp(progress);
    const span=(1-share)/Math.max(1,count),start=share*0+index*span;
    return clamp((progress-start)/Math.max(.0001,1-start-0));
}

// ---------------------------------------------------------------- geometry
export const WIDGET_EXTENT={clock:[30,64],date:[40,66],weather:[50,64],battery:[34,54],system:[78,62]};
function widgetExtent(kind,vertical) {return (WIDGET_EXTENT[kind]??WIDGET_EXTENT.clock)[vertical?0:1];}

/** Ordered cells for the notch: providers, then widgets, then the settings gear. */
export function plan(providers=[],widgets=[],edge='right',folded=false) {
    const vertical=edge==='right'||edge==='left';
    const depth=folded?D.peekDepth:vertical?D.depth:D.depth+D.gap+D.line;
    const padStart=vertical?D.padStart:(D.padStart+D.padEnd)/2,padEnd=vertical?D.padEnd:padStart;
    const cells=[];
    for(const p of providers)cells.push({kind:'provider',ref:p,extent:vertical?D.ring+D.gap+D.line:D.ring,gap:D.spacing});
    for(const w of widgets)cells.push({kind:'widget',ref:w,extent:widgetExtent(w,vertical),gap:D.widgetSpacing});
    let along=D.flare+padStart;
    const dividers=[];
    cells.forEach((cell,i)=>{
        cell.start=along;cell.center=along+cell.extent/2;along+=cell.extent;
        const next=cells[i+1];
        if(!next)return;
        if(next.kind!==cell.kind){dividers.push(along+D.groupGap/2);along+=D.groupGap;}
        else along+=cell.gap;
    });
    if(cells.length){along+=padEnd;dividers.push(along+D.dividerGap/2);along+=D.dividerGap;}
    const gearAlong=along+D.gearCell/2;
    const length=folded?D.peekLength:gearAlong+D.gearCell/2+padEnd+D.flare;
    return {vertical,depth,length,cells,dividers,gearAlong,
        width:vertical?depth:length,height:vertical?length:depth,
        centers:cells.map(c=>c.center)};
}
/** Back-compatible wrapper: a plain provider count with no widgets. */
export function geometry(count,edge='right',folded=false) {
    const providers=typeof count==='number'?Array.from({length:count},(_,i)=>({id:i})):count;
    const g=plan(providers,[],edge,folded);
    return {...g,divider:g.dividers[0]??g.gearAlong,cell:D.ring+D.gap+D.line};
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

// ------------------------------------------------------------------ widgets
export function clockParts(settings={},now=new Date()) {
    const two=n=>String(n).padStart(2,'0');
    const hours=settings.clock24===false?(now.getHours()%12||12):now.getHours();
    return {time:`${settings.clock24===false?hours:two(hours)}:${two(now.getMinutes())}`,
        seconds:two(now.getSeconds()),
        suffix:settings.clock24===false?(now.getHours()<12?'AM':'PM'):''};
}
export function dateParts(settings={},now=new Date()) {
    const style=settings.dateStyle??'medium';
    const weekday=now.toLocaleDateString(undefined,{weekday:style==='long'?'long':'short'});
    const day=now.toLocaleDateString(undefined,style==='short'?{day:'numeric',month:'numeric'}:{day:'numeric',month:'short'});
    return {weekday,day};
}
function sunPath(cr,cx,cy,r,alpha) {
    color(cr,P.white,alpha);cr.newPath();cr.arc(cx,cy,r*.56,0,Math.PI*2);cr.fill();
    cr.setLineWidth(1.5);cr.setLineCap(1);
    for(let i=0;i<8;i++){const a=i*Math.PI/4;cr.newPath();cr.moveTo(cx+Math.cos(a)*r*.82,cy+Math.sin(a)*r*.82);cr.lineTo(cx+Math.cos(a)*r*1.18,cy+Math.sin(a)*r*1.18);cr.stroke();}
}
function cloudPath(cr,cx,cy,r) {
    cr.newPath();cr.arc(cx-r*.42,cy+r*.12,r*.44,Math.PI*.6,Math.PI*1.6);
    cr.arc(cx-r*.02,cy-r*.3,r*.55,Math.PI*1.1,Math.PI*1.95);
    cr.arc(cx+r*.5,cy+r*.06,r*.42,Math.PI*1.6,Math.PI*.55);cr.closePath();
}
function drops(cr,cx,cy,r,count,hex,alpha) {
    color(cr,hex,alpha);cr.setLineWidth(1.6);cr.setLineCap(1);
    for(let i=0;i<count;i++){const x=cx+(i-(count-1)/2)*r*.44;cr.newPath();cr.moveTo(x,cy+r*.05);cr.lineTo(x-r*.1,cy+r*.42);cr.stroke();}
}
export function weatherSymbol(cr,symbol,cx,cy,size=20,alpha=1) {
    const r=size/2;
    if(symbol==='sun'){sunPath(cr,cx,cy,r,alpha);return;}
    if(symbol==='moon'){color(cr,P.white,alpha);cr.newPath();cr.arc(cx+r*.12,cy,r*.72,0,Math.PI*2);cr.fill();color(cr,P.black,1);cr.newPath();cr.arc(cx+r*.55,cy-r*.3,r*.66,0,Math.PI*2);cr.fill();return;}
    if(symbol==='partly'||symbol==='partlynight'){
        if(symbol==='partly')sunPath(cr,cx+r*.42,cy-r*.42,r*.62,alpha);
        else{color(cr,P.white,alpha);cr.newPath();cr.arc(cx+r*.5,cy-r*.45,r*.4,0,Math.PI*2);cr.fill();}
        color(cr,P.white,alpha*.92);cloudPath(cr,cx-r*.1,cy+r*.2,r*.92);cr.fill();return;
    }
    color(cr,P.white,alpha*(symbol==='fog'?.85:1));
    if(symbol!=='fog'){cloudPath(cr,cx,cy-(symbol==='cloud'?0:r*.22),r);cr.fill();}
    if(symbol==='fog'){cr.setLineWidth(1.8);cr.setLineCap(1);for(let i=0;i<4;i++){cr.newPath();cr.moveTo(cx-r*.8,cy-r*.5+i*r*.42);cr.lineTo(cx+r*.8-(i%2)*r*.3,cy-r*.5+i*r*.42);cr.stroke();}return;}
    if(symbol==='rain')drops(cr,cx,cy+r*.5,r,3,'#68C0FF',alpha);
    if(symbol==='drizzle')drops(cr,cx,cy+r*.5,r,2,'#68C0FF',alpha*.9);
    if(symbol==='sleet')drops(cr,cx,cy+r*.5,r,2,'#9BD8FF',alpha);
    if(symbol==='snow'){color(cr,'#DCEBFF',alpha);for(let i=0;i<3;i++){cr.newPath();cr.arc(cx+(i-1)*r*.42,cy+r*.62,r*.11,0,Math.PI*2);cr.fill();}}
    if(symbol==='storm'){color(cr,P.yellow,alpha);cr.newPath();cr.moveTo(cx+r*.1,cy+r*.2);cr.lineTo(cx-r*.28,cy+r*.72);cr.lineTo(cx-r*.02,cy+r*.7);cr.lineTo(cx-r*.16,cy+r*1.1);cr.lineTo(cx+r*.34,cy+r*.5);cr.lineTo(cx+r*.06,cy+r*.52);cr.closePath();cr.fill();}
}
function batteryIcon(cr,x,y,w,h,fraction,charging,alpha) {
    color(cr,P.white,alpha*.55);cr.setLineWidth(1.3);roundRect(cr,x,y,w-2,h,h*.32);cr.stroke();
    color(cr,P.white,alpha*.55);roundRect(cr,x+w-1.6,y+h*.3,2.2,h*.4,1);cr.fill();
    const hex=fraction<=.15?P.orange:charging?P.green:P.white;
    color(cr,hex,alpha);roundRect(cr,x+1.7,y+1.7,Math.max(1.5,(w-5.4)*clamp(fraction)),h-3.4,Math.max(.5,h*.2));cr.fill();
}
function meter(cr,x,y,w,fraction,hex,alpha) {
    color(cr,P.bar,alpha);roundRect(cr,x,y,w,3.4,1.7);cr.fill();
    color(cr,hex,alpha);roundRect(cr,x,y,Math.max(2,w*clamp(fraction)),3.4,1.7);cr.fill();
}

/** Draw one widget centred in its cell box. `along`/`across` are notch axes. */
export function drawWidget(cr,kind,data,settings,g,edge,cell,alpha,now=new Date()) {
    const half=cell.extent/2,mid=cell.center,across=g.depth/2;
    const at=(alongOffset,acrossOffset=0)=>point(g,edge,mid+alongOffset,across+acrossOffset);
    const dim=tone(settings,'dim'),muted=tone(settings,'muted');
    const horizontal=!g.vertical;
    if(kind==='clock'){
        const c=clockParts(settings,now);
        const [x,y]=at(horizontal?0:-half+16);
        text(cr,c.time,x,y+(horizontal?6:0),21,P.white,'center',W.semi,{alpha,tracking:-.3});
        const extra=[settings.clockSeconds?c.seconds:'',c.suffix].filter(Boolean).join(' ');
        if(extra){const [sx,sy]=at(horizontal?0:half-5);text(cr,extra,sx,sy+(horizontal?18:0),10.5,muted,'center',W.medium,{alpha});}
        return;
    }
    if(kind==='date'){
        const d=dateParts(settings,now);
        const [wx,wy]=at(horizontal?0:-half+11);text(cr,d.weekday.toUpperCase(),wx,wy+(horizontal?-2:0),10,muted,'center',W.semi,{alpha,tracking:.9});
        const [dx,dy]=at(horizontal?0:half-7);text(cr,d.day,dx,dy+(horizontal?15:0),15,dim,'center',W.medium,{alpha});
        return;
    }
    if(kind==='weather'){
        const w=data??{};
        const ok=Number.isFinite(w.temp);
        if(horizontal){
            const [ix,iy]=at(-half+11,-2);weatherSymbol(cr,w.symbol??'cloud',ix,iy,21,alpha);
            const [tx,ty]=at(11,0);text(cr,ok?`${w.temp}°`:'—',tx,ty+6,17,P.white,'center',W.semi,{alpha});
            if(ok&&Number.isFinite(w.high)){const [hx,hy]=at(11,0);text(cr,`${w.high}° / ${w.low}°`,hx,hy+19,10,muted,'center',W.medium,{alpha});}
            return;
        }
        const [ix,iy]=at(-half+15);weatherSymbol(cr,w.symbol??'cloud',ix,iy,22,alpha);
        const [tx,ty]=at(half-11);text(cr,ok?`${w.temp}°`:'—',tx,ty+6,17,P.white,'center',W.semi,{alpha});
        return;
    }
    if(kind==='battery'){
        const b=data??{};const fraction=(b.percent??0)/100;
        const [ix,iy]=at(horizontal?-half+13:-half+9,horizontal?-3:0);
        batteryIcon(cr,ix-11,iy-6,22,12,fraction,!!b.charging,alpha);
        const [tx,ty]=at(horizontal?7:half-9,0);
        text(cr,Number.isFinite(b.percent)?`${b.percent}%`:'—',tx,ty+(horizontal?5:5),12.5,dim,'center',W.semi,{alpha});
        return;
    }
    if(kind==='system'){
        // A bar alone is hard to read at this size, so each meter carries its
        // number: label left, value right, the bar underneath both.
        const s=data??{};
        const span=horizontal?56:52;
        [['CPU',s.cpu,P.green],['RAM',s.mem,'#5AC8FA'],['SSD',s.disk,'#C58AF9']].forEach(([label,value,hex],i)=>{
            const [x,y]=horizontal?at(0,-21+i*21):at(-half+15+i*24);
            const left=x-span/2;
            text(cr,label,left,y,10,muted,'left',W.semi,{alpha,tracking:.7});
            text(cr,Number.isFinite(value)?`${Math.round(value*100)}%`:'—',left+span,y,11,dim,'right',W.medium,{alpha});
            meter(cr,left,y+5,span,value??0,hex,alpha);
        });
        return;
    }
}

// -------------------------------------------------------------------- rings
export function ring(cr,p,cx,cy,phase=0,alpha=1,settings={}) {
    const f=p.windows?.[0]?.fraction;
    const stale=!['ok','demo'].includes(p.status);
    cr.setLineCap(1);cr.newPath();cr.arc(cx,cy,(D.ring-D.track)/2,0,Math.PI*2);color(cr,P.track,alpha);cr.setLineWidth(D.track);cr.stroke();
    if(Number.isFinite(f)&&f>0){cr.newPath();cr.arc(cx,cy,(D.ring-D.track)/2,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(1,f));color(cr,band(f),alpha*(stale?.4:1));cr.setLineWidth(D.stroke);cr.stroke();}
    const activity=p.sessions?.find(s=>s.state==='waiting')??p.sessions?.find(s=>s.state==='busy');
    if(activity){const busy=activity.state==='busy';cr.newPath();cr.arc(cx,cy,72*PX/2,busy?phase:0,(busy?phase:0)+Math.PI*(busy?1.5:2));color(cr,busy?P.green:P.amber,alpha*(busy?1:.6+.4*Math.sin(phase)));cr.setLineWidth(5.5*PX);cr.stroke();}
    glyph(cr,p.glyph,cx,cy,D.glyph,alpha);
    const label=Number.isFinite(f)?`${Math.round(f*100)}%`:'—';
    text(cr,label,cx,cy+D.ring/2+D.gap+13,15,stale?tone(settings,'muted'):P.white,'center',W.semi,{alpha,tracking:-.2});
}

// -------------------------------------------------------------------- notch
/** The resting sliver's handle, drawn inside the notch's own transform so it
 *  lands on the pill at every edge and at every point of the unfold. */
function drawHandle(cr,depth,length,alpha) {
    if(alpha<=.01)return;
    const reach=Math.min(D.handleLength,length*.5)/2;
    color(cr,P.white,.38*alpha);cr.setLineCap(1);cr.setLineWidth(D.handle);
    cr.newPath();cr.moveTo(depth/2,length/2-reach);cr.lineTo(depth/2,length/2+reach);cr.stroke();
}

export function drawNotch(cr,options={}) {
    const {providers=[],widgets=[],data={},settings={},edge='right',folded=false,phase=0,progress=1,now=new Date()}=options;
    const g=plan(providers,widgets,edge,folded);
    const pill=plan([],[],edge,true);
    cr.save();
    if(edge==='left'){cr.translate(g.depth,0);cr.scale(-1,1);}
    else if(edge==='top'){cr.translate(0,g.depth);cr.rotate(-Math.PI/2);}
    else if(edge==='bottom'){cr.rotate(Math.PI/2);cr.scale(1,-1);}
    const shape=ease.out(clamp(progress));
    const depth=folded?g.depth:pill.depth+(g.depth-pill.depth)*shape;
    const length=folded?g.length:pill.length+(g.length-pill.length)*shape;
    cr.translate(g.depth-depth,(g.length-length)/2);
    notchPath(cr,depth,length);color(cr,P.black);cr.fill();
    if(settings.peek!==false)drawHandle(cr,depth,length,folded?1:Math.max(0,1-clamp(progress)*5));
    cr.restore();
    if(folded||progress<.02)return g;
    const across=(D.depth-D.ring)/2+D.ring/2;
    const reveal=clamp((progress-.35)/.5);
    if(reveal<=.005)return g;
    g.cells.forEach((cell,i)=>{
        const alpha=clamp(stagger(reveal,i,g.cells.length,.35));
        if(alpha<=.01)return;
        if(cell.kind==='provider'){
            const [x,y]=point(g,edge,cell.start+D.ring/2,g.vertical?g.depth/2:edge==='top'?across:g.depth-across);
            ring(cr,cell.ref,x,y,phase,alpha,settings);
        }else drawWidget(cr,cell.ref,data[cell.ref],settings,g,edge,cell,alpha,now);
    });
    color(cr,tone(settings,'faint'),reveal*.85);cr.setLineWidth(1);
    for(const at of g.dividers){
        const [x1,y1]=point(g,edge,at,16);const [x2,y2]=point(g,edge,at,g.depth-16);
        cr.newPath();cr.moveTo(x1,y1);cr.lineTo(x2,y2);cr.stroke();
    }
    const [gx,gy]=point(g,edge,g.gearAlong,g.depth/2);gear(cr,gx,gy,D.gear,reveal);
    return g;
}

// ------------------------------------------------------------------- tooltip
export function resetCopy(at,now=Date.now()/1000) {
    if(!at)return '';
    const seconds=at-now;if(seconds<=0)return 'Reset pending';
    if(seconds<3600)return `Resets in ${Math.ceil(seconds/60)} min`;
    if(seconds<86400)return `Resets in ${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`;
    return `Resets ${new Date(at*1000).toLocaleDateString(undefined,{weekday:'short',hour:'2-digit',minute:'2-digit'})}`;
}
export function clipped(s,max=36){s=String(s??'');return s.length>max?s.slice(0,max-1)+'…':s;}
function wrap(s,width=34){const words=String(s).split(/\s+/);const lines=[];let line='';for(const word of words){if((line+' '+word).length>width&&line){lines.push(line);line='';}line+=(line?' ':'')+word;}if(line)lines.push(line);return lines.slice(0,5);}

// Card metrics. Bumped for legibility: nothing here is below 11.5px, and the
// muted tones come from the contrast setting rather than a fixed grey.
const C={header:D.cardGlyph+18,note:18,window:58,rule:20,session:44,more:22,
    title:16.5,label:14,reset:12,percent:13.5,note_:12.5,name:13.5,state:12,detail:12,bar:6};

export function cardLayout(p,maxHeight=650) {
    const windows=(p.windows??[]).slice(0,8),notes=['ok'].includes(p.status)?[]:wrap(p.message??'No usage available.',34);
    const base=2*D.cardPad+C.header+notes.length*C.note+windows.length*C.window;
    const cap=Math.max(0,Math.min(12,Math.floor((maxHeight-base-C.rule)/C.session)));
    const sessions=(p.sessions??[]).slice(0,cap);
    const overflow=(p.sessions?.length??0)>sessions.length;
    return {windows,notes,sessions,overflow,
        height:base+(sessions.length?C.rule+sessions.length*C.session:0)+(overflow?C.more:0)};
}
export function drawCard(cr,p,width=D.cardWidth,maxHeight=650,settings={}) {
    const l=cardLayout(p,maxHeight),pad=D.cardPad,inner=width-2*pad;
    const muted=tone(settings,'muted'),dim=tone(settings,'dim');
    roundRect(cr,0,0,width,l.height,D.cardCorner);color(cr,P.shell);cr.fill();
    color(cr,P.line,.6);cr.setLineWidth(1);roundRect(cr,.5,.5,width-1,l.height-1,D.cardCorner);cr.stroke();
    glyph(cr,p.glyph,pad+D.cardGlyph/2,pad+D.cardGlyph/2,D.cardGlyph);
    const titleLeft=pad+D.cardGlyph+11;
    text(cr,fit(cr,`${p.name} usage`,C.title,W.semi,width-pad-titleLeft),titleLeft,pad+D.cardGlyph/2+6,C.title,P.white,'left',W.semi,{tracking:-.2});
    let y=pad+C.header;
    for(const line of l.notes){text(cr,line,pad,y+11,C.note_,muted,'left',W.regular);y+=C.note;}
    for(const w of l.windows){
        const reset=resetCopy(w.resetsAt);
        const resetWidth=reset?textWidth(cr,reset,C.reset,W.regular)+14:0;
        text(cr,fit(cr,w.label,C.label,W.medium,inner-resetWidth),pad,y+11,C.label,dim,'left',W.medium);
        if(reset)text(cr,reset,width-pad,y+11,C.reset,muted,'right',W.regular);
        y+=21;
        roundRect(cr,pad,y,inner,C.bar,C.bar/2);color(cr,P.bar);cr.fill();
        if(Number.isFinite(w.fraction)&&w.fraction>0){roundRect(cr,pad,y,inner*Math.min(1,w.fraction),C.bar,C.bar/2);color(cr,band(w.fraction));cr.fill();}
        y+=C.bar+15;
        text(cr,Number.isFinite(w.fraction)?`${Math.round(w.fraction*100)}% used`:'No reading',pad,y,C.percent,P.white,'left',W.semi);
        y+=C.window-21-C.bar-15;
    }
    if(l.sessions.length){cr.newPath();cr.moveTo(pad,y+2);cr.lineTo(width-pad,y+2);color(cr,P.line);cr.setLineWidth(1);cr.stroke();y+=C.rule;}
    for(const s of l.sessions){
        const state=s.state==='busy'?'working':s.state;
        const stateWidth=textWidth(cr,state,C.state,W.semi)+14;
        text(cr,fit(cr,s.name,C.name,W.medium,inner-stateWidth),pad,y+11,C.name,P.white,'left',W.medium);
        text(cr,state,width-pad,y+11,C.state,s.state==='waiting'?P.amber:s.state==='busy'?P.green:muted,'right',W.semi);
        // Paths are far more useful with the head trimmed than the tail.
        const detail=String(s.detail??'');
        text(cr,fit(cr,detail,C.detail,W.regular,inner,detail.includes('/')),pad,y+29,C.detail,muted,'left',W.regular);
        y+=C.session;
    }
    if(l.overflow)text(cr,`and ${p.sessions.length-l.sessions.length} more`,pad,y+11,C.detail,muted,'left',W.regular);
    return l;
}

// --------------------------------------------------------------- widget card
/** Rows for a widget's hover card: [label, value] pairs plus a headline. */
export function widgetCard(kind,data,settings={},now=new Date()) {
    const rows=[];
    if(kind==='clock'){
        const c=clockParts(settings,now);
        return {title:'Clock',headline:`${c.time}${c.suffix?' '+c.suffix:''}`,
            rows:[['Date',now.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'})],
                  ['Time zone',Intl.DateTimeFormat().resolvedOptions().timeZone??'System'],
                  ['Week',`Day ${Math.ceil((now-new Date(now.getFullYear(),0,0))/86400000)} of ${now.getFullYear()}`]]};
    }
    if(kind==='date'){
        const year=now.getFullYear();
        const leap=(year%4===0&&year%100!==0)||year%400===0;
        const day=Math.floor((now-new Date(year,0,0))/86400000);
        // ISO week: the week owning this date's Thursday.
        const thursday=new Date(year,now.getMonth(),now.getDate()+4-(now.getDay()||7));
        const week=Math.ceil(((thursday-new Date(thursday.getFullYear(),0,1))/86400000+1)/7);
        return {title:'Date',headline:now.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'}),
            rows:[['Time',clockParts(settings,now).time],
                  ['Week',`Week ${week}`],
                  ['Day of year',`${day} of ${leap?366:365}`]]};
    }
    if(kind==='weather'){
        const w=data??{};
        if(!Number.isFinite(w.temp))return {title:'Weather',headline:'No reading',rows:[['Status',w.message??'Choose a location in settings.']]};
        const unit=`°${w.unit??'C'}`;
        if(Number.isFinite(w.feels))rows.push(['Feels like',`${w.feels}${unit}`]);
        if(Number.isFinite(w.high))rows.push(['Today',`${w.high}${unit} high · ${w.low}${unit} low`]);
        if(Number.isFinite(w.humidity))rows.push(['Humidity',`${w.humidity}%`]);
        if(Number.isFinite(w.wind))rows.push(['Wind',`${w.wind} ${w.windUnit??'km/h'}`]);
        if(w.updatedAt)rows.push(['Updated',new Date(w.updatedAt*1000).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})]);
        return {title:w.place||'Weather',headline:`${w.temp}${unit} · ${w.text??''}`.trim(),rows,symbol:w.symbol};
    }
    if(kind==='battery'){
        const b=data??{};
        if(!Number.isFinite(b.percent))return {title:'Battery',headline:'No system battery',rows:[]};
        return {title:'Battery',headline:`${b.percent}%`,rows:[['State',b.state??(b.charging?'Charging':'Discharging')],['Source',b.name??'BAT0']]};
    }
    if(kind==='system'){
        const s=data??{};
        const free=(available,total)=>`${available} free of ${total} GiB`;
        if(Number.isFinite(s.cpu))rows.push(['CPU',`${Math.round(s.cpu*100)}% busy`]);
        if(Number.isFinite(s.memFree))rows.push(['Memory',free(s.memFree,s.memTotal)]);
        if(Number.isFinite(s.diskFree))rows.push(['Storage',free(s.diskFree,s.diskTotal)]);
        return {title:'System',headline:Number.isFinite(s.cpu)?`${Math.round(s.cpu*100)}% CPU`:'—',rows};
    }
    return {title:kind,headline:'',rows};
}
export function widgetCardLayout(card) {
    return {height:2*D.cardPad+22+(card.headline?32:0)+card.rows.length*26};
}
export function drawWidgetCard(cr,card,width=D.cardWidth,settings={}) {
    const l=widgetCardLayout(card),pad=D.cardPad,inner=width-2*pad;
    const muted=tone(settings,'muted'),dim=tone(settings,'dim');
    roundRect(cr,0,0,width,l.height,D.cardCorner);color(cr,P.shell);cr.fill();
    color(cr,P.line,.6);cr.setLineWidth(1);roundRect(cr,.5,.5,width-1,l.height-1,D.cardCorner);cr.stroke();
    const badge=card.symbol?32:0;
    let y=pad+11;
    if(card.symbol)weatherSymbol(cr,card.symbol,width-pad-13,pad+13,26,1);
    text(cr,fit(cr,String(card.title).toUpperCase(),11.5,W.semi,inner-badge),pad,y,11.5,muted,'left',W.semi,{tracking:1.1});
    y+=22;
    if(card.headline){text(cr,fit(cr,card.headline,21,W.semi,inner-badge),pad,y+6,21,P.white,'left',W.semi,{tracking:-.3});y+=32;}
    for(const [label,value] of card.rows){
        const labelWidth=textWidth(cr,label,13,W.regular)+16;
        text(cr,label,pad,y+12,13,muted,'left',W.regular);
        text(cr,fit(cr,value,13,W.medium,inner-labelWidth),width-pad,y+12,13,dim,'right',W.medium);y+=26;
    }
    return l;
}

/** Which cell is under a point? Returns {kind, index} or null. */
export function hitTest(g,edge,x,y) {
    const along=g.vertical?y:x;
    for(let i=0;i<g.cells.length;i++){
        const cell=g.cells[i];
        if(along>=cell.start-6&&along<=cell.start+cell.extent+6)return {kind:cell.kind,index:i,ref:cell.ref};
    }
    if(along>=g.gearAlong-D.gearCell/2-4&&along<=g.gearAlong+D.gearCell/2+4)return {kind:'gear',index:-1};
    return null;
}
