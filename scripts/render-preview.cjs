// Development-only: shared Cairo-style renderer -> SVG -> PNG.
// Uses the extension's own drawing code, so the README images can never drift
// from what GNOME actually paints. PNGs are rasterised with gjs + librsvg.
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {spawnSync}=require('node:child_process');
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
class CairoSVG {
 constructor(){this.out=[];this.state={matrix:[1,0,0,1,0,0],color:'#fff',size:12,weight:'normal',line:1,cap:'butt',rule:'nonzero'};this.stack=[];this.newPath();}
 get transform(){return `matrix(${this.state.matrix.join(' ')})`;}
 setSourceRGBA(r,g,b,a){this.state.color=`rgba(${r*255},${g*255},${b*255},${a})`;}
 selectFontFace(f,s,w){this.state.weight=w?'bold':'normal';}setFontSize(n){this.state.size=n;}
 textExtents(t){let width=0;for(const c of String(t))width+=/[ilI .,:]/.test(c)?.28:/[MW@%]/.test(c)?.88:.55;return {width:width*this.state.size};}
 showText(t){this.out.push(`<text x="${this.tx}" y="${this.ty}" transform="${this.transform}" font-family="Ubuntu, DejaVu Sans, sans-serif" font-size="${this.state.size}" font-weight="${this.state.weight}" fill="${this.state.color}">${esc(t)}</text>`);}
 newPath(){this.d='';this.hasPoint=false;}newSubPath(){this.hasPoint=false;}
 moveTo(x,y){this.tx=x;this.ty=y;this.d+=`M${x},${y} `;this.hasPoint=true;}lineTo(x,y){this.d+=`L${x},${y} `;this.hasPoint=true;}
 arc(x,y,r,a,b){this._arc(x,y,r,a,b,false);}arcNegative(x,y,r,a,b){this._arc(x,y,r,a,b,true);}
 _arc(x,y,r,a,b,negative){const sx=x+r*Math.cos(a),sy=y+r*Math.sin(a);this.hasPoint?this.lineTo(sx,sy):this.moveTo(sx,sy);let delta=b-a;if(negative){while(delta>0)delta-=Math.PI*2;}else{while(delta<0)delta+=Math.PI*2;}const steps=Math.max(1,Math.ceil(Math.abs(delta)/Math.PI));for(let i=1;i<=steps;i++){const t=a+delta*i/steps;this.d+=`A${r},${r} 0 0 ${negative?0:1} ${x+r*Math.cos(t)},${y+r*Math.sin(t)} `;}}
 closePath(){this.d+='Z ';}setFillRule(r){this.state.rule=r===1?'evenodd':'nonzero';}
 fill(){this.out.push(`<path d="${this.d}" transform="${this.transform}" fill="${this.state.color}" fill-rule="${this.state.rule}"/>`);this.newPath();}
 stroke(){this.out.push(`<path d="${this.d}" transform="${this.transform}" fill="none" stroke="${this.state.color}" stroke-width="${this.state.line}" stroke-linecap="${this.state.cap}"/>`);this.newPath();}
 setLineWidth(w){this.state.line=w;}setLineCap(n){this.state.cap=['butt','round','square'][n];}
 save(){this.stack.push(structuredClone(this.state));}restore(){this.state=this.stack.pop();}
 translate(x,y){this.state.matrix=mul(this.state.matrix,[1,0,0,1,x,y]);}
 scale(x,y){this.state.matrix=mul(this.state.matrix,[x,0,0,y,0,0]);}
 rotate(a){this.state.matrix=mul(this.state.matrix,[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]);}
}
const BG='#12161C';
const root=path.resolve(__dirname,'..');
// The published images come from scripts/render-shell-preview.js, which uses the
// real Pango engine. This harness only proves the renderer runs without GNOME,
// so it writes to a scratch directory instead of docs/.
const outDir=process.env.CODENOTCH_PREVIEW_DIR||path.join(root,'build/preview');
fs.mkdirSync(outDir,{recursive:true});

function write(name,width,height,body){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="18" fill="${BG}"/>${body}</svg>`;
 const svgPath=path.join(outDir,`${name}.svg`);
 fs.writeFileSync(svgPath,svg);
 console.log(`  ${path.relative(root,svgPath)}`);
}

(async()=>{
 const R=await import(pathToFileURL(path.join(root,'extension/render.js')));
 const {drawNotch,drawCard,drawWidgetCard,widgetCard,text,W,plan}=R;
 const now=new Date(2026,8,7,14,5,0);
 const providers=[
  {name:'Claude',glyph:'claude',status:'ok',windows:[{label:'Current session',fraction:.73,resetsAt:Date.now()/1000+3060},{label:'All models',fraction:.07,resetsAt:Date.now()/1000+172800}],sessions:[{name:'codenotch-ubuntu',detail:'~/workspace/dev/codenotch-ubuntu',state:'busy'}]},
  {name:'Codex',glyph:'openai',status:'ok',windows:[{label:'5h limit',fraction:.21}],sessions:[]},
  {name:'Cursor',glyph:'cursor',status:'ok',windows:[{label:'Included usage',fraction:.52}],sessions:[]}];
 const settings={clock24:true,dateStyle:'medium',textContrast:'high',peek:true};
 const data={weather:{temp:21,feels:20,high:24,low:13,humidity:48,wind:9,text:'Partly cloudy',symbol:'partly',unit:'C',windUnit:'km/h',place:'Bucharest, Romania',updatedAt:Date.now()/1000},
             system:{cpu:.34,mem:.52,memUsed:8.3,memTotal:16},
             battery:{percent:76,charging:false,state:'Discharging',name:'BAT0'}};

 const draw=(cr,fn)=>{const before=cr.out.length;fn();return cr.out.slice(before);};
 const notch=(cr,x,y,scale,widgets,edge='right',folded=false)=>{
  cr.save();cr.translate(x,y);cr.scale(scale,scale);
  drawNotch(cr,{providers,widgets,data,settings,edge,folded,progress:1,now});cr.restore();
 };
 const label=(cr,value,x,y)=>text(cr,value,x,y,13,'#8C97A4','left',W.semi,{});

 // ---- hero -------------------------------------------------------------
 {
  const cr=new CairoSVG();
  text(cr,'CODENOTCH',48,60,30,'#F2F5F8','left',W.bold,{});
  text(cr,'AI usage rings, clock, date and weather at the edge of your Ubuntu desktop.',48,92,16,'#8C97A4','left',W.regular,{});
  cr.save();cr.translate(48,140);cr.scale(1.45,1.45);drawCard(cr,providers[0],undefined,650,settings);cr.restore();
  cr.save();cr.translate(48,520);cr.scale(1.45,1.45);drawWidgetCard(cr,widgetCard('weather',data.weather,settings,now),undefined,settings);cr.restore();
  cr.save();cr.translate(48,838);cr.scale(1.45,1.45);drawWidgetCard(cr,widgetCard('system',data.system,settings,now),undefined,settings);cr.restore();
  label(cr,'HOVER CARDS',48,128);
  label(cr,'THE NOTCH',560,128);
  notch(cr,560,140,1.5,['clock','date','weather']);
  label(cr,'RESTING SLIVER',820,128);
  notch(cr,830,300,3,['clock','date','weather'],'right',true);
  const g=plan(providers,['clock','date','weather'],'right');
  write('preview',1010,140+g.length*1.5+40,cr.out.join(''));
 }

 // ---- with and without widgets ----------------------------------------
 {
  const cr=new CairoSVG();
  const sets=[[[],'RINGS ONLY'],[['clock','date'],'+ CLOCK AND DATE'],[['clock','date','weather'],'+ WEATHER'],[['clock','date','weather','system'],'+ SYSTEM LOAD']];
  let x=60;
  for(const [widgets,name] of sets){
   label(cr,name,x-10,54);
   notch(cr,x,70,1.15,widgets);
   x+=230;
  }
  const tallest=plan(providers,['clock','date','weather','system'],'right');
  write('preview-widgets',x-40,70+tallest.length*1.15+40,cr.out.join(''));
 }

 // ---- horizontal edges -------------------------------------------------
 {
  const cr=new CairoSVG();
  label(cr,'TOP EDGE',56,40);
  notch(cr,40,56,1.15,['clock','date','weather'],'top');
  const g=plan(providers,['clock','date','weather'],'top');
  label(cr,'BOTTOM EDGE',56,150+g.depth*1.15);
  notch(cr,40,166+g.depth*1.15,1.15,['clock','date','weather'],'bottom');
  write('preview-edges',80+g.length*1.15,190+g.depth*2.3+40,cr.out.join(''));
 }
 console.log('Renderer ran headlessly; SVGs written for inspection.');
})().catch(e=>{console.error(e);process.exit(1);});
