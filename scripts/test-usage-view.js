#!/usr/bin/gjs -m
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import {UsagePage} from '../extension/history-view.js';
const app=new Adw.Application({application_id:'local.codenotch.UsageSmoke'});
let failed=false;
app.connect('activate',()=>{
    try{
        const window=new Adw.PreferencesWindow({application:app,default_width:1100,default_height:860});
        const owner={_alive:true,_window:window,_settings:{},_set(){},_run(){},
            _fact(group,title,subtitle){const row=new Adw.ActionRow({title,subtitle});group.add(row);return row;},
            _toggle(group,title,subtitle,state,change){const row=new Adw.ActionRow({title,subtitle});const toggle=new Gtk.Switch({active:state,valign:Gtk.Align.CENTER});row.add_suffix(toggle);toggle.connect('notify::active',()=>{if(!this._syncing)change(toggle.active);});group.add(row);return toggle;}};
        const view=new UsagePage(owner);window.add(view.page);
        const days=[];const today=new Date();
        for(let i=0;i<365;i++){
            const date=new Date(today);date.setDate(date.getDate()-i);
            if(i%4===0)continue;
            const tokens=(i%17+1)*12345;
            const model={model:'Example model',tokens,records:2,input:tokens-2000,output:2000,cacheRead:0,cacheWrite:0,estimatedCost:.1,unpricedTokens:0};
            days.push({date:date.toLocaleDateString('sv-SE'),tokens,records:2,sources:['claude','codex'],models:[model]});
        }
        view.render({enabled:true,days,models:days[0].models,tokens:1234567,estimatedCost:4.56,unpricedTokens:0,fromDate:days.at(-1).date,toDate:days[0].date});
        window.present();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT,1000,()=>{
            try{
                if(view.buttons.length<365)throw Error('Missing calendar days');
                const grid=view.gridBox.get_first_child();
                if(grid.get_width()>view.gridBox.get_width())throw Error('Calendar exceeds the available content width');
                const snapshot=new Gtk.Snapshot();window.snapshot_child(window.get_child(),snapshot);
                const node=snapshot.to_node();
                if(!node)throw Error('Usage preview did not render');
                window.get_renderer().render_texture(node,null).save_to_png('/tmp/codenotch-usage-preview.png');
                view.buttons.at(-1).emit('clicked');
                if(!view.selected)throw Error('Day selection failed');
                print(`Usage page rendered: ${view.buttons.length} days; day selection works; width ${window.get_width()}`);
            }catch(error){printerr(error);failed=true;}
            view.destroy();window.close();app.quit();return GLib.SOURCE_REMOVE;
        });
    }catch(error){printerr(String(error));printerr(error.stack??error);failed=true;app.quit();}
});
app.run([]);if(failed)throw Error('Usage view smoke test failed');
