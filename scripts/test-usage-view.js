#!/usr/bin/gjs -m
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import {UsagePage} from '../extension/history-view.js';
import {applyTheme,stylePreferences} from '../extension/preferences-style.js';
import {dateKey,shiftDate} from '../extension/history-model.js';
const app=new Adw.Application({application_id:'local.codenotch.UsageSmoke'});
let failed=false;
const assert=(condition,message)=>{if(!condition)throw Error(message);};
app.connect('activate',()=>{
    let view,window;
    try{
        applyTheme(GLib.getenv('CODENOTCH_TEST_THEME')??'dark');
        window=new Adw.PreferencesWindow({application:app,default_width:1100,default_height:860});
        const removeStyle=stylePreferences(window);
        const settings={usageHistory:true,historyDays:365,modelPrices:{}};
        const owner={_alive:true,_window:window,_settings:settings,_set(key,value,done){settings[key]=value;done?.();},_run(_args,done){done(report);},
            _fact(group,title,subtitle){const row=new Adw.ActionRow({title,subtitle});group.add(row);return row;},
            _toggle(group,title,subtitle,state,change){const row=new Adw.ActionRow({title,subtitle});const toggle=new Gtk.Switch({active:state,valign:Gtk.Align.CENTER});row.add_suffix(toggle);toggle.connect('notify::active',()=>{if(!this._syncing)change(toggle.active);});group.add(row);return toggle;}};
        const today=dateKey(new Date());const buckets=[];
        for(let i=0;i<365;i++){
            if(i%4===1)continue;
            const tokens=(i%17+1)*12345,source=i%3?'claude':'codex',model=i%3?'Example Claude model':'Example Codex model';
            buckets.push({date:shiftDate(today,-i),source,model,tokens,records:2,input:tokens-3000,output:2000,cacheRead:1000,cacheWrite:0,
                estimatedCost:source==='claude'?.1:0,unpricedTokens:source==='claude'?0:tokens,pricedRecords:source==='claude'?2:0,
                hours:Array.from({length:24},(_,h)=>h===i%24?tokens:0)});
        }
        const report={enabled:true,breakdown:buckets,days:[],fromDate:shiftDate(today,-364),toDate:today,timezone:'Local'};
        view=new UsagePage(owner);window.add(view.page);view.sync(settings);view.render(report);
        view.syncProviders([{id:'codex',kind:'codex',name:'Codex',enabled:true,status:'ok',windows:[{label:'5h limit',fraction:.15}]}]);
        window.present();
        const capture=name=>{
            const snapshot=new Gtk.Snapshot();window.snapshot_child(window.get_child(),snapshot);
            const node=snapshot.to_node();assert(node,'Usage preview did not render');
            assert(window.get_renderer().render_texture(node,null).save_to_png(`/tmp/codenotch-usage-${name}.png`),'Could not save screenshot');
        };
        const steps=[
            ()=>{capture('overview');assert(view.tabs.overview.get_width()>=800,'Dashboard does not use the wider window');
                assert(view.chartCards.length===7,'Additional charts missing');
                const box=widget=>{const [,rect]=widget.compute_bounds(view.tabs.overview);return [Math.round(rect.get_x()),Math.round(rect.get_width())];};
                const width=box(view.calendarHost.get_first_child())[1],outer=widget=>widget.get_parent()===view.tabs.overview?widget:widget.get_parent();
                for(const chart of view.chartCards)assert(box(outer(chart))[1]===width,`Chart and calendar card widths differ: ${chart.title} ${box(outer(chart))} vs ${width}`);
                const tabs=[];for(let child=view.navigation.get_first_child();child;child=child.get_next_sibling())tabs.push(child.get_width());
                assert(tabs.length===5&&Math.max(...tabs)-Math.min(...tabs)<=1&&box(view.navigation)[1]===width,'Navigation tabs must share the content width');
                assert(outer(view.chartCards.at(-1)).get_next_sibling()===view.calendarHost,'Calendar must follow the charts');
                assert(view.calendarGrid.get_width()<=view.gridBox.get_width(),'Overview calendar exceeds content width');
                assert(view.buttons.length>=365,'Overview calendar missing');assert(view.stats.days.length===30,'Default period');assert(view.stats.unpricedTokens>0,'Partial prices');
                view.stack.set_visible_child_name('history');},
            ()=>{capture('history');assert(view.buttons.length>=365,'Missing calendar days');
                assert(view.table.rows.length>10,'History rows missing');
                view.table.next.emit('clicked');assert(view.table.offset===10,'History pagination');
                view.table.previous.emit('clicked');assert(view.table.offset===0,'Previous page');
                view.table.sort.emit('clicked');assert(view.table.ascending,'History sort');
                view.buttons.at(-1).emit('clicked');assert(view.selected===today,'Day selection');
                view.stack.set_visible_child_name('models');},
            ()=>{capture('models');view.drilldown('model','Example Codex model');
                assert(view.stats.models.length===1&&view.model==='Example Codex model','Model drilldown');
                assert(view.stats.agents[0].id==='codex','Model source aggregation');
                view.model='';view.drilldown('source','claude');assert(view.stats.agents.length===1,'Agent drilldown');
                view.period.set_selected(0);assert(view.stats.days.length===7,'Period selector');
                view.source='';view.model='';view._syncFilters();view.draw();view.stack.set_visible_child_name('agents');},
            ()=>{capture('agents');view.render({...report,breakdown:buckets.map(b=>({...b,pricedRecords:0,estimatedCost:0,unpricedTokens:b.tokens}))});
                view.costMode=true;view._drawTrend();assert(view.costNotice.get_label().includes('Add prices'),'Missing price explanation');
                view.priceAction.emit('clicked');assert(view.stack.get_visible_child_name()==='data','Pricing action navigation');},
            ()=>{capture('data');assert(view.priceRows.length===2,'Native model price editors');
                view.render({...report,breakdown:[]});assert(view.stats.tokens===0,'Empty report');
                view.stack.set_visible_child_name('overview');},
            ()=>{capture('empty');view.render({...report,more:true});assert(view.status.get_label().includes('Scanning'),'Partial scan state');
                view.render({enabled:false,days:[],breakdown:[]});assert(view.buttons.length===0,'Disabled history cleared');},
            ()=>{capture('disabled');print('Usage dashboard passed: tabs, filters, drilldowns, pagination, calendar, prices, empty/disabled/partial states.');},
        ];
        let index=0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT,1000,()=>{
            try{steps[index++]();}catch(error){printerr(`step ${index-1}: ${error}`);printerr(error.stack??'');failed=true;index=steps.length;}
            if(index<steps.length)return GLib.SOURCE_CONTINUE;
            view.destroy();removeStyle();window.close();app.quit();return GLib.SOURCE_REMOVE;
        });
    }catch(error){printerr(String(error));printerr(error.stack??'');failed=true;view?.destroy();window?.close();app.quit();}
});
app.run([]);if(failed)throw Error('Usage view smoke test failed');
