#!/usr/bin/gjs -m
// Sidebar navigation smoke test: sections, ordering, search into page rows, toasts.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import {SettingsShell,pageHeading,segmented,glyphIcon} from '../extension/settings-shell.js';
const app=new Adw.Application({application_id:'local.codenotch.ShellSmoke'});
let failed=false;
const assert=(condition,message)=>{if(!condition)throw Error(message);};
app.connect('activate',()=>{
    const window=new Adw.PreferencesWindow({application:app,default_width:1000,default_height:700});
    try{
        const seen=[];const shell=new SettingsShell(window,{title:'Test',onPageChanged:id=>seen.push(id)});
        const page=title=>{const p=new Adw.PreferencesPage();pageHeading(p,title,'Description');return p;};
        const general=page('General'),about=page('About'),account=page('Claude');
        const group=new Adw.PreferencesGroup({title:'Refresh'});general.add(group);group.add(new Adw.ActionRow({title:'Idle refresh interval'}));
        let chosen=null;const choice=segmented(group,'Edge','',['Left','Right'],['left','right'],'right',key=>{chosen=key;});
        shell.add('general',general,{section:'Panel',title:'General',icon:'preferences-system-symbolic',order:0});
        shell.add('about',about,{section:'Application',title:'About',icon:'help-about-symbolic',order:1000});
        shell.add('account:claude',account,{section:'Accounts',title:'Claude',icon:glyphIcon('claude'),order:100});
        const listRows=()=>{const out=[];for(let i=0,row;(row=shell.list.get_row_at_index(i));i++)out.push(row);return out;};
        const rows=listRows().map(row=>row.pageId);
        assert(rows.join()==='general,account:claude,about',`Sidebar order ${rows}`);
        assert(shell.visible()==='general','First page is shown');
        shell.show('account:claude');assert(shell.visible()==='account:claude'&&seen.at(-1)==='account:claude','Navigation');
        shell.search.set_text('idle refresh');shell.query='idle refresh';shell.list.invalidate_filter();
        const matching=listRows().filter(row=>row.matches(shell.query)).map(row=>row.pageId);
        assert(matching.join()==='general','Search matches rows inside pages');
        choice.set('left');assert(chosen===null,'Programmatic sync does not write');
        shell.rename('account:claude','Work Claude');shell.toast('Saved');
        shell.remove('account:claude');assert(!shell.has('account:claude')&&shell.visible()==='general','Removing the visible page falls back');
        print('Settings shell passed: sections, order, navigation, search, segmented sync, removal.');
    }catch(error){printerr(`${error}\n${error.stack??''}`);failed=true;}
    GLib.idle_add(0,()=>{window.close();app.quit();return false;});
});
app.run([]);if(failed)throw Error('Settings shell smoke test failed');
