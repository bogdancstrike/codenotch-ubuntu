// Development-only: shared Cairo-style renderer -> SVG -> PNG using Sharp.
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const sharp=require(require.resolve('sharp',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
class CairoSVG {
 constructor(){this.out=[];this.state={matrix:[1,0,0,1,0,0],color:'#fff',size:12,weight:'normal',line:1,cap:'butt',rule:'nonzero'};this.stack=[];this.newPath();}
 get transform(){return `matrix(${this.state.matrix.join(' ')})`;}
 setSourceRGBA(r,g,b,a){this.state.color=`rgba(${r*255},${g*255},${b*255},${a})`;}
 selectFontFace(f,s,w){this.state.weight=w?'bold':'normal';}setFontSize(n){this.state.size=n;}
 textExtents(t){let width=0;for(const c of String(t))width+=/[ilI .,:]/.test(c)?.28:/[MW@%]/.test(c)?.88:.55;return {width:width*this.state.size};}
 showText(t){this.out.push(`<text x="${this.tx}" y="${this.ty}" transform="${this.transform}" font-family="DejaVu Sans, sans-serif" font-size="${this.state.size}" font-weight="${this.state.weight}" fill="${this.state.color}">${esc(t)}</text>`);}
 newPath(){this.d='';this.hasPoint=false;}moveTo(x,y){this.tx=x;this.ty=y;this.d+=`M${x},${y} `;this.hasPoint=true;}lineTo(x,y){this.d+=`L${x},${y} `;this.hasPoint=true;}
 arc(x,y,r,a,b){this._arc(x,y,r,a,b,false);}arcNegative(x,y,r,a,b){this._arc(x,y,r,a,b,true);}
 _arc(x,y,r,a,b,negative){const sx=x+r*Math.cos(a),sy=y+r*Math.sin(a);this.hasPoint?this.lineTo(sx,sy):this.moveTo(sx,sy);let delta=b-a;if(negative){while(delta>0)delta-=Math.PI*2;}else{while(delta<0)delta+=Math.PI*2;}const steps=Math.max(1,Math.ceil(Math.abs(delta)/Math.PI));for(let i=1;i<=steps;i++){const t=a+delta*i/steps;this.d+=`A${r},${r} 0 0 ${negative?0:1} ${x+r*Math.cos(t)},${y+r*Math.sin(t)} `;}}
 closePath(){this.d+='Z ';}setFillRule(r){this.state.rule=r===1?'evenodd':'nonzero';}
 fill(){this.out.push(`<path d="${this.d}" transform="${this.transform}" fill="${this.state.color}" fill-rule="${this.state.rule}"/>`);this.newPath();}
 stroke(){this.out.push(`<path d="${this.d}" transform="${this.transform}" fill="none" stroke="${this.state.color}" stroke-width="${this.state.line}" stroke-linecap="${this.state.cap}"/>`);this.newPath();}
 setLineWidth(w){this.state.line=w;}setLineCap(n){this.state.cap=['butt','round','square'][n];}
 save(){this.stack.push(structuredClone(this.state));}restore(){this.state=this.stack.pop();}translate(x,y){this.state.matrix=mul(this.state.matrix,[1,0,0,1,x,y]);}scale(x,y){this.state.matrix=mul(this.state.matrix,[x,0,0,y,0,0]);}rotate(a){this.state.matrix=mul(this.state.matrix,[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]);}
}
(async()=>{
 const root=path.resolve(__dirname,'..');const {drawNotch,drawCard,text,P}=await import(pathToFileURL(path.join(root,'extension/render.js')));const cr=new CairoSVG();
 const ps=[{name:'Claude',glyph:'claude',status:'ok',windows:[{label:'Current session',fraction:.73,resetsAt:Date.now()/1000+3060},{label:'All models',fraction:.07,resetsAt:Date.now()/1000+172800}],sessions:[]},{name:'Codex',glyph:'openai',status:'ok',windows:[{label:'5h limit',fraction:.21}],sessions:[]},{name:'Cursor',glyph:'cursor',status:'ok',windows:[{label:'Included usage',fraction:.52}],sessions:[]}];
 text(cr,'CODENOTCH / UBUNTU',48,52,22,'#EDF1F5','left',true);text(cr,'Original geometry and artwork · sample usage · settings divider',48,82,15,'#919EAC');
 for(const [edge,x,y] of [['right',690,140],['left',850,140],['top',80,735],['bottom',850,825]]){cr.save();cr.translate(x,y);cr.scale(1.5,1.5);drawNotch(cr,ps,edge,false,0);cr.restore();text(cr,edge.toUpperCase(),x,y-18,12,'#919EAC');}
 cr.save();cr.translate(260,250);cr.scale(1.6,1.6);drawCard(cr,ps[0]);cr.restore();
 cr.save();cr.translate(1390,245);cr.scale(2,2);drawNotch(cr,ps,'right',true);cr.restore();text(cr,'RESTING PILL',1280,210,12,'#919EAC');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100"><rect width="1600" height="1100" fill="#141C27"/>${cr.out.join('')}</svg>`;
 fs.writeFileSync(path.join(root,'docs/preview.svg'),svg);await sharp(Buffer.from(svg)).png().toFile(path.join(root,'docs/preview.png'));console.log('Shared renderer preview generated in docs/preview.png');
})().catch(e=>{console.error(e);process.exit(1);});
