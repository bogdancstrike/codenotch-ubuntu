import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {D,P,geometry,point,drawNotch,drawCard,cardLayout,hitTest,color} from './render.js';

export default class Codenotch extends Extension {
    enable() {
        this._alive=true;this._sources=new Set();this._signals=[];this._jobs=new Set();this._queued=[];
        this._snapshot=null;this._providers=[];this._expanded=false;this._progress=0;this._hover=-1;this._menuRows=new Map();
        this._settings={edge:'right',visibility:'hover',scale:1,monitor:-1,panelIcon:true,hideFullscreen:true};
        this._notch=new St.DrawingArea({reactive:true,can_focus:true,track_hover:true,accessible_name:'Codenotch — AI usage. Press Enter for settings.'});
        this._notch.connect('repaint',area=>{const cr=area.get_context();cr.scale(this._scale,this._scale);drawNotch(cr,this._providers,this._settings.edge,!this._expanded,Date.now()/1000*4.49,this._progress);cr.$dispose();});
        this._notch.connect('enter-event',()=>{this._cancelFold();this._expand();return Clutter.EVENT_PROPAGATE;});
        this._notch.connect('leave-event',()=>{this._foldLater();return Clutter.EVENT_PROPAGATE;});
        this._notch.connect('motion-event',(_actor,event)=>{const [x,y]=event.get_coords();const i=hitTest(this._g,this._settings.edge,(x-this._notch.x)/this._scale,(y-this._notch.y)/this._scale,this._providers.length);this._showCard(i);return Clutter.EVENT_PROPAGATE;});
        this._notch.connect('button-press-event',(_actor,event)=>{if(event.get_button()===3){this._menu.toggle();return Clutter.EVENT_STOP;}return Clutter.EVENT_PROPAGATE;});
        this._notch.connect('key-press-event',(_actor,event)=>{if(event.get_key_symbol()===Clutter.KEY_Return||event.get_key_symbol()===Clutter.KEY_space){this._menu.toggle();return Clutter.EVENT_STOP;}if(event.get_key_symbol()===Clutter.KEY_Escape){this._menu.close();this._showCard(-1);}return Clutter.EVENT_PROPAGATE;});
        Main.layoutManager.addChrome(this._notch,{affectsStruts:false,trackFullscreen:false});
        this._anchor=new St.Button({reactive:true,can_focus:true,track_hover:true,accessible_name:'Codenotch settings'});
        this._anchor.connect('clicked',()=>{this._cancelFold();this._showCard(-1);this._menu.toggle();});
        this._anchor.connect('enter-event',()=>{this._cancelFold();this._showCard(-1);return Clutter.EVENT_PROPAGATE;});
        this._anchor.connect('leave-event',()=>{this._foldLater();return Clutter.EVENT_PROPAGATE;});
        Main.layoutManager.addChrome(this._anchor,{affectsStruts:false,trackFullscreen:false});
        this._card=new St.DrawingArea({reactive:true,track_hover:true});
        this._card.connect('repaint',area=>{const p=this._providers[this._hover];if(!p)return;const cr=area.get_context();cr.scale(this._scale,this._scale);drawCard(cr,p,D.cardWidth,this._cardBudget);cr.$dispose();});
        this._card.connect('enter-event',()=>{this._cancelFold();return Clutter.EVENT_PROPAGATE;});
        this._card.connect('leave-event',()=>{this._foldLater();return Clutter.EVENT_PROPAGATE;});
        Main.layoutManager.addChrome(this._card,{affectsStruts:false,trackFullscreen:false});this._card.hide();
        this._tail=new St.DrawingArea({reactive:false});
        this._tail.connect('repaint',area=>{const cr=area.get_context(),[w,h]=area.get_surface_size(),edge=this._settings.edge;cr.moveTo(edge==='right'?w:edge==='left'?0:w/2,edge==='top'?0:edge==='bottom'?h:h/2);if(edge==='left'||edge==='right'){const x=edge==='right'?0:w;cr.lineTo(x,0);cr.lineTo(x,h);}else{const y=edge==='top'?h:0;cr.lineTo(0,y);cr.lineTo(w,y);}cr.closePath();color(cr,P.black);cr.fill();cr.$dispose();});
        Main.layoutManager.addChrome(this._tail,{affectsStruts:false,trackFullscreen:false});this._tail.hide();
        this._menu=new PopupMenu.PopupMenu(this._anchor,.5,St.Side.TOP);this._menu.actor.add_style_class_name('codenotch-menu');
        Main.uiGroup.add_child(this._menu.actor);this._menu.actor.hide();this._menuManager=new PopupMenu.PopupMenuManager(this);this._menuManager.addMenu(this._menu);
        this._menu.connect('open-state-changed',(_m,open)=>{if(open){this._cancelFold();this._showCard(-1);}else this._foldLater();});
        this._connect(Main.layoutManager,'monitors-changed',()=>this._layout());
        this._connect(global.display,'workareas-changed',()=>this._layout());
        this._connect(global.display,'in-fullscreen-changed',()=>this._layout());
        this._connect(Main.overview,'showing',()=>{this._notch.hide();this._anchor.hide();this._showCard(-1);this._menu.close();});
        this._connect(Main.overview,'hidden',()=>this._layout());
        this._timeout(2000,()=>{if(!this._busy)this._run([]);return true;});
        this._timeout(50,()=>{if(this._expanded&&St.Settings.get().enable_animations&&this._providers.some(p=>p.sessions?.some(s=>s.state!=='idle')))this._notch.queue_repaint();return true;});
        this._layout();this._buildMenu();this._run([]);
    }
    _connect(object,name,callback){this._signals.push([object,object.connect(name,callback)]);}
    _timeout(ms,fn){const id=GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{const again=this._alive&&fn();if(!again)this._sources.delete(id);return again?GLib.SOURCE_CONTINUE:GLib.SOURCE_REMOVE;});this._sources.add(id);return id;}
    _removeTimer(id){if(id&&this._sources.has(id)){GLib.source_remove(id);this._sources.delete(id);}}
    _cancelFold(){this._removeTimer(this._foldTimer);this._foldTimer=null;}
    _foldLater(){this._cancelFold();this._foldTimer=this._timeout(320,()=>{this._foldTimer=null;if(this._menu.isOpen||this._notch.hover||this._anchor.hover||this._card.hover)return false;this._showCard(-1);if(this._settings.visibility!=='always')this._animate(false);return false;});}
    _expand(){if(!this._expanded||this._closing){this._expanded=true;this._layout();this._animate(true);}}
    _animate(open){
        this._removeTimer(this._animation);this._closing=!open;
        const start=this._progress??0,target=open?1:0,at=Date.now();
        const tick=()=>{const t=St.Settings.get().enable_animations?Math.min(1,(Date.now()-at)/240):1;const eased=1-Math.pow(1-t,3);this._progress=start+(target-start)*eased;this._notch.queue_repaint();this._anchor.visible=open&&this._progress>.88&&this._notch.visible;if(t>=1){this._animation=null;this._closing=false;this._expanded=open;this._layout();return false;}return true;};
        this._animation=this._timeout(16,tick);
    }
    _layout(){
        if(!this._alive||!Main.layoutManager.monitors.length)return;
        const monitors=Main.layoutManager.monitors;let index=this._settings.monitor;
        if(index<0||index>=monitors.length)index=Main.layoutManager.primaryIndex;
        this._monitor=monitors[index];this._work=Main.layoutManager.getWorkAreaForMonitor(index);
        const area=this._work;const edge=this._settings.edge;
        if(this._settings.visibility==='always'){this._expanded=true;this._progress=1;}
        this._g=geometry(this._providers.length,edge,!this._expanded);
        // Fit the longest stack to the available display; same ratios at any scale.
        const full=geometry(this._providers.length,edge,false);
        this._scale=Math.min(this._settings.scale??1,(this._g.vertical?area.height:area.width)/full.length);
        const w=this._g.width*this._scale,h=this._g.height*this._scale;
        const x=edge==='right'?area.x+area.width-w:edge==='left'?area.x:area.x+(area.width-w)/2;
        const y=edge==='top'?area.y:edge==='bottom'?area.y+area.height-h:area.y+(area.height-h)/2;
        this._notch.set_position(Math.round(x),Math.round(y));this._notch.set_size(Math.ceil(w),Math.ceil(h));
        const hidden=this._settings.visibility==='hidden'||Main.overview.visible||(this._settings.hideFullscreen&&this._monitor.inFullscreen);
        this._notch.visible=!hidden;this._notch.queue_repaint();
        const [gx,gy]=point(this._g,edge,this._g.gearAlong,this._g.depth/2);
        this._anchor.set_position(x+(gx-20)*this._scale,y+(gy-20)*this._scale);this._anchor.set_size(40*this._scale,40*this._scale);this._anchor.visible=this._expanded&&!hidden;
        this._cardBudget=Math.max(140,(area.height-30)/this._scale);
        if(hidden){this._showCard(-1);this._menu?.close();}else if(this._hover>=0)this._showCard(this._hover,true);
    }
    _showCard(index,force=false){
        if(index<0||!this._expanded||!this._providers[index]){this._hover=-1;this._card?.hide();this._tail?.hide();return;}
        if(this._menu?.isOpen)return;
        if(index===this._hover&&!force)return;this._hover=index;
        const p=this._providers[index],s=this._scale,g=this._g,edge=this._settings.edge,a=this._work;
        const cw=D.cardWidth*s,ch=cardLayout(p,this._cardBudget).height*s;
        const [px,py]=point(g,edge,g.centers[index],g.depth/2);const cx=this._notch.x+px*s,cy=this._notch.y+py*s;
        const gap=(D.tail+D.tailGap)*s;
        let x=edge==='right'?this._notch.x-gap-cw:edge==='left'?this._notch.x+g.depth*s+gap:cx-cw/2;
        let y=edge==='top'?this._notch.y+g.depth*s+gap:edge==='bottom'?this._notch.y-gap-ch:cy-ch/2;
        x=Math.max(a.x+8,Math.min(x,a.x+a.width-cw-8));y=Math.max(a.y+8,Math.min(y,a.y+a.height-ch-8));
        this._card.set_position(Math.round(x),Math.round(y));this._card.set_size(Math.ceil(cw),Math.ceil(ch));this._card.show();this._card.queue_repaint();
        if(g.vertical){const th=Math.min(D.tailHeight*s,ch-2*D.cardCorner*s);this._tail.set_size(D.tail*s,th);this._tail.set_position(edge==='right'?x+cw-.5:x-D.tail*s+.5,Math.max(y+D.cardCorner*s,Math.min(cy-th/2,y+ch-D.cardCorner*s-th)));}
        else{this._tail.set_size(D.tailHeight*s,D.tail*s);this._tail.set_position(Math.max(x+D.cardCorner*s,Math.min(cx-D.tailHeight*s/2,x+cw-D.cardCorner*s-D.tailHeight*s)),edge==='top'?y-D.tail*s+.5:y+ch-.5);}
        this._tail.show();this._tail.queue_repaint();
    }
    _run(args){
        if(!this._alive)return;
        if(this._busy){if(args.length)this._queued.push(args);return;}
        const worker=GLib.file_test('/usr/lib/codenotch/codenotch-worker',GLib.FileTest.EXISTS)?'/usr/lib/codenotch/codenotch-worker':`${this.path}/../backend/codenotch-worker`;
        let process;try{process=Gio.Subprocess.new([worker,'--snapshot',...args],Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_SILENCE);}catch(e){this._showError('Usage worker could not start. Reinstall the .deb package.');return;}
        this._busy=true;this._jobs.add(process);const cancel=new Gio.Cancellable();this._cancel=cancel;
        const watchdog=this._timeout(55000,()=>{process.force_exit();return false;});
        process.communicate_utf8_async(null,cancel,(proc,result)=>{
            this._jobs.delete(proc);this._removeTimer(watchdog);if(!this._alive)return;
            this._busy=false;
            try{const [ok,stdout]=proc.communicate_utf8_finish(result);if(!ok||!proc.get_successful())throw Error();const data=JSON.parse(stdout);if(data.error)throw Error();this._accept(data);}catch(e){if(!cancel.is_cancelled())this._showError('Could not read usage. Try Verify all connections.');}
            if(this._queued.length)this._run(this._queued.shift());
        });
    }
    _showError(message){if(this._statusItem)this._statusItem.label.text=message;}
    _accept(data){
        const oldSettings=JSON.stringify(this._settings),oldIDs=this._snapshot?.providers?.map(p=>p.id).join('|');this._snapshot=data;this._settings=data.settings;
        this._providers=data.providers.filter(p=>p.enabled&&(p.detected||p.windows?.length));
        const newIDs=data.providers.map(p=>p.id).join('|');
        if(oldIDs!==newIDs)this._buildMenu();else this._updateMenu();
        if(oldSettings!==JSON.stringify(this._settings))this._syncPanel();
        this._layout();
    }
    _info(menu,label){const item=new PopupMenu.PopupMenuItem(label,{reactive:false,can_focus:false});item.label.clutter_text.line_wrap=true;item.label.clutter_text.ellipsize=0;item.label.set_style('max-width: 390px; font-size: 11px; color: #a8a8a8;');menu.addMenuItem(item);return item;}
    _buildMenu(){
        this._menu.removeAll();this._menuRows.clear();
        const title=this._info(this._menu,'CODENOTCH  ·  AI CONNECTIONS');title.label.set_style('font-weight: bold; font-size: 12px;');
        this._statusItem=this._info(this._menu,'Choose AIs, verify connections, and inspect their usage.');
        for(const p of this._snapshot?.providers??[]){
            const sub=new PopupMenu.PopupSubMenuMenuItem(p.name);this._menu.addMenuItem(sub);
            const toggle=new PopupMenu.PopupSwitchMenuItem('Show in notch',p.enabled);sub.menu.addMenuItem(toggle);
            toggle.connect('toggled',(_item,state)=>{if(this._syncing)return;this._run([state?'--enable':'--disable',p.id]);});
            const status=this._info(sub.menu,'');const source=this._info(sub.menu,p.source??'');const checked=this._info(sub.menu,'');const usage=this._info(sub.menu,'');
            const verify=new PopupMenu.PopupMenuItem('Verify connection');sub.menu.addMenuItem(verify);
            verify.connect('activate',()=>{status.label.text='Verifying…';this._run(['--verify',p.id]);});
            this._menuRows.set(p.id,{sub,toggle,status,source,checked,usage,verify});
        }
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const verifyAll=new PopupMenu.PopupMenuItem('Verify all enabled connections');verifyAll.connect('activate',()=>{this._statusItem.label.text='Verifying enabled connections…';this._run(['--verify','all']);});this._menu.addMenuItem(verifyAll);
        const prefs=new PopupMenu.PopupMenuItem('Appearance and more settings…');prefs.connect('activate',()=>this.openPreferences());this._menu.addMenuItem(prefs);
        this._updateMenu();this._syncPanel();
    }
    _updateMenu(){
        if(!this._snapshot)return;
        this._syncing=true;
        for(const p of this._snapshot.providers){const row=this._menuRows.get(p.id);if(!row)continue;
            row.toggle.setToggleState(p.enabled);row.sub.label.text=`${p.name}  ·  ${p.status==='ok'?'Connected':p.status==='demo'?'Demo':p.status==='disabled'?'Off':p.status==='needsAuth'?'Sign-in needed':p.status}`;
            row.status.label.text=p.message??'Not checked yet.';row.source.label.text=`Source: ${p.source}`;
            row.checked.label.text=p.updatedAt?`Last success: ${new Date(p.updatedAt*1000).toLocaleString()}`:'No successful live reading yet.';
            row.usage.label.text=(p.windows??[]).map(w=>`${w.label}: ${Math.round(w.fraction*100)}% used`).join('\n')||'No usage reported.';
            row.verify.setSensitive(p.enabled);
        }
        this._syncing=false;
        this._statusItem.label.text=this._settings.demo?'DEMO — sample readings; connections have not been verified.':'Switching an AI off stops its credential reads and forgets cached usage.';
    }
    _syncPanel(){
        if(this._settings.panelIcon&&!this._panel){
            this._panel=new PanelMenu.Button(0,'Codenotch');this._panel.add_child(new St.Icon({icon_name:'utilities-system-monitor-symbolic',style_class:'system-status-icon'}));
            Main.panel.addToStatusArea(this.uuid,this._panel);
            for(const [label,fn] of [['AI connections and settings',()=>{this._expanded=true;this._progress=1;this._settings.visibility=this._settings.visibility==='hidden'?'hover':this._settings.visibility;this._layout();this._menu.open();}],['Refresh now',()=>this._run(['--verify','all'])],['Appearance…',()=>this.openPreferences()]]){const item=new PopupMenu.PopupMenuItem(label);item.connect('activate',fn);this._panel.menu.addMenuItem(item);}
        }else if(!this._settings.panelIcon&&this._panel){this._panel.destroy();this._panel=null;}
    }
    disable(){
        this._alive=false;this._cancel?.cancel();for(const proc of this._jobs??[])proc.force_exit();this._jobs?.clear();
        for(const id of this._sources??[])GLib.source_remove(id);this._sources?.clear();for(const [object,id] of this._signals??[])object.disconnect(id);this._signals=[];
        this._menuManager?.removeMenu(this._menu);this._menu?.destroy();this._panel?.destroy();this._panel=null;
        for(const actor of [this._notch,this._anchor,this._card,this._tail])if(actor){Main.layoutManager.removeChrome(actor);actor.destroy();}
        this._notch=this._anchor=this._card=this._tail=null;this._menu=null;this._snapshot=null;this._queued=[];
    }
}
