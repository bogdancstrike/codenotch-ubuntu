// Geometry and palette ported from vinzdg/codenotch (MIT, Copyright 2026 Vinz).
// Pure drawing module; used unchanged by GNOME and the screenshot harness.
import {GLYPHS} from './glyphs.js';

export const PX=44/117;
export const D={
    depth:186*PX,flare:103*PX,corner:78.8*PX,ring:44,track:15.5*PX,stroke:8*PX,glyph:46*PX,
    gap:26.9*PX,line:19,padStart:69.5*PX,padEnd:50.1*PX,spacing:83.5*PX,
    widgetSpacing:19,groupGap:26,dividerGap:15,gearCell:34,gear:15,
    peekDepth:26*PX,peekLength:210*PX,handle:3,handleLength:34,
    cardWidth:272,cardPad:20,cardCorner:22,tail:75*PX,tailHeight:87*PX,tailGap:10,
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
let engine=cairoText;
// GNOME swaps in a Pango engine: real hinting and metrics, far crisper small text.
export function setTextEngine(fn) {engine=fn??cairoText;}
export function text(cr,value,x,y,size=12,hex=P.white,align='left',weight=W.regular,opts={}) {
    engine(cr,String(value),x,y,size,hex,align,weight,opts);
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
export const WIDGET_EXTENT={clock:[30,64],date:[40,66],weather:[50,64],battery:[34,54],system:[46,58]};
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
        const s=data??{};
        const rows=[['CPU',s.cpu,P.green],['RAM',s.mem,'#5AC8FA']];
        rows.forEach(([label,value,hex],i)=>{
            const offset=horizontal?-6+i*15:-half+14+i*20;
            const [x,y]=horizontal?at(0,-offset):at(offset);
            const left=x-(horizontal?26:25);
            text(cr,label,left,y+(horizontal?3:2),10,muted,'left',W.semi,{alpha,tracking:.6});
            meter(cr,left+24,y+(horizontal?-1:-2),horizontal?28:26,value??0,hex,alpha);
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
function wrap(s,width=40){const words=String(s).split(/\s+/);const lines=[];let line='';for(const word of words){if((line+' '+word).length>width&&line){lines.push(line);line='';}line+=(line?' ':'')+word;}if(line)lines.push(line);return lines.slice(0,5);}

export function cardLayout(p,maxHeight=650) {
    const windows=(p.windows??[]).slice(0,8),notes=['ok'].includes(p.status)?[]:wrap(p.message??'No usage available.');
    const base=2*D.cardPad+D.glyph+10+notes.length*15+windows.length*52;
    const cap=Math.max(0,Math.min(12,Math.floor((maxHeight-base-30)/40)));
    const sessions=(p.sessions??[]).slice(0,cap);
    return {windows,notes,sessions,height:base+(sessions.length?17+sessions.length*40:0)+((p.sessions?.length??0)>sessions.length?18:0)};
}
export function drawCard(cr,p,width=D.cardWidth,maxHeight=650,settings={}) {
    const l=cardLayout(p,maxHeight),pad=D.cardPad;
    const muted=tone(settings,'muted'),dim=tone(settings,'dim');
    roundRect(cr,0,0,width,l.height,D.cardCorner);color(cr,P.shell);cr.fill();
    color(cr,P.line,.6);cr.setLineWidth(1);roundRect(cr,.5,.5,width-1,l.height-1,D.cardCorner);cr.stroke();
    glyph(cr,p.glyph,pad+D.glyph/2,pad+D.glyph/2);
    text(cr,clipped(p.name+' usage',24),pad+D.glyph+10,pad+13,14.5,P.white,'left',W.semi,{tracking:-.1});
    let y=pad+D.glyph+12;
    for(const line of l.notes){text(cr,line,pad,y+10,11,muted,'left',W.regular);y+=15;}
    for(const w of l.windows){
        text(cr,clipped(w.label,20),pad,y+10,12.5,dim,'left',W.medium);
        text(cr,resetCopy(w.resetsAt),width-pad,y+10,10.5,muted,'right',W.regular);y+=19;
        roundRect(cr,pad,y,width-2*pad,5,2.5);color(cr,P.bar);cr.fill();
        if(Number.isFinite(w.fraction)&&w.fraction>0){roundRect(cr,pad,y,(width-2*pad)*Math.min(1,w.fraction),5,2.5);color(cr,band(w.fraction));cr.fill();}
        y+=17;text(cr,`${Math.round(w.fraction*100)}% used`,pad,y,12,P.white,'left',W.semi);y+=16;
    }
    if(l.sessions.length){cr.newPath();cr.moveTo(pad,y);cr.lineTo(width-pad,y);color(cr,P.line);cr.setLineWidth(1);cr.stroke();y+=17;}
    for(const s of l.sessions){
        text(cr,clipped(s.name,23),pad,y+9,12,P.white,'left',W.medium);
        text(cr,s.state==='busy'?'working':s.state,width-pad,y+9,10.5,s.state==='waiting'?P.amber:s.state==='busy'?P.green:muted,'right',W.semi);
        text(cr,clipped(s.detail,36),pad,y+25,10.5,muted,'left',W.regular);y+=40;
    }
    if((p.sessions?.length??0)>l.sessions.length)text(cr,`and ${p.sessions.length-l.sessions.length} more`,pad,y+9,10.5,muted,'left',W.regular);
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
        return {title:'Date',headline:now.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'}),
            rows:[['Year',String(now.getFullYear())],
                  ['ISO',now.toISOString().slice(0,10)],
                  ['Time',clockParts(settings,now).time]]};
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
        if(Number.isFinite(s.cpu))rows.push(['CPU',`${Math.round(s.cpu*100)}% busy`]);
        if(Number.isFinite(s.mem))rows.push(['Memory',`${Math.round(s.mem*100)}% used`]);
        if(Number.isFinite(s.memUsed))rows.push(['Detail',`${s.memUsed} of ${s.memTotal} GiB`]);
        return {title:'System',headline:Number.isFinite(s.cpu)?`${Math.round(s.cpu*100)}% CPU`:'—',rows};
    }
    return {title:kind,headline:'',rows};
}
export function widgetCardLayout(card) {
    return {height:2*D.cardPad+(card.headline?46:22)+card.rows.length*22};
}
export function drawWidgetCard(cr,card,width=D.cardWidth,settings={}) {
    const l=widgetCardLayout(card),pad=D.cardPad;
    const muted=tone(settings,'muted'),dim=tone(settings,'dim');
    roundRect(cr,0,0,width,l.height,D.cardCorner);color(cr,P.shell);cr.fill();
    color(cr,P.line,.6);cr.setLineWidth(1);roundRect(cr,.5,.5,width-1,l.height-1,D.cardCorner);cr.stroke();
    let y=pad+11;
    if(card.symbol)weatherSymbol(cr,card.symbol,width-pad-13,pad+12,24,1);
    text(cr,clipped(card.title,22).toUpperCase(),pad,y,10,muted,'left',W.semi,{tracking:1});y+=20;
    if(card.headline){text(cr,clipped(card.headline,24),pad,y+4,19,P.white,'left',W.semi,{tracking:-.3});y+=26;}
    for(const [label,value] of card.rows){
        text(cr,label,pad,y+10,11.5,muted,'left',W.regular);
        text(cr,clipped(value,26),width-pad,y+10,11.5,dim,'right',W.medium);y+=22;
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
