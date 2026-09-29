import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {UsagePage} from './history-view.js';
import {usageStats,compactCount,formatUSD} from './history-model.js';
import {clear,label,button,metrics,barChart,meter} from './history-widgets.js';
import {applyTheme,stylePreferences,sizePreferencesPage} from './preferences-style.js';
import {SettingsShell,pageHeading,segmented,glyphIcon} from './settings-shell.js';

const REPOSITORY='https://github.com/bogdancstrike/codenotch-ubuntu';

// Canonical widget order; the notch draws them in this sequence.
const WIDGETS=[
    ['clock','Clock','The current time, straight from the system clock.','time'],
    ['date','Date','Weekday and day of the month.','time'],
    ['utc','UTC clock','Coordinated Universal Time, for teams and servers in other zones.','time'],
    ['progress','Day progress','How much of today has passed; the card adds week, month and year.','time'],
    ['weather','Weather','Open-Meteo conditions for the location you choose. One request every 15 minutes.','sky'],
    ['sun','Sunrise and sunset','The next sunrise or sunset at your weather location. Shares the weather request.','sky'],
    ['moon','Moon phase','Illuminated share of the moon, calculated locally.','sky'],
    ['battery','Battery','System battery charge. Hidden automatically on desktops.','system'],
    ['system','System overview','CPU, memory and storage together in one widget.','system'],
    ['cpu','CPU','Processor utilization between readings.','system'],
    ['memory','Memory','RAM utilization and available memory.','system'],
    ['swap','Swap','Swap space in use. Shows Off when no swap is configured.','system'],
    ['storage','Storage','Root filesystem utilization and free space.','system'],
    ['diskio','Disk activity','Read and write rates across whole disks.','system'],
    ['network','Network traffic','Download and upload rates, summed across non-loopback interfaces.','network'],
    ['wifi','Wi-Fi signal','Link quality of the strongest wireless interface.','network'],
    ['uptime','Uptime','Time since this computer last started.','system'],
    ['temperature','CPU temperature','Highest supported CPU sensor. Shows unavailable when no sensor exists.','system'],
    ['load','Load average','Processes waiting for CPU over the last minute; the card adds 5 and 15 minutes.','system'],
    ['processes','Processes','Tasks that exist right now, and how many are running.','system'],
];
const WIDGET_GROUPS=[
    ['time','Time and date','Drawn from the system clock; no readings or network requests.'],
    ['sky','Weather and sky','Weather and sunrise share one Open-Meteo request every 15 minutes.'],
    ['system','System','Local readings from /proc and /sys, sampled with each usage refresh.'],
    ['network','Network','Local interface counters only.'],
];
const accountSummary=p=>`${p.enabled?'Shown in the notch':'Off'} · ${p.status??'not checked'}${p.windows?.length?` · ${p.windows.length} usage window${p.windows.length>1?'s':''}`:''}`;
// Local history exists only for these tools; see history.py.
const HISTORY_SOURCES=new Set(['claude','codex','opencode']);

export default class CodenotchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(1200,860);window.set_title('Codenotch Settings');
        this._window=window;this._alive=true;this._writeJobs=new Set();this._rows=new Map();this._queue=[];this._busy=false;this._results=[];
        applyTheme();window.set_search_enabled(false);
        this._removeStyle=stylePreferences(window);

        const connections=new Adw.PreferencesPage(),widgets=new Adw.PreferencesPage(),appearance=new Adw.PreferencesPage(),about=new Adw.PreferencesPage();
        pageHeading(connections,'General','AI accounts, refresh timing and notifications.');
        pageHeading(widgets,'Widgets','Choose what appears after the AI rings. Changes apply immediately.');
        pageHeading(appearance,'Appearance','The notch, the top bar and this window.');
        pageHeading(about,'About');
        this._usage=new UsagePage(this);
        this._shell=new SettingsShell(window,{title:'Codenotch Settings',onPageChanged:id=>this._pageChanged(id)});
        for(const [id,page,title,icon,order] of [['general',connections,'General','preferences-system-symbolic',0],['usage',this._usage.page,'Usage','view-grid-symbolic',10],
            ['widgets',widgets,'Widgets','view-app-grid-symbolic',20],['appearance',appearance,'Appearance','preferences-desktop-appearance-symbolic',30]]){
            sizePreferencesPage(page);this._shell.add(id,page,{section:'Panel',title,icon,order});
        }
        sizePreferencesPage(about);this._shell.add('about',about,{section:'Application',title:'About',icon:'help-about-symbolic',order:1000});

        this._integrations=new Adw.PreferencesGroup({title:'AI accounts',description:'Choose the AIs shown in your notch. Select an account for its limits, history and diagnostics.'});
        connections.add(this._integrations);
        this._error=new Adw.ActionRow({title:'Loading connections…'});this._integrations.add(this._error);
        this._general=new Adw.PreferencesGroup({title:'Refresh and data'});connections.add(this._general);
        this._notifications=new Adw.PreferencesGroup({title:'Notifications',description:'Choose when Codenotch should interrupt you.'});connections.add(this._notifications);

        this._widgetSummary=new Adw.PreferencesGroup({title:'Your notch',description:'Widgets appear after the AI rings in the order listed here. Fewer widgets keep the notch easier to read.'});widgets.add(this._widgetSummary);
        this._widgetCount=new Adw.ActionRow({title:'Enabled widgets'});this._widgetSummary.add(this._widgetCount);
        this._clockGroup=new Adw.PreferencesGroup({title:'Clock and date options'});
        this._weatherGroup=new Adw.PreferencesGroup({title:'Weather location',description:'Searched with Open-Meteo. No account, no API key, and no identifiers are sent.'});
        this._resultGroup=new Adw.PreferencesGroup();
        // Each group's options follow it directly, so settings sit beside the widgets they affect.
        const options={time:[this._clockGroup],sky:[this._weatherGroup,this._resultGroup]};
        this._widgetGroups=new Map(WIDGET_GROUPS.map(([id,title,description])=>{
            const group=new Adw.PreferencesGroup({title,description});widgets.add(group);
            for(const extra of options[id]??[])widgets.add(extra);return [id,group];
        }));

        this._themeGroup=new Adw.PreferencesGroup({title:'Settings appearance',description:'Follow your desktop or choose a light or dark interface.'});appearance.add(this._themeGroup);
        this._appearance=new Adw.PreferencesGroup({title:'Notch',description:'The original black silhouette, rings, and tooltip proportions.'});
        appearance.add(this._appearance);
        this._topBar=new Adw.PreferencesGroup({title:'Top bar',description:'Choose what appears in the Ubuntu top bar. Hide the icon to use only the notch.'});
        appearance.add(this._topBar);
        this._quotaPresentation=new Adw.PreferencesGroup({title:'Usage display',description:'How quota information appears in the notch and top bar.'});appearance.add(this._quotaPresentation);
        this._readability=new Adw.PreferencesGroup({title:'Readability'});appearance.add(this._readability);
        this._identity=new Adw.PreferencesGroup({title:'Codenotch'});about.add(this._identity);
        this._install=new Adw.PreferencesGroup({title:'This install'});about.add(this._install);
        this._care=new Adw.PreferencesGroup({title:'Privacy and maintenance'});about.add(this._care);

        this._window.connect('close-request',()=>{this._alive=false;this._shell.destroy();this._removeStyle?.();this._usage?.destroy();this._process?.force_exit();for(const proc of this._writeJobs)proc.force_exit();return false;});
        this._run(['--info'],data=>{if(data)this._build(data);});
    }

    _run(args,done=null) {
        if(this._busy){this._queue.push([args,done]);return;}
        const worker=GLib.file_test('/usr/lib/codenotch/codenotch-worker',GLib.FileTest.EXISTS)
            ? '/usr/lib/codenotch/codenotch-worker' : `${this.path}/../backend/codenotch-worker`;
        try{this._process=Gio.Subprocess.new([worker,...args],Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_SILENCE);}
        catch(e){this._fail('Worker unavailable. Install the .deb package.');return;}
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
                    this._fail('Could not read settings or verify usage. Try again.');
                    if(done)done(null);
                }
            }
            if(this._alive&&this._queue.length){const [a,cb]=this._queue.shift();this._run(a,cb);}
        });
    }
    // Writes are counted so a reply from an earlier write cannot roll the
    // switches back over a change the user has already made.
    _set(key,value,done=null){this._write(['--set',key,JSON.stringify(value)],done);}
    _write(args,done=null){
        // Settings use their own subprocess so a Verify or history scan cannot
        // make a switch wait behind network or disk work.
        const worker=GLib.file_test('/usr/lib/codenotch/codenotch-worker',GLib.FileTest.EXISTS)
            ? '/usr/lib/codenotch/codenotch-worker' : `${this.path}/../backend/codenotch-worker`;
        this._writes=(this._writes??0)+1;
        let proc;
        try{proc=Gio.Subprocess.new([worker,...args],Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_SILENCE);}
        catch(error){this._writes--;this._fail('Could not save settings.');return;}
        this._writeJobs.add(proc);
        proc.communicate_utf8_async(null,null,(process,result)=>{
            this._writeJobs.delete(process);this._writes=Math.max(0,this._writes-1);
            if(!this._alive)return;
            try{const [ok,out]=process.communicate_utf8_finish(result);if(!ok||!process.get_successful())throw Error();this._update(JSON.parse(out));if(done)done();}
            catch(error){this._fail('Could not save settings.');}
        });
    }

    // Failures show in place on General and as a toast on whichever page is open.
    _fail(text) {
        this._error.set_title(text);this._error.set_subtitle('');this._error.set_visible(true);
        this._shell?.toast(text);
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

    // Each account gets a list row on General and its own sidebar page.
    _addProviderRow(p) {
        const kind=p.kind??p.id.split(':')[0],pageId=`account:${p.id}`;
        const row=new Adw.ActionRow({title:p.name,subtitle:p.status??'Not checked',activatable:true,use_markup:false});
        row.add_prefix(glyphIcon(p.glyph??kind,20));this._integrations.add(row);
        const toggle=new Gtk.Switch({active:p.enabled,valign:Gtk.Align.CENTER});row.add_suffix(toggle);
        row.add_suffix(new Gtk.Image({icon_name:'go-next-symbolic'}));
        row.connect('activated',()=>this._shell.show(pageId));
        const enable=value=>{if(!this._syncing)this._write([value?'--enable':'--disable',p.id]);};
        toggle.connect('notify::active',()=>enable(toggle.active));

        const page=new Adw.PreferencesPage();
        const heading=pageHeading(page,p.name,accountSummary(p));
        const connection=new Adw.PreferencesGroup({title:'Connection'});page.add(connection);
        const enabledRow=new Adw.ActionRow({title:'Show in the notch',subtitle:'Disabled AIs are never polled. No tokens are copied or refreshed.'});
        const pageToggle=new Gtk.Switch({active:p.enabled,valign:Gtk.Align.CENTER});enabledRow.add_suffix(pageToggle);enabledRow.set_activatable_widget(pageToggle);
        connection.add(enabledRow);pageToggle.connect('notify::active',()=>enable(pageToggle.active));
        const label=new Adw.EntryRow({title:'Account label',text:p.name,show_apply_button:true});connection.add(label);
        label.connect('apply',()=>{
            const labels={...this._settings.accountLabels,[p.id]:label.get_text()};
            this._settings.accountLabels=labels;this._set('accountLabels',labels);
        });
        const status=new Adw.ActionRow({title:'Status',subtitle:p.message??'Not verified yet',use_markup:false});connection.add(status);
        const checked=new Adw.ActionRow({title:'Last successful reading',subtitle:'Never'});connection.add(checked);
        const verify=button('Verify');checked.add_suffix(verify);
        verify.set_tooltip_text('Checks the saved sign-in and requests fresh usage.');
        verify.connect('clicked',()=>{verify.set_sensitive(false);status.set_subtitle('Verifying…');this._run(['--verify',p.id]);});

        const usage=new Adw.PreferencesGroup({title:'Current usage',description:'Latest reading reported by the provider.'});page.add(usage);
        const ring=new Adw.PreferencesGroup({title:'Notch ring'});page.add(ring);
        const pin=new Adw.ComboRow({title:'Ring shows',subtitle:'The usage window drawn as this account\'s ring.'});ring.add(pin);
        pin.connect('notify::selected',()=>{
            if(this._syncing)return;
            const keys=this._rows.get(p.id)?.pinKeys??[];
            const pins={...this._settings.pinnedWindows};
            if(keys[pin.selected])pins[p.id]=keys[pin.selected];else delete pins[p.id];
            this._settings.pinnedWindows=pins;this._set('pinnedWindows',pins);
        });
        const history=new Adw.PreferencesGroup({title:'Usage history',
            description:HISTORY_SOURCES.has(kind)?'Counted from this computer\'s local records for this tool, across all of its profiles.':''});page.add(history);
        const historyBox=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:12});history.add(historyBox);
        const diagnostics=new Adw.PreferencesGroup({title:'Diagnostics'});page.add(diagnostics);
        const source=new Adw.ActionRow({title:'Usage source',subtitle:p.source??'Local tool sign-in',use_markup:false,subtitle_selectable:true});diagnostics.add(source);
        const diagnostic=new Adw.ActionRow({title:'Latest check and routes',subtitle:'Not checked',use_markup:false});diagnostics.add(diagnostic);

        sizePreferencesPage(page);
        this._shell.add(pageId,page,{section:'Accounts',title:p.name,icon:glyphIcon(p.glyph??kind),order:100+this._rows.size});
        this._rows.set(p.id,{row,toggle,pageToggle,status,usage,windowRows:[],checked,button:verify,pin,pinKeys:[],diagnostic,heading,source,historyBox,kind,pageId});
    }
    _pageChanged(id) {
        if(!this._settings)return;
        const account=[...this._rows.values()].find(r=>r.pageId===id);
        if(id==='usage'||(account&&HISTORY_SOURCES.has(account.kind)))this._usage.load();
        if(account)this._renderAccount(account);
    }
    _historyVisible() {
        const id=this._shell.visible();
        return id==='usage'||[...this._rows.values()].some(r=>r.pageId===id&&HISTORY_SOURCES.has(r.kind));
    }
    // Called by the Usage page whenever local history is (re)loaded.
    _historyChanged() {
        const account=[...this._rows.values()].find(r=>r.pageId===this._shell.visible());
        if(account)this._renderAccount(account);
    }
    _renderAccount(r) {
        const box=r.historyBox;clear(box);
        if(!HISTORY_SOURCES.has(r.kind)){box.append(label('Local token history covers Claude Code, Codex and OpenCode. Live limits above still apply to this account.',['dim-label']));return;}
        const openData=text=>{
            box.append(label(text,['dim-label']));
            const open=button('Open Usage settings',{halign:Gtk.Align.START});box.append(open);
            open.connect('clicked',()=>{this._shell.show('usage');this._usage.stack.set_visible_child_name('data');});
        };
        if(!this._settings?.usageHistory){openData('Local history is off. Turn it on to see tokens and estimated costs for this account.');return;}
        const report=this._usage.report;
        if(!report?.breakdown){box.append(label(this._usage.loading?'Reading local history…':'No local history yet.',['dim-label']));return;}
        const stats=span=>usageStats(report,{span,source:r.kind});
        const today=stats(1),month=stats(30),year=stats(365);
        if(!year.records){box.append(label(`No local records from this tool in the last year. Records appear here after you use it on this computer.`,['dim-label']));return;}
        const value=s=>s.pricedRecords?formatUSD(s.estimatedCost):compactCount(s.tokens);
        const detail=s=>s.pricedRecords?`${compactCount(s.tokens)} tokens${s.unpricedTokens?' · partial':''}`:'tokens · unpriced';
        metrics(box,[['Today',value(today),detail(today)],['Last 30 days',value(month),detail(month)],
            ['Busiest day',month.busiest?compactCount(month.busiest.tokens):'—',month.busiest?.date??'No activity'],['All history',value(year),detail(year)]]);
        const chart=barChart(box,'Last 30 days',month.days.map(d=>({label:d.date,value:d.recorded?d.tokens:null})),{height:110,
            onSelect:entry=>{this._shell.show('usage');this._usage.openDay(entry.label);}});
        if(month.topModel)chart.append(label(`Top model · ${month.topModel.label} · ${(month.topModel.tokens/Math.max(1,month.tokens)*100).toFixed(0)}% of tokens`,['caption','dim-label']));
    }

    _build(data) {
        const s=data.settings;this._settings=s;
        this._error.set_visible(false);
        for(const p of data.providers)this._addProviderRow(p);

        this._fact(this._general,'Custom quota programs','Install a codenotch-extension.json and executable in ~/.local/share/codenotch/extensions/NAME, then reopen Settings. Each program starts disabled.');
        const profiles=new Adw.ExpanderRow({title:'Add an account profile',subtitle:'Use a folder already signed in with Claude Code, Codex or Grok.'});this._integrations.add(profiles);
        const kind=new Adw.ComboRow({title:'Provider',model:Gtk.StringList.new(['Claude Code','Codex','Grok'])});profiles.add_row(kind);
        const profileName=new Adw.EntryRow({title:'Label'});profiles.add_row(profileName);
        const profilePath=new Adw.EntryRow({title:'Absolute profile folder'});profiles.add_row(profilePath);
        const addRow=new Adw.ActionRow({title:'Use existing sign-in'});profiles.add_row(addRow);
        const add=new Gtk.Button({label:'Add profile',valign:Gtk.Align.CENTER});addRow.add_suffix(add);
        add.connect('clicked',()=>{
            const path=profilePath.get_text().trim();
            if(!path.startsWith('/')){addRow.set_subtitle('Enter an absolute folder path.');return;}
            const entry={id:GLib.uuid_string_random(),kind:['claude','codex','grok'][kind.selected],path,name:profileName.get_text().trim()||'Additional account'};
            const entries=[...(this._settings.accountProfiles??[]),entry];
            this._settings.accountProfiles=entries;this._set('accountProfiles',entries);
            addRow.set_subtitle('Profile added. Its connection appears above.');
        });
        const diagnosticRow=new Adw.ActionRow({title:'Share connection diagnostics',subtitle:'Excludes account names, paths, sessions and credentials.'});
        const copy=new Gtk.Button({label:'Copy report',valign:Gtk.Align.CENTER});diagnosticRow.add_suffix(copy);this._general.add(diagnosticRow);
        copy.connect('clicked',()=>this._run(['--diagnostics'],result=>{
            if(result){Gdk.Display.get_default().get_clipboard().set(JSON.stringify(result.report,null,2));copy.set_label('Copied');}
        }));
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

        this._toggle(this._notifications,'Quota notifications','Warn once per window at the threshold and when exhausted.',s.notifyQuota,v=>this._set('notifyQuota',v));
        this._combo(this._notifications,'Warning threshold','Percentage used',['75%','80%','90%','95%'],[75,80,90,95],s.notifyThreshold,v=>this._set('notifyThreshold',v));
        this._toggle(this._notifications,'Reset notifications','Notify when a previously warned window becomes available.',s.notifyReset,v=>this._set('notifyReset',v));
        this._toggle(this._notifications,'Connection notifications','Warn after three failed usage checks.',s.notifyFailures,v=>this._set('notifyFailures',v));

        // ------------------------------------------------------------ widgets
        this._widgetSwitches=new Map();
        for(const [id,title,subtitle,groupId] of WIDGETS){
            const group=this._widgetGroups.get(groupId);
            const toggle=this._toggle(group,title,subtitle,(s.widgets??[]).includes(id),()=>{this._setWidget();this._syncWidgetGroups();});
            this._widgetSwitches.set(id,toggle);
        }
        segmented(this._clockGroup,'Clock format','',['24-hour','12-hour'],[true,false],s.clock24,v=>this._set('clock24',v));
        this._toggle(this._clockGroup,'Show seconds','Repaints the notch once a second while it is open.',
            s.clockSeconds,v=>this._set('clockSeconds',v));
        segmented(this._clockGroup,'Date style','Short 7/9 · Medium 7 Sep · Long Monday',['Short','Medium','Long'],
            ['short','medium','long'],s.dateStyle,v=>this._set('dateStyle',v));

        this._place=new Adw.EntryRow({title:'Search a city'});
        this._place.set_show_apply_button(true);
        this._place.connect('apply',()=>this._search(this._place.get_text()));
        this._weatherGroup.add(this._place);
        this._current=new Adw.ActionRow({title:'Current location',subtitle:s.weatherPlace||'Not set — search above'});
        this._weatherGroup.add(this._current);
        segmented(this._weatherGroup,'Units','',['°C · km/h','°F · mph'],['metric','imperial'],
            s.weatherUnits,v=>this._set('weatherUnits',v));

        // --------------------------------------------------------- appearance
        applyTheme(s.settingsTheme);
        this._theme=segmented(this._themeGroup,'Color scheme','Applies immediately to all settings pages.',
            ['System','Light','Dark'],['system','light','dark'],s.settingsTheme??'system',value=>{applyTheme(value);this._set('settingsTheme',value);});
        segmented(this._appearance,'Notch visibility','On hover leaves a small sliver on screen so the notch stays findable.',
            ['On hover','Always','Hidden'],['hover','always','hidden'],s.visibility,v=>this._set('visibility',v));
        this._toggle(this._appearance,'Show the resting sliver','A light handle marks the folded notch. Turn off for a fully black pill.',
            s.peek,v=>this._set('peek',v));
        segmented(this._appearance,'Screen edge','Where the notch docks.',['Left','Top','Bottom','Right'],['left','top','bottom','right'],s.edge,v=>this._set('edge',v));
        this._combo(this._appearance,'Monitor','',['Primary display','Display 1','Display 2','Display 3','Display 4'],
            [-1,0,1,2,3],s.monitor,v=>this._set('monitor',v));
        this._combo(this._appearance,'Size','',['75%','100% (original)','125%','150%','200%'],[.75,1,1.25,1.5,2],s.scale,v=>this._set('scale',v));
        this._toggle(this._topBar,'Show icon in top bar','Turn off to hide the entire top-bar indicator, including usage.',s.panelIcon,v=>this._set('panelIcon',v));
        this._toggle(this._topBar,'Show usage in top bar','Show account usage beside the icon, for example “Claude 25% used”. Turn off to hide this text.',s.panelUsage,v=>this._set('panelUsage',v));
        this._combo(this._topBar,'Top-bar account','Automatic chooses the most-used enabled account.',
            ['Automatic',...data.providers.map(p=>p.name)],['',...data.providers.map(p=>p.id)],s.panelAccount,v=>this._set('panelAccount',v));
        this._toggle(this._appearance,'Hide over fullscreen windows','Also hides in Activities and on the lock screen.',
            s.hideFullscreen,v=>this._set('hideFullscreen',v));
        segmented(this._quotaPresentation,'Quota percentage','Applies to the notch and panel. Colors always reflect usage.',
            ['Used','Remaining'],['used','remaining'],s.quotaDisplay,v=>this._set('quotaDisplay',v));
        this._toggle(this._quotaPresentation,'Usage forecast','Estimated from average usage since the reported window began. Hidden for stale data.',s.forecast,v=>this._set('forecast',v));
        this._toggle(this._quotaPresentation,'Window clock','Outer arc shows elapsed time when the provider reports a duration.',s.windowClock,v=>this._set('windowClock',v));
        segmented(this._readability,'Text contrast','Lifts the secondary labels in the notch and its cards. High is recommended.',
            ['Standard','High','Highest'],['normal','high','higher'],s.textContrast,v=>this._set('textContrast',v));

        this._syncWidgetGroups();
        this._usage.sync(s);
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
                    if(!this._widgetSwitches.get('weather')?.active&&!this._widgetSwitches.get('sun')?.active){
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

    _syncWidgetGroups() {
        const active=[...(this._widgetSwitches??[])].filter(([,toggle])=>toggle.active).map(([id])=>id);
        this._widgetCount.set_subtitle(`${active.length} of ${WIDGETS.length} enabled${active.length>6?' · A long notch is harder to scan; consider fewer.':''}`);
        this._clockGroup.set_visible(active.includes('clock')||active.includes('date'));
        const located=active.includes('weather')||active.includes('sun');
        this._weatherGroup.set_visible(located);this._resultGroup.set_visible(located);
    }

    _update(data) {
        if(BigInt(data.settings?.revision??'0')<BigInt(this._settings?.revision??'0'))return;
        this._syncing=true;
        for(const p of data.providers??[]){
            if(!this._rows.has(p.id))this._addProviderRow(p);
            const r=this._rows.get(p.id);if(!r)continue;
            r.row.set_title(p.name);r.toggle.active=p.enabled;r.pageToggle.active=p.enabled;
            r.heading.detail.set_label(accountSummary(p));r.source.set_subtitle(p.source??'Local tool sign-in');this._shell.rename(r.pageId,p.name);
            r.pinKeys=['',...(p.windows??[]).map(w=>w.id)];
            const automatic=(p.kind??p.id.split(':')[0])==='codex'?'Automatic (5-hour window)':'Automatic (most used)';
            r.pin.set_model(Gtk.StringList.new([automatic,...(p.windows??[]).map(w=>w.label)]));
            r.pin.set_selected(Math.max(0,r.pinKeys.indexOf(data.settings?.pinnedWindows?.[p.id]??'')));
            r.row.set_subtitle(p.status??'Not checked');
            r.status.set_subtitle(p.message??'Not verified yet');
            for(const old of r.windowRows)r.usage.remove(old);r.windowRows=[];
            for(const w of p.windows??[]){
                const item=new Adw.ActionRow({title:w.label,use_markup:false,
                    subtitle:w.resetsAt?`Resets ${new Date(w.resetsAt*1000).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'})}`:'No reset reported'});
                item.add_suffix(meter(w.fraction));
                item.add_suffix(label(`${Math.round(w.fraction*100)}%`,['heading','numeric'],{width_chars:4,xalign:1,wrap:false}));
                r.usage.add(item);r.windowRows.push(item);
            }
            if(!r.windowRows.length){const item=new Adw.ActionRow({title:p.enabled?'No usage reported yet':'Account is off',subtitle:p.enabled?'Verify the connection to request a reading.':'Turn on Show in the notch to read its limits.'});r.usage.add(item);r.windowRows.push(item);}
            r.diagnostic.set_subtitle(`${p.checkedAt?new Date(p.checkedAt*1000).toLocaleString():'Never'}${p.retryAt>Date.now()/1000?' · waiting for retry deadline':''}\n${(p.attempts??[]).map(a=>`${a.route}: ${a.state}`).join(' → ')}`);
            r.checked.set_subtitle(p.updatedAt?new Date(p.updatedAt*1000).toLocaleString():'Never');
            r.button.set_sensitive(p.enabled);
        }
        if(data.settings&&!this._writes){
            this._settings=data.settings;applyTheme(data.settings.settingsTheme);this._theme?.set(data.settings.settingsTheme??'system');this._usage.sync(data.settings);
            this._usage.syncProviders(data.providers);
            this._current?.set_subtitle(data.settings.weatherPlace||'Not set — search above');
            this._refreshAbout(data.settings);
            for(const [id,toggle] of this._widgetSwitches??[])toggle.active=(data.settings.widgets??[]).includes(id);
            this._syncWidgetGroups();
        }
        this._syncing=false;
    }
}
