import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import {calendarDays,compactCount} from './history-model.js';

// A native preferences page. The owning preferences process performs async work.
export class UsagePage {
    constructor(owner) {
        this.owner=owner;this.loaded=false;this.loading=false;this.rows=[];this.modelRows=[];
        this.page=new Adw.PreferencesPage({name:'usage',title:'Usage',icon_name:'view-grid-symbolic'});
        const controls=new Adw.PreferencesGroup({title:'Local usage history',description:'Token activity across your LLMs. Records stay on this computer.'});this.page.add(controls);
        this.enabled=owner._toggle(controls,'Read local usage records','Claude Code, Codex, OpenCode and imported records. Off stops scanning.',false,value=>{
            owner._settings.usageHistory=value;owner._set('usageHistory',value,()=>{this.loaded=false;this.load();});
        });
        const refreshRow=new Adw.ActionRow({title:'Refresh local records',subtitle:'Incremental scan; no provider requests.'});controls.add(refreshRow);
        this.refresh=new Gtk.Button({label:'Refresh',valign:Gtk.Align.CENTER});refreshRow.add_suffix(this.refresh);
        this.refresh.connect('clicked',()=>{this.loaded=false;this.load();});
        this.summary=new Adw.PreferencesGroup({title:'Your year in tokens'});this.page.add(this.summary);
        this.totals=new Adw.ActionRow({title:'Enable history to see your activity',subtitle:'No records are read until you enable this feature.'});this.summary.add(this.totals);
        this.gridBox=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:10,margin_top:12,margin_bottom:12,margin_start:12,margin_end:12});this.summary.add(this.gridBox);
        this.days=new Adw.PreferencesGroup({title:'Select a day',description:'Click a square or focus it and use the arrow keys. Enter selects the focused day.'});this.page.add(this.days);
        this.models=new Adw.PreferencesGroup({title:'Models · displayed period'});this.page.add(this.models);
        this.coverage=new Adw.PreferencesGroup({title:'Coverage and estimates'});this.page.add(this.coverage);
        owner._fact(this.coverage,'Automatic sources','Claude Code and Codex transcripts; OpenCode SQLite. Other tools can supply versioned usage-imports/*.jsonl records.');
        owner._fact(this.coverage,'What a day means','Local calendar date of the recorded usage. Empty cells mean no recorded data, not zero usage. No subscription charge is inferred.');
        const prices=new Adw.EntryRow({title:'Model prices · JSON, USD per million tokens',show_apply_button:true});this.coverage.add(prices);
        prices.set_tooltip_text('{"model-id":{"input":1,"output":4,"cacheRead":0.1,"cacheWrite":1.25}}');
        prices.connect('apply',()=>{
            try{
                const value=JSON.parse(prices.get_text());
                if(!value||Array.isArray(value)||typeof value!=='object')throw Error();
                for(const rates of Object.values(value))for(const key of ['input','output','cacheRead','cacheWrite'])
                    if(!Number.isFinite(rates?.[key])||rates[key]<0)throw Error();
                owner._set('modelPrices',value,()=>{this.loaded=false;this.load();});prices.remove_css_class('error');
            }catch(_){prices.add_css_class('error');prices.set_tooltip_text('Use a model-name object with non-negative input, output, cacheRead and cacheWrite USD rates.');}
        });
        this.prices=prices;
        const css=new Gtk.CssProvider();css.load_from_data(`
            .usage-day { min-width: 8px; min-height: 8px; padding: 0; border-radius: 2px; border: 1px solid transparent; }
            .usage-day:focus { outline: 2px solid #ffffff; outline-offset: 1px; }
            .usage-day:selected, .usage-selected { border-color: #ffffff; }
            .usage-missing { background: #292d32; }
            .usage-zero { background: #47515a; }
            .usage-1 { background: #175638; } .usage-2 { background: #248549; }
            .usage-3 { background: #38b968; } .usage-4 { background: #73e599; }
        `,-1);
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),css,Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        this.css=css;
    }
    sync(settings) {
        this.owner._syncing=true;this.enabled.set_active(!!settings.usageHistory);this.owner._syncing=false;
        if(!this.loaded)this.prices.set_text(JSON.stringify(settings.modelPrices??{}));
    }
    load() {
        if(this.loading||this.loaded||!this.owner._alive)return;
        this.loading=true;this.refresh.set_sensitive(false);this.refresh.set_label('Scanning…');
        this.owner._run(['--history'],result=>{
            this.loading=false;
            if(!result){this.totals.set_title('Could not read usage history');this.refresh.set_sensitive(true);this.refresh.set_label('Retry');return;}
            this.render(result);this.loaded=!result.more;
            this.refresh.set_sensitive(true);this.refresh.set_label('Refresh');
            if(result.more&&this.owner._window.get_visible_page()===this.page){
                this.timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,100,()=>{this.timer=null;this.load();return GLib.SOURCE_REMOVE;});
            }
        });
    }
    render(report) {
        this.report=report;
        if(!report.enabled){
            this.totals.set_title('History is off');this.totals.set_subtitle('Enable local records above to populate the contribution grid.');
        }else{
            this.totals.set_title(`${compactCount(report.tokens)} tokens · ${report.days.length} recorded days`);
            const estimate=report.estimatedCost===null?'Cost unavailable: no model prices configured':`Estimated API cost: $${report.estimatedCost.toFixed(2)}${report.unpricedTokens?' · some tokens unpriced':''}`;
            this.totals.set_subtitle(`${report.more?'Scanning older records… · ':''}${estimate}\n${report.fromDate} — ${report.toDate} · local dates`);
        }
        let child;while((child=this.gridBox.get_first_child()))this.gridBox.remove(child);
        const grid=new Gtk.Grid({column_spacing:3,row_spacing:3,halign:Gtk.Align.CENTER});this.gridBox.append(grid);
        for(const [row,label] of [[1,'Mon'],[3,'Wed'],[5,'Fri']])grid.attach(new Gtk.Label({label,css_classes:['dim-label']}),0,row,1,1);
        const cells=calendarDays(report),buttons=[];this.buttons=buttons;
        cells.forEach((cell,index)=>{
            const col=Math.floor(index/7)+1;
            if(cell.month)grid.attach(new Gtk.Label({label:cell.month,css_classes:['dim-label'],halign:Gtk.Align.START}),col,0,3,1);
            const description=`${cell.date}: ${cell.tokens===null?'no recorded data':cell.tokens.toLocaleString()+' tokens'}`;
            const button=new Gtk.Button({tooltip_text:description,width_request:10,height_request:10,css_classes:['usage-day',cell.level<0?'usage-missing':cell.level===0?'usage-zero':`usage-${cell.level}`]});
            button.update_property([Gtk.AccessibleProperty.LABEL],[description]);
            button.connect('clicked',()=>this.select(cell));
            const keys=new Gtk.EventControllerKey();keys.connect('key-pressed',(_controller,key)=>{
                const delta=({[Gdk.KEY_Left]:-7,[Gdk.KEY_Right]:7,[Gdk.KEY_Up]:-1,[Gdk.KEY_Down]:1})[key];
                if(delta===undefined)return false;
                buttons[Math.max(0,Math.min(buttons.length-1,index+delta))]?.grab_focus();return true;
            });button.add_controller(keys);
            grid.attach(button,col,cell.weekday+1,1,1);buttons.push(button);
        });
        this.gridBox.append(new Gtk.Label({label:'No record  ▪   Less  ▪ ▪ ▪ ▪  More tokens',css_classes:['dim-label'],halign:Gtk.Align.END}));
        for(const row of this.modelRows)this.models.remove(row);this.modelRows=[];
        for(const model of (report.models??[]).slice(0,40)){
            const row=new Adw.ActionRow({title:model.model,subtitle:this.modelDetail(model)});this.models.add(row);this.modelRows.push(row);
        }
        this.select(cells.find(c=>c.date===this.selected)??[...cells].reverse().find(c=>c.row)??cells.at(-1));
    }
    modelDetail(model) {
        const price=model.unpricedTokens?'Cost unavailable for some or all tokens':`Estimated $${model.estimatedCost.toFixed(2)}`;
        return `${compactCount(model.tokens)} tokens · ${compactCount(model.input)} input · ${compactCount(model.output)} output\n${compactCount(model.cacheRead)} cache read · ${compactCount(model.cacheWrite)} cache write · ${price}`;
    }
    select(cell) {
        if(!cell)return;this.selected=cell.date;
        this.days.set_title(cell.date);for(const row of this.rows)this.days.remove(row);this.rows=[];
        const add=(title,subtitle)=>{const row=new Adw.ActionRow({title,subtitle});this.days.add(row);this.rows.push(row);};
        if(!cell.row)add('No recorded data','This is not a measured zero. The client may not publish token records.');
        else{
            add(`${cell.tokens.toLocaleString()} tokens`,`${cell.row.records} usage records · ${cell.row.sources.join(', ')}`);
            for(const model of cell.row.models)add(model.model,this.modelDetail(model));
        }
        for(const button of this.buttons){
            if(button.get_tooltip_text().startsWith(cell.date))button.add_css_class('usage-selected');else button.remove_css_class('usage-selected');
        }
    }
    destroy() {
        if(this.timer)GLib.source_remove(this.timer);
        Gtk.StyleContext.remove_provider_for_display(Gdk.Display.get_default(),this.css);
    }
}
