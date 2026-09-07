#!/usr/bin/gjs -m
// Renders the README images through the exact code GNOME Shell runs: the
// extension's render.js plus its Pango text engine, straight onto a cairo
// surface. If this script draws, the shell can draw.
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import GLib from 'gi://GLib';
import cairo from 'cairo';

const here=GLib.path_get_dirname(import.meta.url.replace('file://',''));
const R=await import(`file://${here}/../extension/render.js`);
const {D,W,P,plan,drawNotch,drawCard,drawWidgetCard,widgetCard,text,color,setTextEngine,roundRect}=R;

function pangoLayout(cr,value,size,weight,opts={}) {
    const layout=PangoCairo.create_layout(cr);
    const description=Pango.FontDescription.from_string('Sans');
    description.set_absolute_size(size*Pango.SCALE);
    description.set_weight(weight??W.regular);
    layout.set_font_description(description);
    if(opts.tracking){const list=Pango.AttrList.new();list.insert(Pango.attr_letter_spacing_new(Math.round(opts.tracking*Pango.SCALE)));layout.set_attributes(list);}
    layout.set_text(value,-1);
    return layout;
}
function pangoEngine(cr,value,x,y,size,hex,align,weight,opts) {
    const layout=pangoLayout(cr,value,size,weight,opts);
    const [width]=layout.get_pixel_size();
    cr.moveTo(x-(align==='center'?width/2:align==='right'?width:0),y-layout.get_baseline()/Pango.SCALE);
    color(cr,hex,opts.alpha??1);
    PangoCairo.show_layout(cr,layout);
}
function pangoMeasure(cr,value,size,weight) {
    return pangoLayout(cr,value,size,weight).get_pixel_size()[0];
}
setTextEngine(pangoEngine,pangoMeasure);

const now=new Date(2026,8,7,14,5,0);
const providers=[
  {name:'Claude',glyph:'claude',status:'ok',windows:[{label:'Current session',fraction:.73,resetsAt:Date.now()/1000+3060},{label:'All models',fraction:.07,resetsAt:Date.now()/1000+172800}],sessions:[{name:'codenotch-ubuntu',detail:'~/workspace/dev/codenotch-ubuntu',state:'busy'}]},
  {name:'Codex',glyph:'openai',status:'ok',windows:[{label:'5h limit',fraction:.21}],sessions:[]},
  {name:'Cursor',glyph:'cursor',status:'ok',windows:[{label:'Included usage',fraction:.52}],sessions:[]}];
const settings={clock24:true,dateStyle:'medium',textContrast:'high',peek:true};
const data={weather:{temp:21,feels:20,high:24,low:13,humidity:48,wind:9,text:'Partly cloudy',symbol:'partly',unit:'C',windUnit:'km/h',place:'Bucharest, Romania',updatedAt:Date.now()/1000},
            system:{cpu:.34,mem:.52,memUsed:8.3,memTotal:16},
            battery:{percent:76,charging:false,state:'Discharging',name:'BAT0'}};

function canvas(width,height,paint) {
    const surface=new cairo.ImageSurface(cairo.Format.ARGB32,width,height);
    const cr=new cairo.Context(surface);
    color(cr,'#12161C');roundRect(cr,0,0,width,height,18);cr.fill();
    paint(cr);
    surface.flush();
    return surface;
}
function notch(cr,x,y,scale,widgets,edge='right',folded=false) {
    cr.save();cr.translate(x,y);cr.scale(scale,scale);
    drawNotch(cr,{providers,widgets,data,settings,edge,folded,progress:1,now});
    cr.restore();
}
const label=(cr,value,x,y)=>text(cr,value,x,y,13,'#8C97A4','left',W.semi,{tracking:1.1});
const out=name=>`${here}/../docs/${name}.png`;

// ---- hero --------------------------------------------------------------
{
    const full=plan(providers,['clock','date','weather'],'right');
    const height=Math.round(150+full.length*1.5+40);
    canvas(1010,height,cr=>{
        text(cr,'CODENOTCH',48,62,30,'#F2F5F8','left',W.bold,{tracking:-.5});
        text(cr,'AI usage rings, clock, date and weather at the edge of your Ubuntu desktop.',48,94,15.5,'#8C97A4','left',W.regular,{});
        label(cr,'HOVER CARDS',48,136);
        cr.save();cr.translate(48,150);cr.scale(1.45,1.45);drawCard(cr,providers[0],undefined,650,settings);cr.restore();
        cr.save();cr.translate(48,516);cr.scale(1.45,1.45);drawWidgetCard(cr,widgetCard('weather',data.weather,settings,now),undefined,settings);cr.restore();
        cr.save();cr.translate(48,836);cr.scale(1.45,1.45);drawWidgetCard(cr,widgetCard('system',data.system,settings,now),undefined,settings);cr.restore();
        label(cr,'THE NOTCH',560,136);
        notch(cr,560,150,1.5,['clock','date','weather']);
        label(cr,'RESTING SLIVER',820,136);
        notch(cr,830,310,3,['clock','date','weather'],'right',true);
    }).writeToPNG(out('preview'));
}
// ---- widget ladder -----------------------------------------------------
{
    const sets=[[[],'RINGS ONLY'],[['clock','date'],'+ CLOCK & DATE'],[['clock','date','weather'],'+ WEATHER'],[['clock','date','weather','system'],'+ SYSTEM LOAD']];
    const tallest=plan(providers,['clock','date','weather','system'],'right');
    canvas(60+sets.length*230,Math.round(80+tallest.length*1.15+40),cr=>{
        let x=60;
        for(const [widgets,name] of sets){label(cr,name,x-10,58);notch(cr,x,76,1.15,widgets);x+=230;}
    }).writeToPNG(out('preview-widgets'));
}
// ---- horizontal edges --------------------------------------------------
{
    const g=plan(providers,['clock','date','weather'],'top');
    canvas(Math.round(80+g.length*1.15),Math.round(210+g.depth*2.3),cr=>{
        label(cr,'TOP EDGE',44,42);
        notch(cr,40,58,1.15,['clock','date','weather'],'top');
        label(cr,'BOTTOM EDGE',44,Math.round(150+g.depth*1.15));
        notch(cr,40,Math.round(166+g.depth*1.15),1.15,['clock','date','weather'],'bottom');
    }).writeToPNG(out('preview-edges'));
}
print('Shell-accurate previews written to docs/preview*.png');
