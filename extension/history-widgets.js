import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import {compactCount,costText,formatUSD} from './history-model.js';

export function clear(box) {let child;while((child=box.get_first_child()))box.remove(child);}
export function label(text,classes=[],props={}) {
    return new Gtk.Label({label:String(text),xalign:0,wrap:true,css_classes:classes,...props});
}
export function section(parent,title,description='') {
    const group=new Adw.PreferencesGroup({title,description});parent.append(group);return group;
}
export function metrics(parent,items) {
    const flow=new Gtk.FlowBox({selection_mode:Gtk.SelectionMode.NONE,homogeneous:true,
        min_children_per_line:1,max_children_per_line:2,column_spacing:18,row_spacing:18});
    for(const [title,value,detail] of items){
        const box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:10,css_classes:['card','usage-metric']});
        box.append(label(title,['dim-label']));box.append(label(value,['title-1']));
        box.append(label(detail,['caption','dim-label']));flow.append(box);
    }
    parent.append(flow);return flow;
}
export function breakdown(group,rows,total,onSelect=null) {
    if(!rows.length){group.add(new Adw.ActionRow({title:'No recorded data',subtitle:'Try another period or clear the filters.'}));return;}
    for(const item of rows){
        const share=total?item.tokens/total:0;
        const row=new Adw.ActionRow({title:item.label,subtitle:`${compactCount(item.tokens)} tokens · ${(share*100).toFixed(1)}% · ${costText(item)}`,
            activatable:!!onSelect,use_markup:false});
        const bar=new Gtk.ProgressBar({fraction:Math.min(1,share),width_request:90,valign:Gtk.Align.CENTER});
        bar.set_tooltip_text(`${item.tokens.toLocaleString()} tokens`);row.add_suffix(bar);
        if(onSelect){row.add_suffix(new Gtk.Image({icon_name:'go-next-symbolic'}));row.connect('activated',()=>onSelect(item.id));}
        group.add(row);
    }
}
// Native Cairo chart with keyboard selection and exact-value tooltips.
export function barChart(parent,title,entries,{unit='tokens',onSelect=null}={}) {
    const box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:8,css_classes:['card','usage-chart']});
    parent.append(box);
    const max=Math.max(0,...entries.map(e=>e.value??0));
    const format=value=>unit==='USD'?formatUSD(value):compactCount(value);
    box.append(label(title,['heading']));
    box.append(label(`Scale: 0–${format(max)} ${unit==='USD'?'estimated USD':'tokens'}`,['caption','dim-label']));
    const area=new Gtk.DrawingArea({content_height:145,hexpand:true,focusable:true,has_tooltip:true});box.append(area);
    area.update_property([Gtk.AccessibleProperty.LABEL],[`${title}. ${entries.length} bars. Use arrow keys for values.${onSelect?' Enter opens day details.':''}`]);
    let selected=-1;
    const detail=label('Hover or use arrow keys to inspect a bar.',['caption','dim-label']);
    const describe=i=>i<0?'':`${entries[i].label}: ${entries[i].value===null?'No recorded data or price':format(entries[i].value)+' '+(unit==='USD'?'estimated USD':'tokens')}${entries[i].partial?' · partial estimate':''}`;
    const choose=i=>{
        selected=Math.max(0,Math.min(entries.length-1,i));
        const text=describe(selected);area.set_tooltip_text(text);detail.set_label(text);
        area.update_property([Gtk.AccessibleProperty.LABEL],[`${title}. ${text}`]);area.queue_draw();
    };
    area.set_draw_func((_area,cr,width,height)=>{
        const dark=Adw.StyleManager.get_default().get_dark();
        const base=height-4,plot=height-12,step=width/Math.max(1,entries.length);
        cr.setSourceRGBA(.5,.5,.5,.35);cr.setLineWidth(1);cr.moveTo(0,base);cr.lineTo(width,base);cr.stroke();
        entries.forEach((entry,i)=>{
            const missing=entry.value===null;
            const h=missing||!entry.value?2:Math.max(2,entry.value/(max||1)*plot);
            if(i===selected)cr.setSourceRGBA(dark?.65:.08,dark?.83:.3,dark?1:.65,1);
            else if(missing)cr.setSourceRGBA(.5,.5,.5,.5);
            else cr.setSourceRGBA(dark?.21:.12,dark?.60:.45,dark?.96:.86,entry.partial ? .65 : 1);
            cr.rectangle(i*step+1,base-h,Math.max(1,step-Math.min(4,step/4)),h);cr.fill();
        });
    });
    const motion=new Gtk.EventControllerMotion();motion.connect('motion',(_event,x)=>{
        if(entries.length)choose(Math.floor(x/Math.max(1,area.get_width())*entries.length));
    });area.add_controller(motion);
    const keys=new Gtk.EventControllerKey();keys.connect('key-pressed',(_event,key)=>{
        if(!entries.length)return false;
        if([Gdk.KEY_Left,Gdk.KEY_Right,Gdk.KEY_Home,Gdk.KEY_End].includes(key)){
            choose(key===Gdk.KEY_Home?0:key===Gdk.KEY_End?entries.length-1:selected+(key===Gdk.KEY_Left?-1:1));return true;
        }
        if(onSelect&&selected>=0&&[Gdk.KEY_Return,Gdk.KEY_space].includes(key)){onSelect(entries[selected]);return true;}return false;
    });area.add_controller(keys);
    if(onSelect){const click=new Gtk.GestureClick();click.connect('released',(_gesture,_n,x)=>{
        choose(Math.floor(x/Math.max(1,area.get_width())*entries.length));if(selected>=0)onSelect(entries[selected]);
    });area.add_controller(click);}
    const axis=new Gtk.Box({hexpand:true});
    axis.append(label(entries[0]?.label??'', ['caption','dim-label'],{hexpand:true}));
    axis.append(label(entries.at(-1)?.label??'', ['caption','dim-label'],{xalign:1}));
    box.append(axis);box.append(detail);return area;
}
export class HistoryTable {
    constructor(parent,onSelect) {
        this.rows=[];this.offset=0;this.ascending=false;this.onSelect=onSelect;
        this.box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:12});parent.append(this.box);
        const toolbar=new Gtk.Box({spacing:8});this.box.append(toolbar);
        this.sort=new Gtk.Button({label:'Newest first'});toolbar.append(this.sort);
        this.sort.connect('clicked',()=>{this.ascending=!this.ascending;this.offset=0;this.render();});
        this.count=label('', ['dim-label'],{hexpand:true,xalign:1});toolbar.append(this.count);
        this.previous=new Gtk.Button({icon_name:'go-previous-symbolic',tooltip_text:'Previous 10 days'});
        this.next=new Gtk.Button({icon_name:'go-next-symbolic',tooltip_text:'Next 10 days'});
        toolbar.append(this.previous);toolbar.append(this.next);
        this.previous.connect('clicked',()=>{this.offset=Math.max(0,this.offset-10);this.render();});
        this.next.connect('clicked',()=>{this.offset+=10;this.render();});
        this.scroller=new Gtk.ScrolledWindow({hscrollbar_policy:Gtk.PolicyType.AUTOMATIC,vscrollbar_policy:Gtk.PolicyType.NEVER});
        this.box.append(this.scroller);
    }
    setRows(rows) {this.rows=rows.filter(r=>r.recorded);this.offset=0;this.render();}
    render() {
        const rows=[...this.rows].sort((a,b)=>this.ascending?a.date.localeCompare(b.date):b.date.localeCompare(a.date));
        this.sort.set_label(this.ascending?'Oldest first':'Newest first');
        this.previous.set_sensitive(this.offset>0);this.next.set_sensitive(this.offset+10<rows.length);
        this.count.set_label(rows.length?`${this.offset+1}–${Math.min(rows.length,this.offset+10)} of ${rows.length} days`:'No recorded days');
        const grid=new Gtk.Grid({column_spacing:14,row_spacing:4,hexpand:true,css_classes:['card','usage-table']});
        this.scroller.set_child(grid);
        ['Day','Input','Output','Cache read','Cache write','Total','Est. USD'].forEach((text,col)=>
            grid.attach(label(text,['caption','dim-label'],{xalign:col?1:0}),col,0,1,1));
        rows.slice(this.offset,this.offset+10).forEach((row,index)=>{
            const button=new Gtk.Button({label:row.date,css_classes:['flat'],tooltip_text:'Open day details'});
            button.connect('clicked',()=>this.onSelect(row));grid.attach(button,0,index+1,1,1);
            ['input','output','cacheRead','cacheWrite','tokens','estimatedCost'].forEach((key,col)=>{
                const cell=label(key==='estimatedCost'?costText(row):compactCount(row[key]),[],{xalign:1,hexpand:true,wrap:false});
                cell.set_tooltip_text(key==='estimatedCost'?costText(row):row[key].toLocaleString());grid.attach(cell,col+1,index+1,1,1);
            });
        });
    }
}
