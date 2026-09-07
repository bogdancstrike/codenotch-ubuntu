import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class CodenotchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window){
        window.set_default_size(640,780);window.set_title('Codenotch Settings');
        this._window=window;this._alive=true;this._rows=new Map();this._queue=[];this._busy=false;
        Adw.StyleManager.get_default().set_color_scheme(Adw.ColorScheme.FORCE_DARK);
        const page=new Adw.PreferencesPage({title:'Codenotch',icon_name:'utilities-system-monitor-symbolic'});window.add(page);this._page=page;
        this._integrations=new Adw.PreferencesGroup({title:'AI integrations',description:'Choose the AIs shown in your notch. Verification uses the login already held by each tool.'});page.add(this._integrations);
        this._error=new Adw.ActionRow({title:'Loading connections…'});this._integrations.add(this._error);
        this._appearance=new Adw.PreferencesGroup({title:'Appearance',description:'The original black notch, rings, and tooltip proportions. A separate settings cell stays at the end.'});page.add(this._appearance);
        const general=new Adw.PreferencesGroup({title:'General'});page.add(general);this._general=general;
        const about=new Adw.ActionRow({title:'Codenotch for Ubuntu 0.1.0',subtitle:'Original design and artwork © 2026 Vinz · MIT license\nUbuntu adaptation. Updates are installed through a new .deb package.'});general.add(about);
        window.connect('close-request',()=>{this._alive=false;this._process?.force_exit();return false;});
        this._run(['--info'],data=>this._build(data));
    }
    _run(args,done=null){
        if(this._busy){this._queue.push([args,done]);return;}
        const worker=GLib.file_test('/usr/lib/codenotch/codenotch-worker',GLib.FileTest.EXISTS)?'/usr/lib/codenotch/codenotch-worker':`${this.path}/../backend/codenotch-worker`;
        try{this._process=Gio.Subprocess.new([worker,...args],Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_SILENCE);}catch(e){this._error.set_title('Worker unavailable. Install the .deb package.');return;}
        this._busy=true;
        this._process.communicate_utf8_async(null,null,(proc,result)=>{this._busy=false;if(!this._alive)return;
            try{const [ok,out]=proc.communicate_utf8_finish(result);const data=JSON.parse(out);if(!ok||!proc.get_successful()||data.error)throw Error();if(done)done(data);else this._update(data);}catch(e){this._error.set_title('Could not read settings or verify usage. Try again.');}
            if(this._queue.length){const [a,cb]=this._queue.shift();this._run(a,cb);}
        });
    }
    _toggle(group,title,subtitle,state,change){const row=new Adw.ActionRow({title,subtitle});const toggle=new Gtk.Switch({active:state,valign:Gtk.Align.CENTER});row.add_suffix(toggle);row.set_activatable_widget(toggle);toggle.connect('notify::active',()=>{if(!this._syncing)change(toggle.active);});group.add(row);return toggle;}
    _combo(group,title,values,keys,current,key){const row=new Adw.ComboRow({title,model:Gtk.StringList.new(values),selected:Math.max(0,keys.indexOf(current))});row.connect('notify::selected',()=>this._run(['--set',key,JSON.stringify(keys[row.selected])]));group.add(row);}
    _build(data){
        this._settings=data.settings;this._error.set_title('Connections');this._error.set_subtitle('Disabled AIs are never polled. No tokens are copied or refreshed.');
        for(const p of data.providers){
            const row=new Adw.ExpanderRow({title:p.name,subtitle:p.message??'Expand to verify the connection and view details.'});this._integrations.add(row);
            const toggle=new Gtk.Switch({active:p.enabled,valign:Gtk.Align.CENTER});row.add_suffix(toggle);toggle.connect('notify::active',()=>{if(!this._syncing)this._run([toggle.active?'--enable':'--disable',p.id]);});
            const source=new Adw.ActionRow({title:'Usage source',subtitle:p.source??'Local tool sign-in'});row.add_row(source);
            const status=new Adw.ActionRow({title:'Connection status',subtitle:p.message??'Not verified yet'});row.add_row(status);
            const usage=new Adw.ActionRow({title:'Usage windows',subtitle:'No reading yet'});row.add_row(usage);
            const checked=new Adw.ActionRow({title:'Last successful reading',subtitle:'Never'});row.add_row(checked);
            const verifyRow=new Adw.ActionRow({title:'Verify connection',subtitle:'Checks the saved sign-in and requests fresh usage.'});const button=new Gtk.Button({label:'Verify',valign:Gtk.Align.CENTER});verifyRow.add_suffix(button);row.add_row(verifyRow);
            button.connect('clicked',()=>{button.set_sensitive(false);status.set_subtitle('Verifying…');this._run(['--verify',p.id]);});
            this._rows.set(p.id,{row,toggle,status,usage,checked,button});
        }
        const s=data.settings;
        this._combo(this._appearance,'Notch visibility',['On hover','Always show','Hidden'],['hover','always','hidden'],s.visibility,'visibility');
        this._combo(this._appearance,'Screen edge',['Right','Left','Top','Bottom'],['right','left','top','bottom'],s.edge,'edge');
        const monitors=['Primary display','Display 1','Display 2','Display 3','Display 4'];this._combo(this._appearance,'Monitor',monitors,[-1,0,1,2,3],s.monitor,'monitor');
        this._combo(this._appearance,'Size',['75%','100% (original)','125%','150%','200%'],[.75,1,1.25,1.5,2],s.scale,'scale');
        this._toggle(this._appearance,'Top panel icon','Keeps settings reachable when the notch is hidden.',s.panelIcon,v=>this._run(['--set','panelIcon',JSON.stringify(v)]));
        this._toggle(this._appearance,'Hide over fullscreen windows','Also hides in Activities and on the lock screen.',s.hideFullscreen,v=>this._run(['--set','hideFullscreen',JSON.stringify(v)]));
        this._toggle(this._general,'Demo mode','Fixed sample usage. Does not access any credentials or contact providers.',s.demo,v=>this._run(['--set','demo',JSON.stringify(v)]));
        const verify=new Adw.ActionRow({title:'Verify every enabled AI',subtitle:'Respects provider rate limits and Retry-After.'});const button=new Gtk.Button({label:'Verify all',valign:Gtk.Align.CENTER});verify.add_suffix(button);this._general.add(verify);button.connect('clicked',()=>this._run(['--verify','all']));
        const login=new Adw.ActionRow({title:'Launch at login',subtitle:'GNOME restores enabled extensions when you sign in. Disable Codenotch in the Extensions app to stop it.'});this._general.add(login);
        this._update(data);
    }
    _update(data){this._syncing=true;for(const p of data.providers??[]){const r=this._rows.get(p.id);if(!r)continue;r.toggle.active=p.enabled;r.row.set_subtitle(p.status??'Not checked');r.status.set_subtitle(p.message??'Not verified yet');r.usage.set_subtitle((p.windows??[]).map(w=>`${w.label}: ${Math.round(w.fraction*100)}% used`).join('\n')||'No usage reported');r.checked.set_subtitle(p.updatedAt?new Date(p.updatedAt*1000).toLocaleString():'Never');r.button.set_sensitive(p.enabled);}this._syncing=false;}
}
