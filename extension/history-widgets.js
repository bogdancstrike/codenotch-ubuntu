import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';
import {compactCount,costText,formatUSD} from './history-model.js';

// One spacing scale for the whole settings window: GAP separates cards and
// sections, INNER separates elements inside a card.
export const GAP=24,INNER=12;
// Validated categorical slots (light, dark); fixed order, never cycled.
const SERIES=[[[.165,.471,.839],[.224,.529,.898]],[[.922,.408,.204],[.851,.349,.149]],
    [[.106,.686,.478],[.098,.620,.439]],[[.929,.631,0],[.788,.522,0]]];
const seriesColor=(cr,index,alpha=1)=>{const [r,g,b]=SERIES[index][Adw.StyleManager.get_default().get_dark()?1:0];cr.setSourceRGBA(r,g,b,alpha);};

export function clear(box) {let child;while((child=box.get_first_child()))box.remove(child);}
export function label(text,classes=[],props={}) {
    return new Gtk.Label({label:String(text),xalign:0,wrap:true,css_classes:classes,...props});
}
export function button(text,props={}) {
    const widget=new Gtk.Button({label:text,valign:Gtk.Align.CENTER,...props});widget.add_css_class('codenotch-action');return widget;
}
export function section(parent,title,description='') {
    const group=new Adw.PreferencesGroup({title,description});parent.append(group);return group;
}
// Equal-width columns whose outer edges line up with full-width cards.
export function columns(parent) {
    const row=new Gtk.Box({spacing:GAP,homogeneous:true,hexpand:true});parent.append(row);return row;
}
export function card(parent,title,subtitle='',suffix=null) {
    const box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:INNER,hexpand:true,css_classes:['card','usage-card']});
    const header=new Gtk.Box({spacing:INNER});box.append(header);
    const text=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:4,hexpand:true,valign:Gtk.Align.CENTER});header.append(text);
    box.title=title;text.append(label(title,['heading']));
    box.subtitle=label(subtitle,['caption','dim-label'],{visible:!!subtitle});text.append(box.subtitle);
    if(suffix){suffix.set_valign(Gtk.Align.CENTER);header.append(suffix);}
    parent.append(box);return box;
}
export function metrics(parent,items) {
    const row=columns(parent);
    for(const [title,value,detail] of items){
        const box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:4,css_classes:['card','usage-metric']});
        box.append(label(title,['caption-heading','dim-label']));
        box.append(label(value,['title-2'],{wrap:false,ellipsize:Pango.EllipsizeMode.END}));
        box.append(label(detail,['caption','dim-label']));row.append(box);
    }
    return row;
}
export function breakdown(group,rows,total,onSelect=null) {
    if(!rows.length){group.add(new Adw.ActionRow({title:'No recorded data',subtitle:'Try another period or clear the filters.'}));return;}
    for(const item of rows){
        const share=total?item.tokens/total:0;
        const row=new Adw.ActionRow({title:item.label,subtitle:`${compactCount(item.tokens)} tokens · ${(share*100).toFixed(1)}% · ${costText(item)}`,
            activatable:!!onSelect,use_markup:false});
        const bar=new Gtk.ProgressBar({fraction:Math.min(1,share),width_request:120,valign:Gtk.Align.CENTER});
        bar.set_tooltip_text(`${item.tokens.toLocaleString()} tokens`);row.add_suffix(bar);
        if(onSelect){row.add_suffix(new Gtk.Image({icon_name:'go-next-symbolic'}));row.connect('activated',()=>onSelect(item.id));}
        group.add(row);
    }
}
export function legend(parent,names) {
    const box=new Gtk.Box({spacing:INNER,halign:Gtk.Align.START});parent.append(box);
    names.forEach((name,index)=>{
        const item=new Gtk.Box({spacing:6});box.append(item);
        const swatch=new Gtk.DrawingArea({content_width:10,content_height:10,valign:Gtk.Align.CENTER});
        swatch.set_draw_func((_area,cr,w,h)=>{seriesColor(cr,index);roundRect(cr,0,0,w,h,2);cr.fill();});
        item.append(swatch);item.append(label(name,['caption']));
    });
    return box;
}
function roundRect(cr,x,y,w,h,r) {
    r=Math.max(0,Math.min(r,w/2,h/2));
    cr.newSubPath();cr.arc(x+w-r,y+r,r,-Math.PI/2,0);cr.lineTo(x+w,y+h);cr.lineTo(x,y+h);cr.arc(x+r,y+r,r,Math.PI,Math.PI*1.5);cr.closePath();
}
// Card plus chart; the card's subtitle carries the scale.
export function barChart(parent,title,entries,options={}) {
    const box=card(parent,title,'',options.suffix??null);
    chart(box,entries,options);return box;
}
// Native Cairo chart with keyboard selection and exact-value tooltips.
// Modes: bars, stacked (entry.parts), line (with area fill).
export function chart(box,entries,{unit='tokens',onSelect=null,mode='bars',series=null,height=160,scale=box.subtitle,title=box.title}={}) {
    const values=entries.map(e=>e.value??0);
    const max=Math.max(0,...values);
    const format=value=>unit==='USD'?formatUSD(value):compactCount(value);
    const unitName=unit==='USD'?'estimated USD':unit;
    if(scale){scale.set_label(`Scale 0–${format(max)} ${unitName}`);scale.set_visible(true);}
    if(series)legend(box,series);
    const area=new Gtk.DrawingArea({content_height:height,hexpand:true,focusable:true,has_tooltip:true});box.append(area);
    area.update_property([Gtk.AccessibleProperty.LABEL],[`${title??'Chart'}. ${entries.length} values. Use arrow keys for values.${onSelect?' Enter opens day details.':''}`]);
    let selected=-1;
    const detail=label('Hover or use arrow keys to inspect values.',['caption','dim-label']);
    const describe=i=>{
        const e=entries[i];if(!e)return '';
        if(e.value===null)return `${e.label}: No recorded data${unit==='USD'?' or price':''}`;
        const parts=series&&e.parts?' · '+series.map((name,k)=>`${name} ${format(e.parts[k])}`).join(' · '):'';
        return `${e.label}: ${format(e.value)} ${unitName}${e.partial?' · partial estimate':''}${parts}`;
    };
    const choose=i=>{
        selected=Math.max(0,Math.min(entries.length-1,i));
        const text=describe(selected);area.set_tooltip_text(text);detail.set_label(text);
        area.update_property([Gtk.AccessibleProperty.LABEL],[`${title??'Chart'}. ${text}`]);area.queue_draw();
    };
    area.set_draw_func((_area,cr,width,height)=>{
        const base=height-1,plot=height-8,step=width/Math.max(1,entries.length);
        const y=value=>base-value/(max||1)*plot;
        cr.setSourceRGBA(.5,.5,.5,.12);cr.setLineWidth(1);
        for(const f of [.5,1]){cr.moveTo(0,Math.round(y(max*f))+.5);cr.lineTo(width,Math.round(y(max*f))+.5);}cr.stroke();
        if(selected>=0){cr.setSourceRGBA(.5,.5,.5,.14);cr.rectangle(selected*step,0,step,height);cr.fill();}
        cr.setSourceRGBA(.5,.5,.5,.4);cr.moveTo(0,base+.5);cr.lineTo(width,base+.5);cr.stroke();
        if(mode==='line'){
            const points=entries.map((e,i)=>e.value===null?null:[(i+.5)*step,y(e.value)]);
            let run=[];const runs=[];
            for(const p of points){if(p)run.push(p);else if(run.length){runs.push(run);run=[];}}if(run.length)runs.push(run);
            for(const r of runs){
                seriesColor(cr,0,.14);cr.moveTo(r[0][0],base);for(const [x,v] of r)cr.lineTo(x,v);cr.lineTo(r.at(-1)[0],base);cr.closePath();cr.fill();
                seriesColor(cr,0);cr.setLineWidth(2);cr.moveTo(...r[0]);for(const p of r.slice(1))cr.lineTo(...p);cr.stroke();
                if(r.length===1){cr.arc(r[0][0],r[0][1],3,0,Math.PI*2);cr.fill();}
            }
            if(points[selected]){seriesColor(cr,0);cr.arc(...points[selected],4.5,0,Math.PI*2);cr.fill();}
            return;
        }
        const gap=step>6?Math.min(4,step/4):Math.min(1,step/4),w=Math.max(1,step-gap),radius=Math.min(4,w/2);
        entries.forEach((entry,i)=>{
            const x=i*step+gap/2;
            if(entry.value===null||!entry.value){cr.setSourceRGBA(.5,.5,.5,entry.value===null?.35:.6);cr.rectangle(x,base-2,w,2);cr.fill();return;}
            if(mode==='stacked'&&entry.parts){
                let top=base;const visible=entry.parts.map((v,k)=>[v,k]).filter(([v])=>v>0);
                visible.forEach(([v,k],n)=>{
                    const h=v/(max||1)*plot,last=n===visible.length-1;
                    seriesColor(cr,k);
                    // A 2px surface gap separates segments; only the top segment is rounded.
                    const segment=Math.max(1,h-(last?0:2));
                    if(last)roundRect(cr,x,top-segment,w,segment,radius);else cr.rectangle(x,top-segment,w,segment);
                    cr.fill();top-=h;
                });
                return;
            }
            const h=Math.max(2,entry.value/(max||1)*plot);
            seriesColor(cr,0,entry.partial?.6:1);roundRect(cr,x,base-h,w,h,radius);cr.fill();
        });
    });
    const at=x=>Math.floor(x/Math.max(1,area.get_width())*entries.length);
    const motion=new Gtk.EventControllerMotion();motion.connect('motion',(_event,x)=>{if(entries.length)choose(at(x));});area.add_controller(motion);
    const keys=new Gtk.EventControllerKey();keys.connect('key-pressed',(_event,key)=>{
        if(!entries.length)return false;
        if([Gdk.KEY_Left,Gdk.KEY_Right,Gdk.KEY_Home,Gdk.KEY_End].includes(key)){
            choose(key===Gdk.KEY_Home?0:key===Gdk.KEY_End?entries.length-1:selected+(key===Gdk.KEY_Left?-1:1));return true;
        }
        if(onSelect&&selected>=0&&[Gdk.KEY_Return,Gdk.KEY_space].includes(key)){onSelect(entries[selected]);return true;}return false;
    });area.add_controller(keys);
    if(onSelect){
        area.set_cursor(Gdk.Cursor.new_from_name('pointer',null));
        const click=new Gtk.GestureClick();click.connect('released',(_gesture,_n,x)=>{choose(at(x));if(selected>=0)onSelect(entries[selected]);});area.add_controller(click);
    }
    const axis=new Gtk.Box({hexpand:true});
    if(entries.length<=7){
        axis.set_homogeneous(true);
        for(const entry of entries)axis.append(label(entry.label,['caption','dim-label'],{xalign:.5,wrap:false}));
    }else{
        const ticks=entries.length===24?[0,6,12,18,23]:[0,Math.floor((entries.length-1)/2),entries.length-1];
        axis.set_homogeneous(true);
        ticks.forEach((index,n)=>axis.append(label(entries[index]?.label??'',['caption','dim-label'],
            {xalign:n===0?0:n===ticks.length-1?1:.5,wrap:false})));
    }
    box.append(axis);box.append(detail);return area;
}
// Ranked horizontal bars; rows are buttons so drilldowns work by keyboard.
export function rankChart(parent,title,subtitle,items,total,onSelect=null,limit=5) {
    const box=card(parent,title,subtitle);
    if(!items.length){box.append(label('No recorded data in this period.',['dim-label']));return box;}
    const shown=items.slice(0,limit),rest=items.slice(limit).reduce((sum,item)=>sum+item.tokens,0);
    const rows=rest>0?[...shown,{id:null,label:`Other (${items.length-limit})`,tokens:rest}]:shown;
    const max=Math.max(1,...rows.map(r=>r.tokens));
    const list=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:4});box.append(list);
    for(const item of rows){
        const share=total?item.tokens/total:0;
        const row=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:6});
        const top=new Gtk.Box({spacing:INNER});row.append(top);
        top.append(label(item.label,[],{hexpand:true,wrap:false,ellipsize:Pango.EllipsizeMode.END}));
        top.append(label(`${compactCount(item.tokens)} · ${(share*100).toFixed(1)}%`,['caption','dim-label','numeric'],{xalign:1,wrap:false}));
        const bar=new Gtk.DrawingArea({content_height:8,hexpand:true});row.append(bar);
        bar.set_draw_func((_area,cr,w,h)=>{
            cr.setSourceRGBA(.5,.5,.5,.14);roundRect(cr,0,0,w,h,h/2);cr.fill();
            seriesColor(cr,0,item.id===null?.45:1);roundRect(cr,0,0,Math.max(h,item.tokens/max*w),h,h/2);cr.fill();
        });
        const tooltip=`${item.label}: ${item.tokens.toLocaleString()} tokens`;
        if(onSelect&&item.id!==null){
            const action=new Gtk.Button({child:row,css_classes:['flat','usage-rank'],tooltip_text:`${tooltip} · Select to filter`});
            action.connect('clicked',()=>onSelect(item.id));list.append(action);
        }else{row.set_tooltip_text(tooltip);row.add_css_class('usage-rank');list.append(row);}
    }
    return box;
}
export class HistoryTable {
    constructor(parent,onSelect) {
        this.rows=[];this.offset=0;this.ascending=false;this.onSelect=onSelect;
        this.box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:INNER});parent.append(this.box);
        const toolbar=new Gtk.Box({spacing:INNER});this.box.append(toolbar);
        this.sort=button('Newest first');toolbar.append(this.sort);
        this.sort.connect('clicked',()=>{this.ascending=!this.ascending;this.offset=0;this.render();});
        this.count=label('', ['dim-label'],{hexpand:true,xalign:1});toolbar.append(this.count);
        const pager=new Gtk.Box({css_classes:['linked']});toolbar.append(pager);
        this.previous=new Gtk.Button({icon_name:'go-previous-symbolic',tooltip_text:'Previous 10 days'});
        this.next=new Gtk.Button({icon_name:'go-next-symbolic',tooltip_text:'Next 10 days'});
        pager.append(this.previous);pager.append(this.next);
        this.previous.connect('clicked',()=>{this.offset=Math.max(0,this.offset-10);this.render();});
        this.next.connect('clicked',()=>{this.offset+=10;this.render();});
        this.scroller=new Gtk.ScrolledWindow({hscrollbar_policy:Gtk.PolicyType.AUTOMATIC,vscrollbar_policy:Gtk.PolicyType.NEVER,propagate_natural_height:true});
        this.box.append(this.scroller);
    }
    setRows(rows) {this.rows=rows.filter(r=>r.recorded);this.offset=0;this.render();}
    render() {
        const rows=[...this.rows].sort((a,b)=>this.ascending?a.date.localeCompare(b.date):b.date.localeCompare(a.date));
        this.sort.set_label(this.ascending?'Oldest first':'Newest first');
        this.previous.set_sensitive(this.offset>0);this.next.set_sensitive(this.offset+10<rows.length);
        this.count.set_label(rows.length?`${this.offset+1}–${Math.min(rows.length,this.offset+10)} of ${rows.length} days`:'No recorded days');
        const grid=new Gtk.Grid({column_spacing:INNER,row_spacing:4,hexpand:true,css_classes:['card','usage-table']});
        this.scroller.set_child(grid);
        ['Day','Input','Output','Cache read','Cache write','Total','Est. USD'].forEach((text,col)=>
            grid.attach(label(text,['caption-heading','dim-label'],{xalign:col?1:0}),col,0,1,1));
        rows.slice(this.offset,this.offset+10).forEach((row,index)=>{
            const day=new Gtk.Button({label:row.date,css_classes:['flat'],tooltip_text:'Open day details',halign:Gtk.Align.START});
            day.connect('clicked',()=>this.onSelect(row));grid.attach(day,0,index+1,1,1);
            ['input','output','cacheRead','cacheWrite','tokens','estimatedCost'].forEach((key,col)=>{
                const cell=label(key==='estimatedCost'?costText(row):compactCount(row[key]),['numeric'],{xalign:1,hexpand:true,wrap:false});
                cell.set_tooltip_text(key==='estimatedCost'?costText(row):row[key].toLocaleString());grid.attach(cell,col+1,index+1,1,1);
            });
        });
    }
}
