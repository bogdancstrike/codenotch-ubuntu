import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const REPOSITORY='https://github.com/bogdancstrike/codenotch-ubuntu';

// Canonical widget order; the notch draws them in this sequence.
const WIDGETS=[
    ['clock','Clock','The current time, straight from the system clock.'],
    ['date','Date','Weekday and day of the month.'],
    ['weather','Weather','Open-Meteo conditions for the location you choose. One request every 15 minutes.'],
    ['battery','Battery','System battery charge. Hidden automatically on desktops.'],
    ['system','System load','CPU and memory meters read from /proc.'],
];

export default class CodenotchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(680,860);window.set_title('Codenotch Settings');
        this._window=window;this._alive=true;this._rows=new Map();this._queue=[];this._busy=false;this._results=[];
        Adw.StyleManager.get_default().set_color_scheme(Adw.ColorScheme.FORCE_DARK);

        const connections=new Adw.PreferencesPage({title:'Connections',icon_name:'network-transmit-receive-symbolic'});
        const widgets=new Adw.PreferencesPage({title:'Widgets',icon_name:'preferences-desktop-symbolic'});
        const appearance=new Adw.PreferencesPage({title:'Appearance',icon_name:'preferences-desktop-appearance-symbolic'});
        const about=new Adw.PreferencesPage({title:'About',icon_name:'help-about-symbolic'});
        for(const page of [connections,widgets,appearance,about])window.add(page);

        this._integrations=new Adw.PreferencesGroup({title:'AI integrations',description:'Choose the AIs shown in your notch. Verification uses the login already held by each tool.'});
        connections.add(this._integrations);
        this._error=new Adw.ActionRow({title:'Loading connections…'});this._integrations.add(this._error);
        this._general=new Adw.PreferencesGroup({title:'Polling and data'});connections.add(this._general);

        this._widgetGroup=new Adw.PreferencesGroup({title:'Notch widgets',description:'Widgets sit after your AI rings, before the settings gear.'});
        widgets.add(this._widgetGroup);
        this._clockGroup=new Adw.PreferencesGroup({title:'Clock and date'});widgets.add(this._clockGroup);
        this._weatherGroup=new Adw.PreferencesGroup({title:'Weather location',description:'Searched with Open-Meteo. No account, no API key, and no identifiers are sent.'});
        widgets.add(this._weatherGroup);
        this._resultGroup=new Adw.PreferencesGroup();widgets.add(this._resultGroup);

        this._appearance=new Adw.PreferencesGroup({title:'Notch',description:'The original black silhouette, rings, and tooltip proportions.'});
        appearance.add(this._appearance);
        this._readability=new Adw.PreferencesGroup({title:'Readability'});appearance.add(this._readability);
        this._identity=new Adw.PreferencesGroup();about.add(this._identity);
        this._install=new Adw.PreferencesGroup({title:'This install'});about.add(this._install);
        this._care=new Adw.PreferencesGroup({title:'Privacy and maintenance'});about.add(this._care);

        window.connect('close-request',()=>{this._alive=false;this._process?.force_exit();return false;});
        this._run(['--info'],data=>{if(data)this._build(data);});
    }

    _run(args,done=null) {
        if(this._busy){this._queue.push([args,done]);return;}
        const worker=GLib.file_test('/usr/lib/codenotch/codenotch-worker',GLib.FileTest.EXISTS)
            ? '/usr/lib/codenotch/codenotch-worker' : `${this.path}/../backend/codenotch-worker`;
        try{this._process=Gio.Subprocess.new([worker,...args],Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_SILENCE);}
        catch(e){this._error.set_title('Worker unavailable. Install the .deb package.');return;}
        this._busy=true;
        this._process.communicate_utf8_async(null,null,(proc,result)=>{
            this._busy=false;
            if(this._alive){
                try{
                    const [ok,out]=proc.communicate_utf8_finish(result);
                    const data=JSON.parse(out);
                    if(!ok||!proc.get_successful()||data.error)throw Error('worker');
                    if(done)done(data);else this._update(data);
                }catch(e){
                    this._error.set_title('Could not read settings or verify usage. Try again.');
                    if(done)done(null);
                }
            }
            if(this._queue.length){const [a,cb]=this._queue.shift();this._run(a,cb);}
        });
    }
    // Writes are counted so a reply from an earlier write cannot roll the
    // switches back over a change the user has already made.
    _set(key,value){this._write(['--set',key,JSON.stringify(value)]);}
    _write(args){
        this._writes=(this._writes??0)+1;
        this._run(args,data=>{this._writes=Math.max(0,this._writes-1);if(data)this._update(data);});
    }

    _toggle(group,title,subtitle,state,change) {
        const row=new Adw.ActionRow({title,subtitle});
        const toggle=new Gtk.Switch({active:state,valign:Gtk.Align.CENTER});
        row.add_suffix(toggle);row.set_activatable_widget(toggle);
        toggle.connect('notify::active',()=>{if(!this._syncing)change(toggle.active);});
        group.add(row);return toggle;
    }
    _fact(group,title,subtitle) {
        const row=new Adw.ActionRow({title,subtitle});group.add(row);return row;
    }
    _combo(group,title,subtitle,values,keys,current,change) {
        const row=new Adw.ComboRow({title,subtitle,model:Gtk.StringList.new(values),selected:Math.max(0,keys.indexOf(current))});
        row.connect('notify::selected',()=>{if(!this._syncing)change(keys[row.selected]);});
        group.add(row);return row;
    }

    _build(data) {
        const s=data.settings;this._settings=s;
        this._error.set_title('Connections');
        this._error.set_subtitle('Disabled AIs are never polled. No tokens are copied or refreshed.');
        for(const p of data.providers){
            const row=new Adw.ExpanderRow({title:p.name,subtitle:p.message??'Expand to verify the connection and view details.'});
            this._integrations.add(row);
            const toggle=new Gtk.Switch({active:p.enabled,valign:Gtk.Align.CENTER});row.add_suffix(toggle);
            toggle.connect('notify::active',()=>{if(!this._syncing)this._run([toggle.active?'--enable':'--disable',p.id]);});
            const source=new Adw.ActionRow({title:'Usage source',subtitle:p.source??'Local tool sign-in'});row.add_row(source);
            const status=new Adw.ActionRow({title:'Connection status',subtitle:p.message??'Not verified yet'});row.add_row(status);
            const usage=new Adw.ActionRow({title:'Usage windows',subtitle:'No reading yet'});row.add_row(usage);
            const checked=new Adw.ActionRow({title:'Last successful reading',subtitle:'Never'});row.add_row(checked);
            const verifyRow=new Adw.ActionRow({title:'Verify connection',subtitle:'Checks the saved sign-in and requests fresh usage.'});
            const button=new Gtk.Button({label:'Verify',valign:Gtk.Align.CENTER});verifyRow.add_suffix(button);row.add_row(verifyRow);
            button.connect('clicked',()=>{button.set_sensitive(false);status.set_subtitle('Verifying…');this._run(['--verify',p.id]);});
            this._rows.set(p.id,{row,toggle,status,usage,checked,button});
        }

        // ------------------------------------------------------------ polling
        this._combo(this._general,'Usage refresh','How often a signed-in AI is asked for fresh usage while you are working.',
            ['Every minute','Every 90 seconds','Every 2½ minutes (recommended)','Every 5 minutes','Every 10 minutes'],
            [60,90,150,300,600],s.pollSeconds,v=>this._set('pollSeconds',v));
        this._combo(this._general,'Idle refresh','Used when no local session of that AI is running.',
            ['Every 5 minutes','Every 10 minutes','Every 30 minutes'],[300,600,1800],s.idlePollSeconds,v=>this._set('idlePollSeconds',v));
        this._toggle(this._general,'Demo mode','Fixed sample usage. Does not access any credentials or contact providers.',
            s.demo,v=>this._set('demo',v));
        const verify=new Adw.ActionRow({title:'Verify every enabled AI',subtitle:'Respects provider rate limits and Retry-After.'});
        const verifyAll=new Gtk.Button({label:'Verify all',valign:Gtk.Align.CENTER});verify.add_suffix(verifyAll);
        this._general.add(verify);verifyAll.connect('clicked',()=>this._run(['--verify','all']));

        // ------------------------------------------------------------ widgets
        this._widgetSwitches=new Map();
        for(const [id,title,subtitle] of WIDGETS){
            const toggle=this._toggle(this._widgetGroup,title,subtitle,(s.widgets??[]).includes(id),()=>this._setWidget());
            this._widgetSwitches.set(id,toggle);
        }
        this._combo(this._clockGroup,'Clock format','',['24-hour','12-hour'],[true,false],s.clock24,v=>this._set('clock24',v));
        this._toggle(this._clockGroup,'Show seconds','Repaints the notch once a second while it is open.',
            s.clockSeconds,v=>this._set('clockSeconds',v));
        this._combo(this._clockGroup,'Date style','',['Short (7/9)','Medium (7 Sep)','Long (Monday)'],
            ['short','medium','long'],s.dateStyle,v=>this._set('dateStyle',v));

        this._place=new Adw.EntryRow({title:'Search a city'});
        this._place.set_show_apply_button(true);
        this._place.connect('apply',()=>this._search(this._place.get_text()));
        this._weatherGroup.add(this._place);
        this._current=new Adw.ActionRow({title:'Current location',subtitle:s.weatherPlace||'Not set — search above'});
        this._weatherGroup.add(this._current);
        this._combo(this._weatherGroup,'Units','',['Celsius · km/h','Fahrenheit · mph'],['metric','imperial'],
            s.weatherUnits,v=>this._set('weatherUnits',v));

        // --------------------------------------------------------- appearance
        this._combo(this._appearance,'Notch visibility','On hover leaves a small sliver on screen so the notch stays findable.',
            ['On hover','Always show','Hidden'],['hover','always','hidden'],s.visibility,v=>this._set('visibility',v));
        this._toggle(this._appearance,'Show the resting sliver','A light handle marks the folded notch. Turn off for a fully black pill.',
            s.peek,v=>this._set('peek',v));
        this._combo(this._appearance,'Screen edge','',['Right','Left','Top','Bottom'],['right','left','top','bottom'],s.edge,v=>this._set('edge',v));
        this._combo(this._appearance,'Monitor','',['Primary display','Display 1','Display 2','Display 3','Display 4'],
            [-1,0,1,2,3],s.monitor,v=>this._set('monitor',v));
        this._combo(this._appearance,'Size','',['75%','100% (original)','125%','150%','200%'],[.75,1,1.25,1.5,2],s.scale,v=>this._set('scale',v));
        this._toggle(this._appearance,'Top panel icon','Keeps settings reachable when the notch is hidden.',s.panelIcon,v=>this._set('panelIcon',v));
        this._toggle(this._appearance,'Hide over fullscreen windows','Also hides in Activities and on the lock screen.',
            s.hideFullscreen,v=>this._set('hideFullscreen',v));
        this._combo(this._readability,'Text contrast','Lifts the secondary labels in the notch and its cards.',
            ['Standard','High (recommended)','Highest'],['normal','high','higher'],s.textContrast,v=>this._set('textContrast',v));

        this._buildAbout(data);
        this._update(data);
    }

    _buildAbout(data) {
        const version=this.metadata?.['version-name']??data.version??'';
        this._fact(this._identity,`Codenotch for Ubuntu ${version}`.trim(),
            'AI usage rings, clock, date and weather at the edge of your screen.');
        this._fact(this._identity,'Made by Bogdan D','© 2026 Bogdan D · MIT license');
        const repo=this._fact(this._identity,'Project repository',REPOSITORY);
        repo.add_suffix(new Gtk.LinkButton({uri:REPOSITORY,label:'Open',valign:Gtk.Align.CENTER}));

        const enabled=(data.providers??[]).filter(p=>p.enabled).length;
        this._fact(this._install,'AI connections',`${enabled} of ${(data.providers??[]).length} enabled`);
        this._aboutWidgets=this._fact(this._install,'Widgets','None');
        this._aboutPoll=this._fact(this._install,'Usage refresh','');
        this._fact(this._install,'Your settings',
            '~/.config/codenotch/settings.json — kept across updates and reinstalls');

        this._fact(this._care,'Credentials',
            'Read from each AI tool, used in memory, never stored, refreshed, or logged.');
        this._fact(this._care,'Network',
            'Provider usage endpoints and Open-Meteo. No account, no telemetry.');
        this._fact(this._care,'Update','Run codenotch --update from a source checkout.');
        this._fact(this._care,'Launch at login',
            'GNOME restores enabled extensions when you sign in.');
        this._refreshAbout(data.settings);
    }
    _refreshAbout(settings) {
        if(!settings||!this._aboutWidgets)return;
        const names=new Map(WIDGETS.map(([id,title])=>[id,title]));
        const chosen=(settings.widgets??[]).map(id=>names.get(id)??id);
        this._aboutWidgets.set_subtitle(chosen.length?chosen.join(', '):'None');
        const minutes=(settings.pollSeconds??150)/60;
        this._aboutPoll.set_subtitle(
            `Every ${minutes===1?'minute':`${Number.isInteger(minutes)?minutes:minutes.toFixed(1)} minutes`} while you work`);
    }

    /** The switches are the truth; never rebuild the list from a cached copy. */
    _setWidget() {
        const chosen=WIDGETS.map(([key])=>key).filter(key=>this._widgetSwitches.get(key)?.active);
        this._settings.widgets=chosen;
        this._set('widgets',chosen);
    }

    _search(query) {
        if(!query||query.trim().length<2)return;
        this._clearResults();
        const pending=new Adw.ActionRow({title:'Searching…'});this._resultGroup.add(pending);this._results.push(pending);
        this._run(['--search',query.trim()],data=>{
            this._clearResults();
            const rows=data?.results??[];
            if(!rows.length){
                const empty=new Adw.ActionRow({title:'No matching place',subtitle:'Try a larger nearby city.'});
                this._resultGroup.add(empty);this._results.push(empty);return;
            }
            this._resultGroup.set_title('Search results');
            for(const place of rows){
                const row=new Adw.ActionRow({title:place.name,subtitle:place.label,activatable:true});
                const use=new Gtk.Button({label:'Use',valign:Gtk.Align.CENTER});row.add_suffix(use);
                const choose=()=>{
                    this._current.set_subtitle(place.label);
                    this._settings.weatherPlace=place.label;
                    this._write(['--location',JSON.stringify(place)]);
                    if(!this._widgetSwitches.get('weather')?.active){
                        this._widgetSwitches.get('weather')?.set_active(true);   // writes the list itself
                    }
                    this._clearResults();
                };
                use.connect('clicked',choose);row.connect('activated',choose);
                this._resultGroup.add(row);this._results.push(row);
            }
        });
    }
    _clearResults() {
        for(const row of this._results)this._resultGroup.remove(row);
        this._results=[];this._resultGroup.set_title('');
    }

    _update(data) {
        this._syncing=true;
        for(const p of data.providers??[]){
            const r=this._rows.get(p.id);if(!r)continue;
            r.toggle.active=p.enabled;
            r.row.set_subtitle(p.status??'Not checked');
            r.status.set_subtitle(p.message??'Not verified yet');
            r.usage.set_subtitle((p.windows??[]).map(w=>`${w.label}: ${Math.round(w.fraction*100)}% used`).join('\n')||'No usage reported');
            r.checked.set_subtitle(p.updatedAt?new Date(p.updatedAt*1000).toLocaleString():'Never');
            r.button.set_sensitive(p.enabled);
        }
        if(data.settings&&!this._writes){
            this._settings=data.settings;
            this._current?.set_subtitle(data.settings.weatherPlace||'Not set — search above');
            this._refreshAbout(data.settings);
            for(const [id,toggle] of this._widgetSwitches??[])toggle.active=(data.settings.widgets??[]).includes(id);
        }
        this._syncing=false;
    }
}
