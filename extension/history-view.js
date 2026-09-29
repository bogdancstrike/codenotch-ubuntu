import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import {calendarDays,compactCount,usageStats,costText,sourceName,COUNTERS} from './history-model.js';
import {clear,label,section,metrics,breakdown,barChart,HistoryTable} from './history-widgets.js';

const PERIODS=[7,30,90,365];
const KINDS=[['input','Fresh input'],['output','Output'],['cacheRead','Cache read'],['cacheWrite','Cache write']];

export class UsagePage {
    constructor(owner) {
        this.owner=owner;this.loaded=false;this.loading=false;this.source='';this.model='';this.span=30;
        this.rows=[];this.buttons=[];this.providers=[];this.priceRows=[];
        this.page=new Adw.PreferencesPage({name:'usage',title:'Usage',icon_name:'view-grid-symbolic'});
        // PreferencesPage does not expose its content width. Locate its native
        // clamp by type so only this dashboard uses the wider window space.
        const widen=widget=>{
            if(widget instanceof Adw.Clamp){widget.set_maximum_size(1000);widget.set_tightening_threshold(900);return true;}
            for(let child=widget.get_first_child();child;child=child.get_next_sibling())if(widen(child))return true;
            return false;
        };
        widen(this.page);
        const heading=new Adw.PreferencesGroup({title:'Usage analytics',description:'Your local token activity, models and estimated API costs.'});this.page.add(heading);
        const filters=new Gtk.Box({spacing:12,homogeneous:true});heading.add(filters);
        this.period=this._filter(filters,'Period',PERIODS.map(n=>`Last ${n} days`),1,index=>{this.span=PERIODS[index];this.draw();});
        this.agentFilter=this._filter(filters,'Agent',['All agents'],0,index=>{this.source=this.agentIDs[index]??'';this.draw();});
        this.modelFilter=this._filter(filters,'Model',['All models'],0,index=>{this.model=this.modelIDs[index]??'';this.draw();});
        const actions=new Gtk.Box({spacing:8,margin_top:12});heading.add(actions);
        this.status=label('Loading local history…',['dim-label'],{hexpand:true});actions.append(this.status);
        const reset=new Gtk.Button({label:'Clear filters'});actions.append(reset);
        reset.connect('clicked',()=>{this.source='';this.model='';this._syncFilters();this.draw();});
        this.refresh=new Gtk.Button({label:'Refresh',valign:Gtk.Align.CENTER});actions.append(this.refresh);
        this.refresh.connect('clicked',()=>{this.loaded=false;this.load();});
        const body=new Adw.PreferencesGroup();this.page.add(body);
        const container=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:20});body.add(container);
        this.stack=new Gtk.Stack({vhomogeneous:false,transition_type:Gtk.StackTransitionType.NONE});
        const tabs=new Gtk.StackSwitcher({stack:this.stack,halign:Gtk.Align.START,css_classes:['usage-navigation']});container.append(tabs);container.append(this.stack);
        this.tabs={};
        for(const [id,title] of [['overview','Overview'],['history','History'],['models','Models'],['agents','Agents'],['data','Data']]){
            const box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:28});this.tabs[id]=box;this.stack.add_titled(box,id,title);
        }
        this._buildData();this._installStyle();
    }
    _filter(parent,title,items,selected,change) {
        const box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:6});parent.append(box);
        box.append(label(title,['caption','dim-label']));
        const control=new Gtk.DropDown({model:Gtk.StringList.new(items),selected,hexpand:true,enable_search:true});box.append(control);
        control.update_property([Gtk.AccessibleProperty.LABEL],[title]);
        control.connect('notify::selected',()=>{if(!this.syncingFilters)change(control.selected);});return control;
    }
    _installStyle() {
        const css=new Gtk.CssProvider();css.load_from_data(`
            .usage-metric { padding: 24px; border-radius: 16px; }
            .usage-metric .title-1 { font-size: 26px; }
            .usage-chart { padding: 24px; border-radius: 16px; }
            .usage-table { padding: 12px; }
            .usage-day { min-width: 8px; min-height: 8px; padding: 0; border-radius: 2px; border: 1px solid transparent; }
            .usage-day:focus { outline: 2px solid @accent_color; outline-offset: 1px; }
            .usage-selected { border-color: @window_fg_color; }
            .usage-missing { background: alpha(@window_fg_color, .12); }
            .usage-zero { background: alpha(@window_fg_color, .3); }
            .usage-1 { background: #175638; } .usage-2 { background: #248549; }
            .usage-3 { background: #38b968; } .usage-4 { background: #73e599; }
        `,-1);
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),css,Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);this.css=css;
    }
    _buildData() {
        const controls=section(this.tabs.data,'Local records','Scanning is opt-in. Records and prices stay on this computer.');
        this.enabled=this.owner._toggle(controls,'Read local usage records','Claude Code, Codex, OpenCode and imported records.',false,value=>{
            this.owner._settings.usageHistory=value;
            if(!value){this.loaded=false;this.render({enabled:false,days:[],breakdown:[]});}
            this.owner._set('usageHistory',value,()=>{this.loaded=false;this.load();});
        });
        const range=new Adw.ComboRow({title:'Available history',subtitle:'Maximum period included in the report; does not delete the ledger.',
            model:Gtk.StringList.new(PERIODS.map(n=>`${n} days`))});controls.add(range);this.historyRange=range;
        range.connect('notify::selected',()=>{if(this.syncingData)return;
            this.owner._set('historyDays',PERIODS[range.selected],()=>{this.loaded=false;this.load();});});
        this.priceGroup=section(this.tabs.data,'Model prices','USD per million tokens. Set all four rates for each exact model ID.');
        this.priceHint=new Adw.ActionRow({title:'Scan local records to list your models',subtitle:'Models without configured prices remain unpriced.'});this.priceGroup.add(this.priceHint);
        const advanced=section(this.tabs.data,'Import prices');
        const prices=new Adw.EntryRow({title:'Model prices · JSON',show_apply_button:true});advanced.add(prices);this.prices=prices;
        prices.set_tooltip_text('{"model-id":{"input":1,"output":4,"cacheRead":0.1,"cacheWrite":1.25}}');
        prices.connect('apply',()=>{
            try{
                const value=JSON.parse(prices.get_text());
                if(!value||Array.isArray(value)||typeof value!=='object')throw Error();
                for(const rates of Object.values(value)){
                    if(!rates||typeof rates!=='object'||Array.isArray(rates))throw Error();
                    for(const key of COUNTERS)if(!Number.isFinite(rates[key])||rates[key]<0)throw Error();
                }
                this.owner._set('modelPrices',value,()=>{this.priceKey=null;this.loaded=false;this.load();});prices.remove_css_class('error');
            }catch(_){prices.add_css_class('error');prices.set_tooltip_text('Use a model-name object with non-negative input, output, cacheRead and cacheWrite USD rates.');}
        });
        const coverage=section(this.tabs.data,'Coverage and interpretation');
        this.owner._fact(coverage,'Automatic sources','Claude Code and Codex transcripts; OpenCode SQLite. Other tools can supply versioned usage-imports/*.jsonl records.');
        this.owner._fact(coverage,'Estimates, not bills','Prices are supplied by you. Estimates are API equivalents, not subscription charges. Partial estimates exclude unpriced tokens.');
        this.owner._fact(coverage,'Local dates and records','Missing days mean no recorded data, not zero usage. Record counts are usage events, not requests. Agents group local clients, not individual signed-in accounts.');
        this.owner._fact(coverage,'Activity patterns','Active days contain tokens. The current streak can end today or yesterday. Average tokens use active days; cache share is cache-read tokens divided by total tokens.');
    }
    sync(settings) {
        this.owner._syncing=true;this.syncingData=true;
        this.enabled.set_active(!!settings.usageHistory);
        this.historyRange.set_selected(Math.max(0,PERIODS.indexOf(settings.historyDays??365)));
        this.syncingData=false;this.owner._syncing=false;
        if(!this.prices.has_focus)this.prices.set_text(JSON.stringify(settings.modelPrices??{}));
    }
    syncProviders(providers) {this.providers=providers??[];if(this.quotaBox)this._renderQuotas();}
    load() {
        if(this.loading||this.loaded||!this.owner._alive)return;
        if(this.timer){GLib.source_remove(this.timer);this.timer=null;}
        const settingsKey=()=>JSON.stringify([this.owner._settings.usageHistory,this.owner._settings.historyDays,this.owner._settings.modelPrices]);
        const requestedSettings=settingsKey();
        this.loading=true;this.refresh.set_sensitive(false);this.refresh.set_label('Scanning…');
        this.owner._run(['--history'],result=>{
            this.loading=false;if(!this.owner._alive)return;
            this.refresh.set_sensitive(true);this.refresh.set_label('Refresh');
            if(requestedSettings!==settingsKey()){this.loaded=false;this.load();return;}
            if(!result){this.status.set_label('Could not read history. Refresh to retry.');return;}
            this.render(result);this.loaded=!result.more;
            if(result.more&&this.owner._window.get_visible_page()===this.page){
                this.timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,100,()=>{this.timer=null;this.load();return GLib.SOURCE_REMOVE;});
            }
        });
    }
    _syncFilters() {
        this.syncingFilters=true;
        const buckets=this.report?.breakdown??[];
        this.agentIDs=['',...new Set(buckets.map(b=>b.source).sort())];
        this.modelIDs=['',...new Set(buckets.map(b=>b.model).sort())];
        if(!this.agentIDs.includes(this.source))this.source='';if(!this.modelIDs.includes(this.model))this.model='';
        const short=text=>text.length>36?`${text.slice(0,33)}…`:text;
        this.agentFilter.set_model(Gtk.StringList.new(this.agentIDs.map(id=>id?short(sourceName(id)):'All agents')));
        this.modelFilter.set_model(Gtk.StringList.new(this.modelIDs.map(id=>id?short(id):'All models')));
        this.agentFilter.set_selected(this.agentIDs.indexOf(this.source));this.modelFilter.set_selected(this.modelIDs.indexOf(this.model));
        this.agentFilter.set_tooltip_text(this.source?sourceName(this.source):'All agents');
        this.modelFilter.set_tooltip_text(this.model||'All models');this.syncingFilters=false;
    }
    render(report) {
        this.report=report;this._syncFilters();this.draw();this._renderPrices();
    }
    drilldown(kind,id) {this[kind]=id;this._syncFilters();this.draw();this.stack.set_visible_child_name('overview');}
    draw() {
        if(!this.report)return;
        this.stats=usageStats(this.report,{span:this.span,source:this.source,model:this.model});const s=this.stats;
        this.agentFilter.set_tooltip_text(this.source?sourceName(this.source):'All agents');
        this.modelFilter.set_tooltip_text(this.model||'All models');
        this.status.set_label(!this.report.enabled?'History is off. Enable it in Data.':
            `${this.report.more?'Scanning… · ':''}${s.from} — ${s.to} · ${this.report.timezone??'local time'}${this.source?' · '+sourceName(this.source):''}${this.model?' · '+this.model:''}`);
        for(const name of ['overview','history','models','agents'])clear(this.tabs[name]);
        this.quotaBox=null;this.dayBox=null;this.buttons=[];
        if(!this.report.enabled){
            for(const name of ['overview','history','models','agents']){
                this.tabs[name].append(label('Enable local history to explore your usage.',['title-2']));
                const button=new Gtk.Button({label:'Open Data settings',halign:Gtk.Align.START});
                button.connect('clicked',()=>this.stack.set_visible_child_name('data'));this.tabs[name].append(button);
            }
            this.buttons=[];return;
        }
        if(!this.report.breakdown){
            this.tabs.overview.append(label('Update the Codenotch worker to load detailed analytics.',['heading']));return;
        }
        const overview=this.tabs.overview;
        metrics(overview,[['Total tokens',compactCount(s.tokens),`${s.records.toLocaleString()} usage records`],
            ['Estimated API cost',costText(s),s.pricedRecords?`${(s.pricedShare*100).toFixed(0)}% of tokens priced`:'Add model prices in Data to see estimates']]);
        if(!s.records)overview.append(label('No records match this period and these filters. Try a longer period, clear filters, or refresh.',['dim-label']));
        const calendarHost=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL});overview.append(calendarHost);
        const trend=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:12});overview.append(trend);
        const metric=new Gtk.DropDown({model:Gtk.StringList.new(['Daily tokens','Daily estimated cost']),selected:this.costMode?1:0,halign:Gtk.Align.END});
        metric.update_property([Gtk.AccessibleProperty.LABEL],['Daily chart metric']);trend.append(metric);
        this.trendBody=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:12});trend.append(this.trendBody);
        // Keep the control, focus, and the rest of the page stable when changing metrics.
        metric.connect('notify::selected',()=>{this.costMode=metric.selected===1;this._drawTrend();});this._drawTrend();
        const detail=this._disclosure(overview,'Activity and token details',`${s.activeDays} active days · ${compactCount(s.average)} tokens per active day · ${(s.cacheShare*100).toFixed(1)}% cache read`);
        metrics(detail,[['Current streak',`${s.currentStreak} days`,'Ending today or yesterday'],
            ['Longest streak',`${s.longestStreak} days`,'Within this period'],
            ['Busiest day',s.busiest?.date??'—',s.busiest?`${compactCount(s.busiest.tokens)} tokens`:'No recorded activity'],
            ['Peak hour',s.peakHour===null?'—':`${String(s.peakHour).padStart(2,'0')}:00`,'Local time · by tokens']]);
        const kinds=section(detail,'Token composition','Disjoint token categories; cache share is based on total tokens.');
        for(const [key,title] of KINDS){
            const value=s[key],row=new Adw.ActionRow({title,subtitle:`${value.toLocaleString()} tokens · ${s.tokens?(value/s.tokens*100).toFixed(1):'0'}%`});
            row.add_suffix(new Gtk.ProgressBar({fraction:s.tokens?value/s.tokens:0,width_request:140,valign:Gtk.Align.CENTER}));kinds.add(row);
        }
        barChart(detail,'Activity by hour',s.hours.map((value,hour)=>({label:`${String(hour).padStart(2,'0')}:00`,value:s.records?value:null})));
        const favorites=section(detail,'Leading models','Select a model to explore its activity.');
        breakdown(favorites,s.models.slice(0,5),s.tokens,id=>this.drilldown('model',id));
        this._drawHistory();this._drawCalendar(calendarHost);
        const models=section(this.tabs.models,'By model','Shares of tokens in the selected period. Select a model to filter the dashboard.');
        breakdown(models,s.models,s.tokens,id=>this.drilldown('model',id));
        const agents=section(this.tabs.agents,'By agent','Local clients, including imported sources. Select an agent to filter the dashboard.');
        breakdown(agents,s.agents,s.tokens,id=>this.drilldown('source',id));
        this.quotaBox=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:16});this.tabs.agents.append(this.quotaBox);this._renderQuotas();
    }
    _disclosure(parent,title,subtitle) {
        this.expandedSections??=new Set();
        const group=section(parent,'');
        const row=new Adw.ExpanderRow({title,subtitle,expanded:this.expandedSections.has(title)});group.add(row);
        row.connect('notify::expanded',()=>{if(row.expanded)this.expandedSections.add(title);else this.expandedSections.delete(title);});
        const body=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:24,margin_top:20,margin_bottom:20,margin_start:16,margin_end:16});row.add_row(body);return body;
    }
    _drawTrend() {
        clear(this.trendBody);const s=this.stats;
        this.costNotice=null;
        if(this.costMode&&!s.pricedRecords){
            const box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:12,css_classes:['card','usage-chart']});this.trendBody.append(box);
            this.costNotice=label(s.records?'Add prices to see daily estimates':'No usage records in this period',['title-2']);box.append(this.costNotice);
            box.append(label(s.records?'Token records do not include subscription charges. Set API prices for your models to calculate daily estimates.':'Choose another period or refresh local records.',['dim-label']));
            if(s.records){
                this.priceAction=new Gtk.Button({label:'Set model prices',halign:Gtk.Align.START,css_classes:['suggested-action']});box.append(this.priceAction);
                this.priceAction.connect('clicked',()=>this.stack.set_visible_child_name('data'));
            }
            return;
        }
        if(this.costMode&&s.unpricedTokens>0)this.trendBody.append(label(`Partial estimate · ${compactCount(s.unpricedTokens)} tokens have no configured price. Add prices in Data to include them.`,['dim-label']));
        barChart(this.trendBody,this.costMode?'Daily estimated API cost':'Daily token activity',s.days.map(d=>({label:d.date,
            value:!d.recorded?null:this.costMode?(d.pricedRecords?d.estimatedCost:null):d.tokens,
            partial:this.costMode&&d.unpricedTokens>0})),{unit:this.costMode?'USD':'tokens',onSelect:entry=>this.openDay(entry.label)});
    }
    _drawHistory() {
        const parent=this.tabs.history,s=this.stats;
        const history=section(parent,'Day by day','Recorded days only. Values are abbreviated; hover a cell for its exact count.');
        const tableBox=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL});history.add(tableBox);
        this.table=new HistoryTable(tableBox,day=>this.openDay(day.date));this.table.setRows(s.days);
        this.dayGroup=section(parent,'Day details');this.dayBox=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:8,focusable:true});this.dayGroup.add(this.dayBox);
        const months=section(parent,'By month','Within the selected period and filters.');breakdown(months,s.months,s.tokens);
    }
    _drawCalendar(parent) {
        const calendar=section(parent,'Year in tokens','Agent and model filters apply. The calendar includes all available history, independent of the period selector.');
        const year=usageStats(this.report,{span:365,source:this.source,model:this.model});
        const cells=calendarDays({days:year.days.filter(d=>d.recorded)},new Date(`${this.report.toDate}T12:00:00`));
        this.gridBox=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:10,margin_top:12,margin_bottom:12});calendar.add(this.gridBox);
        const scroll=new Gtk.ScrolledWindow({hscrollbar_policy:Gtk.PolicyType.AUTOMATIC,vscrollbar_policy:Gtk.PolicyType.NEVER});this.gridBox.append(scroll);
        const grid=new Gtk.Grid({column_spacing:3,row_spacing:3,halign:Gtk.Align.CENTER});scroll.set_child(grid);this.calendarGrid=grid;
        for(const [row,text] of [[1,'Mon'],[3,'Wed'],[5,'Fri']])grid.attach(label(text,['dim-label']),0,row,1,1);
        this.buttons=[];
        cells.forEach((cell,index)=>{
            const col=Math.floor(index/7)+1;
            if(cell.month)grid.attach(label(cell.month,['dim-label']),col,0,3,1);
            const description=`${cell.date}: ${cell.tokens===null?'no recorded data':cell.tokens.toLocaleString()+' tokens'}`;
            const button=new Gtk.Button({tooltip_text:description,width_request:10,height_request:10,
                css_classes:['usage-day',cell.level<0?'usage-missing':cell.level===0?'usage-zero':`usage-${cell.level}`]});
            button.update_property([Gtk.AccessibleProperty.LABEL],[description]);button.connect('clicked',()=>this.openDay(cell.date));
            const keys=new Gtk.EventControllerKey();keys.connect('key-pressed',(_controller,key)=>{
                const delta=({[Gdk.KEY_Left]:-7,[Gdk.KEY_Right]:7,[Gdk.KEY_Up]:-1,[Gdk.KEY_Down]:1})[key];
                if(delta===undefined)return false;this.buttons[Math.max(0,Math.min(this.buttons.length-1,index+delta))]?.grab_focus();return true;
            });button.add_controller(keys);grid.attach(button,col,cell.weekday+1,1,1);this.buttons.push(button);
        });
        this.gridBox.append(label('No record  ▪   Less  ▪ ▪ ▪ ▪  More tokens',['caption','dim-label'],{xalign:1}));
        this.select(cells.find(c=>c.date===this.selected)??[...cells].reverse().find(c=>c.row)??cells.at(-1));
    }
    openDay(date) {
        const year=usageStats(this.report,{span:365,source:this.source,model:this.model});
        this.select({date,row:year.days.find(d=>d.date===date&&d.recorded)});this.stack.set_visible_child_name('history');this.dayBox.grab_focus();
    }
    select(cell) {
        if(!cell||!this.dayBox)return;this.selected=cell.date;clear(this.dayBox);this.dayGroup.set_title(`Day details · ${cell.date}`);
        if(!cell.row)this.dayBox.append(label('No recorded data. This is not a measured zero.',['dim-label']));
        else{
            this.dayBox.append(label(`${cell.row.tokens.toLocaleString()} tokens · ${cell.row.records} records · ${costText(cell.row)}`,['heading']));
            const dayReport={...this.report,toDate:cell.date};
            const stats=usageStats(dayReport,{span:1,source:this.source,model:this.model});
            for(const model of stats.models)this.dayBox.append(label(`${model.label} · ${compactCount(model.tokens)} tokens · ${costText(model)}`));
        }
        for(const button of this.buttons){
            if(button.get_tooltip_text().startsWith(cell.date))button.add_css_class('usage-selected');else button.remove_css_class('usage-selected');
        }
    }
    _renderQuotas() {
        clear(this.quotaBox);
        const group=section(this.quotaBox,'Current account quotas','Latest connection readings. These percentages are separate from local token history.');
        const providers=this.providers.filter(p=>p.enabled&&(!this.source||(p.kind??p.id.split(':')[0])===this.source));
        if(!providers.length)group.add(new Adw.ActionRow({title:'No matching enabled accounts',subtitle:'Manage accounts and verify connections on the Connections page.'}));
        for(const p of providers){
            const account=new Adw.ExpanderRow({title:p.name,subtitle:`${p.status??'Unknown'} · ${p.updatedAt?'Last reading '+new Date(p.updatedAt*1000).toLocaleString():'No live reading'}`,use_markup:false});group.add(account);
            for(const w of p.windows??[]){
                const row=new Adw.ActionRow({title:w.label,use_markup:false,
                    subtitle:`${Math.floor(w.fraction*100)}% used${w.resetsAt?' · resets '+new Date(w.resetsAt*1000).toLocaleString():''}`});
                row.add_suffix(new Gtk.ProgressBar({fraction:Math.max(0,Math.min(1,w.fraction)),width_request:100,valign:Gtk.Align.CENTER}));account.add_row(row);
            }
        }
    }
    _renderPrices() {
        const names=[...new Set((this.report.breakdown??[]).map(b=>b.model))].sort();
        const priceKey=JSON.stringify([names,this.owner._settings.modelPrices]);if(priceKey===this.priceKey)return;this.priceKey=priceKey;
        for(const row of this.priceRows)this.priceGroup.remove(row);this.priceRows=[];this.priceHint.set_visible(!names.length);
        for(const name of names){
            const prices=this.owner._settings.modelPrices??{};
            const rates=Object.hasOwn(prices,name)?prices[name]:null;
            const row=new Adw.ExpanderRow({title:name,subtitle:rates?'Configured · USD per million tokens':'Unpriced · enter all four rates',use_markup:false});
            this.priceGroup.add(row);this.priceRows.push(row);const inputs={};
            for(const [key,title] of KINDS){
                const item=new Adw.ActionRow({title});
                const input=new Gtk.SpinButton({adjustment:new Gtk.Adjustment({lower:0,upper:1000000,step_increment:.1,page_increment:1}),digits:4,numeric:true,valign:Gtk.Align.CENTER});
                input.set_value(rates?.[key]??0);item.add_suffix(input);row.add_row(item);inputs[key]=input;
            }
            const saveRow=new Adw.ActionRow({title:'Apply model prices',subtitle:'Zero explicitly means free. Estimates update after saving.'});
            const save=new Gtk.Button({label:'Save prices',valign:Gtk.Align.CENTER});saveRow.add_suffix(save);row.add_row(saveRow);
            save.connect('clicked',()=>{
                const value={...this.owner._settings.modelPrices,[name]:Object.fromEntries(COUNTERS.map(key=>[key,inputs[key].get_value()]))};
                this.owner._set('modelPrices',value,()=>{this.loaded=false;this.load();});
            });
        }
    }
    destroy() {
        if(this.timer)GLib.source_remove(this.timer);
        Gtk.StyleContext.remove_provider_for_display(Gdk.Display.get_default(),this.css);
    }
}
