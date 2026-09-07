import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import {D,P,W,plan,point,drawNotch,drawCard,cardLayout,drawWidgetCard,widgetCard,widgetCardLayout,
        hitTest,color,setTextEngine,spring,settled,clamp} from './render.js';

const DEFAULTS={edge:'right',visibility:'hover',scale:1,monitor:-1,panelIcon:true,hideFullscreen:true,
    peek:true,widgets:[],clock24:true,clockSeconds:false,dateStyle:'medium',textContrast:'high',demo:false};

// Pango gives real hinting and metrics; cairo's toy text API does not.
function pangoLayout(cr,value,size,weight,opts={}) {
    const layout=PangoCairo.create_layout(cr);
    const description=Pango.FontDescription.from_string('Sans');
    description.set_absolute_size(size*Pango.SCALE);
    description.set_weight(weight??W.regular);
    layout.set_font_description(description);
    if(opts.tracking){const list=Pango.AttrList.new();list.insert(Pango.attr_letter_spacing_new(Math.round(opts.tracking*Pango.SCALE)));layout.set_attributes(list);}
    layout.set_text(value,-1);
    return layout;
}
function pangoEngine(cr,value,x,y,size,hex,align,weight,opts) {
    const layout=pangoLayout(cr,value,size,weight,opts);
    const [width]=layout.get_pixel_size();
    cr.moveTo(x-(align==='center'?width/2:align==='right'?width:0),y-layout.get_baseline()/Pango.SCALE);
    color(cr,hex,opts.alpha??1);
    PangoCairo.show_layout(cr,layout);
}
function pangoMeasure(cr,value,size,weight) {
    return pangoLayout(cr,value,size,weight).get_pixel_size()[0];
}

export default class Codenotch extends Extension {
    enable() {
        this._alive=true;this._sources=new Set();this._signals=[];this._jobs=new Set();this._queued=[];
        this._snapshot=null;this._providers=[];this._widgets=[];this._widgetData={};
        this._expanded=false;this._progress=0;this._velocity=0;this._target=0;this._hover=null;this._menuRows=new Map();
        // Safe defaults so a repaint before the first layout cannot throw.
        this._scale=1;this._folded=true;this._cardBudget=400;
        this._settings={...DEFAULTS};
        setTextEngine(pangoEngine,pangoMeasure);

        this._notch=new St.DrawingArea({reactive:false,can_focus:true,track_hover:true,
            accessible_name:'Codenotch — AI usage and widgets. Press Enter for settings.'});
        this._notch.connect('repaint',area=>this._paintNotch(area));
        this._notch.connect('enter-event',()=>{this._cancelFold();this._expand();return Clutter.EVENT_PROPAGATE;});
        this._notch.connect('leave-event',()=>{this._foldLater();return Clutter.EVENT_PROPAGATE;});
        this._notch.connect('motion-event',(_actor,event)=>this._onMotion(event));
        this._notch.connect('button-press-event',(_actor,event)=>this._onPress(event));
        this._notch.connect('key-press-event',(_actor,event)=>this._onKey(event));
        Main.layoutManager.addChrome(this._notch,{affectsStruts:false,trackFullscreen:false});

        // A slim always-reactive trigger over the resting sliver. Hover lives
        // here so the drawing area never needs to be reactive while it is folded.
        this._hotspot=new St.Widget({reactive:true,track_hover:true});
        this._hotspot.connect('enter-event',()=>{this._cancelFold();this._expand();return Clutter.EVENT_PROPAGATE;});
        this._hotspot.connect('leave-event',()=>{this._foldLater();return Clutter.EVENT_PROPAGATE;});
        Main.layoutManager.addChrome(this._hotspot,{affectsStruts:false,trackFullscreen:false});

        this._anchor=new St.Button({reactive:true,can_focus:true,track_hover:true,accessible_name:'Codenotch settings'});
        this._anchor.connect('clicked',()=>{this._cancelFold();this._showCard(null);this._menu.toggle();});
        this._anchor.connect('enter-event',()=>{this._cancelFold();this._showCard(null);return Clutter.EVENT_PROPAGATE;});
        this._anchor.connect('leave-event',()=>{this._foldLater();return Clutter.EVENT_PROPAGATE;});
        Main.layoutManager.addChrome(this._anchor,{affectsStruts:false,trackFullscreen:false});

        this._card=new St.DrawingArea({reactive:true,track_hover:true});
        this._card.connect('repaint',area=>this._paintCard(area));
        this._card.connect('enter-event',()=>{this._cancelFold();return Clutter.EVENT_PROPAGATE;});
        this._card.connect('leave-event',()=>{this._foldLater();return Clutter.EVENT_PROPAGATE;});
        Main.layoutManager.addChrome(this._card,{affectsStruts:false,trackFullscreen:false});this._card.hide();

        this._tail=new St.DrawingArea({reactive:false});
        this._tail.connect('repaint',area=>this._paintTail(area));
        Main.layoutManager.addChrome(this._tail,{affectsStruts:false,trackFullscreen:false});this._tail.hide();

        this._menu=new PopupMenu.PopupMenu(this._anchor,.5,St.Side.TOP);this._menu.actor.add_style_class_name('codenotch-menu');
        Main.uiGroup.add_child(this._menu.actor);this._menu.actor.hide();
        this._menuManager=new PopupMenu.PopupMenuManager(this);this._menuManager.addMenu(this._menu);
        this._menu.connect('open-state-changed',(_m,open)=>{
            if(open){this._cancelFold();this._showCard(null);}
            else{this._foldLater();if(this._rebuildPending){this._rebuildPending=false;this._buildMenu();}}
        });

        this._connect(Main.layoutManager,'monitors-changed',()=>this._queueLayout());
        this._connect(global.display,'workareas-changed',()=>this._queueLayout());
        this._connect(global.display,'in-fullscreen-changed',()=>this._queueLayout());
        this._connect(Main.overview,'showing',()=>{this._closeAll();this._queueLayout();});
        this._connect(Main.overview,'hidden',()=>this._queueLayout());
        this._connect(St.Settings.get(),'notify::enable-animations',()=>this._queueLayout());

        // Safety net: an actor left open over the edge is what makes a desktop
        // feel stuck, so verify the real pointer position once a second.
        this._timeout(1000,()=>{this._guard();return true;});
        this._layout();this._buildMenu();this._scheduleClock();this._run([]);this._schedulePoll();
    }

    // ------------------------------------------------------------- plumbing
    _connect(object,name,callback){this._signals.push([object,object.connect(name,callback)]);}
    _timeout(ms,fn){
        const id=GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{
            let again=false;
            // A throw inside a GSource callback would otherwise leave a stale id
            // in _sources and a G_CRITICAL when disable() removes it.
            try{again=this._alive&&fn();}catch(e){logError(e,'codenotch timer');again=false;}
            if(!again)this._sources.delete(id);
            return again?GLib.SOURCE_CONTINUE:GLib.SOURCE_REMOVE;
        });
        this._sources.add(id);return id;
    }
    _removeTimer(id){if(id&&this._sources.has(id)){GLib.source_remove(id);this._sources.delete(id);}}
    /** Everything the notch draws, as one comparable string. */
    _digest() {
        const rings=this._providers.map(p=>`${p.id}:${p.status}:${p.windows?.[0]?.fraction??''}:${(p.sessions??[]).map(s=>s.state).join('')}`).join('|');
        const cells=this._widgets.map(k=>`${k}:${JSON.stringify(this._widgetData[k]??null)}`).join('|');
        const look=[this._settings.edge,this._settings.scale,this._settings.textContrast,
            this._settings.clock24,this._settings.clockSeconds,this._settings.dateStyle,this._settings.peek].join(',');
        return `${rings}#${cells}#${look}`;
    }
    // A poll that changes nothing should cost nothing: no repaint, no cairo.
    _invalidate(force=false) {
        const digest=this._digest();
        if(!force&&digest===this._drawn)return;
        this._drawn=digest;this._notch?.queue_repaint();
    }
    _openPreferences() {
        // openPreferences() is async; an unhandled rejection ends up in the journal.
        try{this.openPreferences()?.catch?.(e=>logError(e,'codenotch preferences'));}
        catch(e){logError(e,'codenotch preferences');}
    }
    _queueLayout(){
        if(!this._alive||this._layoutTimer)return;
        this._layoutTimer=this._timeout(30,()=>{this._layoutTimer=null;this._layout();return false;});
    }
    _closeAll(){this._showCard(null);this._menu?.close(BoxPointer.PopupAnimation.NONE);}

    // ------------------------------------------------------------- painting
    _paintNotch(area) {
        const cr=area.get_context();
        try{
            cr.scale(this._scale,this._scale);
            drawNotch(cr,{providers:this._providers,widgets:this._widgets,data:this._widgetData,
                settings:this._settings,edge:this._settings.edge,folded:this._folded,
                phase:Date.now()/1000*4.49,progress:this._folded?1:this._progress,now:new Date()});
        }catch(e){logError(e,'codenotch notch');}
        cr.$dispose();
    }
    _paintCard(area) {
        const cr=area.get_context();
        try{
            cr.scale(this._scale,this._scale);
            const target=this._hover;
            if(target?.kind==='provider')drawCard(cr,this._providers[target.index],D.cardWidth,this._cardBudget,this._settings);
            else if(target?.kind==='widget')drawWidgetCard(cr,widgetCard(target.ref,this._widgetData[target.ref],this._settings),D.cardWidth,this._settings);
        }catch(e){logError(e,'codenotch card');}
        cr.$dispose();
    }
    _paintTail(area) {
        const cr=area.get_context(),[w,h]=area.get_surface_size(),edge=this._settings.edge;
        cr.moveTo(edge==='right'?w:edge==='left'?0:w/2,edge==='top'?0:edge==='bottom'?h:h/2);
        if(edge==='left'||edge==='right'){const x=edge==='right'?0:w;cr.lineTo(x,0);cr.lineTo(x,h);}
        else{const y=edge==='top'?h:0;cr.lineTo(0,y);cr.lineTo(w,y);}
        cr.closePath();color(cr,P.shell);cr.fill();cr.$dispose();
    }

    // -------------------------------------------------------------- gestures
    _onMotion(event) {
        if(this._progress<.9)return Clutter.EVENT_PROPAGATE;
        const [x,y]=event.get_coords();
        const hit=hitTest(this._g,this._settings.edge,(x-this._notch.x)/this._scale,(y-this._notch.y)/this._scale);
        this._showCard(hit&&hit.kind!=='gear'?hit:null);
        return Clutter.EVENT_PROPAGATE;
    }
    _onPress(event) {
        if(event.get_button()===3){this._menu.toggle();return Clutter.EVENT_STOP;}
        const [x,y]=event.get_coords();
        const hit=hitTest(this._g,this._settings.edge,(x-this._notch.x)/this._scale,(y-this._notch.y)/this._scale);
        if(hit?.kind==='gear'){this._menu.toggle();return Clutter.EVENT_STOP;}
        if(hit?.kind==='widget'){this._run(['--widgets']);return Clutter.EVENT_STOP;}
        return Clutter.EVENT_PROPAGATE;
    }
    _onKey(event) {
        const key=event.get_key_symbol();
        if(key===Clutter.KEY_Return||key===Clutter.KEY_space){this._menu.toggle();return Clutter.EVENT_STOP;}
        if(key===Clutter.KEY_Escape){this._closeAll();}
        return Clutter.EVENT_PROPAGATE;
    }
    _cancelFold(){this._removeTimer(this._foldTimer);this._foldTimer=null;}
    /** Leaving always dismisses the card. Folding the notch is the part that
     *  "Always show" opts out of — the two were wrongly tied together. */
    _foldLater() {
        if(!this._alive)return;
        this._cancelFold();
        this._foldTimer=this._timeout(280,()=>{
            this._foldTimer=null;
            if(this._stillWanted())return false;
            this._showCard(null);
            if(this._settings.visibility!=='always')this._animate(false);
            return false;
        });
    }
    _stillWanted() {
        if(this._menu?.isOpen)return true;
        return this._notch?.hover||this._anchor?.hover||this._card?.hover||this._hotspot?.hover||this._pointerInside();
    }
    /** The tail counts: it bridges the gap between the notch and its card, so
     *  crossing that gap must not read as "the pointer left". */
    _pointerInside(margin=6) {
        const [px,py]=global.get_pointer();
        const inside=actor=>actor?.visible&&px>=actor.x-margin&&px<=actor.x+actor.width+margin&&py>=actor.y-margin&&py<=actor.y+actor.height+margin;
        return inside(this._notch)||inside(this._card)||inside(this._tail)||inside(this._anchor)||inside(this._hotspot);
    }
    /** Dismiss anything left open when the pointer is demonstrably elsewhere.
     *  Runs in every visibility mode: a stranded card is the failure this
     *  catches, and "Always show" is the mode most likely to strand one. */
    _guard() {
        if(!this._alive||!this._notch)return;
        if(!this._card?.visible&&this._progress<=.01)return;
        if(this._menu?.isOpen||this._foldTimer||this._pointerInside())return;
        this._showCard(null);
        if(this._settings.visibility!=='always'&&this._target!==0)this._animate(false);
    }

    // ------------------------------------------------------------- animation
    _expand() {
        if(this._target!==1){this._target=1;this._expanded=true;this._layout();this._animate(true);}
        // Folded means slow polling, so top up on the way open rather than
        // keeping the worker warm for a notch nobody is looking at.
        if(!this._busy&&Date.now()/1000-(this._snapshot?.generatedAt??0)>5){this._run([]);this._schedulePoll();}
    }
    /** The notch rests as a sliver only when it is closed and settled. */
    _shouldFold(){return this._settings.visibility!=='always'&&this._target!==1&&this._progress<.005;}
    _animate(open) {
        if(!this._alive)return;
        this._target=open?1:0;
        if(open)this._expanded=true;
        if(!St.Settings.get().enable_animations){
            this._progress=this._target;this._velocity=0;this._finishAnimation();return;
        }
        if(this._animation)return;
        this._last=GLib.get_monotonic_time();
        this._animation=this._timeout(16,()=>this._step());
    }
    _step() {
        const now=GLib.get_monotonic_time();
        const dt=Math.min(.05,(now-this._last)/1e6);this._last=now;
        // Opening springs with a hint of overshoot; closing is a firmer damp so
        // the notch never lingers over the edge.
        const [value,velocity]=this._target
            ? spring(this._progress,this._velocity,1,dt,210,25)
            : spring(this._progress,this._velocity,0,dt,240,32);
        this._progress=clamp(value,0,1.04);this._velocity=velocity;
        if(this._shouldFold()!==this._folded)this._layout();
        this._syncChrome();
        this._notch.queue_repaint();
        if(settled(this._progress,this._velocity,this._target)){
            this._progress=this._target;this._velocity=0;this._animation=null;this._finishAnimation();return false;
        }
        return true;
    }
    _finishAnimation() {
        this._removeTimer(this._animation);this._animation=null;
        this._expanded=this._target===1;
        this._layout();this._invalidate(true);
    }
    /** Reactivity and the gear button follow the drawing, never the intent. */
    _syncChrome() {
        const open=this._progress>.9&&this._notch.visible;
        this._notch.reactive=open;
        this._anchor.visible=open;
        this._hotspot.visible=!open&&this._notch.visible&&this._settings.visibility!=='hidden';
        this._schedulePulse();
    }
    _pulsing() {
        return this._progress>.9&&!!this._notch?.visible&&St.Settings.get().enable_animations
            &&this._providers.some(p=>p.sessions?.some(s=>s.state!=='idle'));
    }
    /** 8 fps, and only while an AI session is busy or waiting. Otherwise the
     *  notch is completely still and costs nothing between polls. */
    _schedulePulse() {
        const wanted=this._pulsing();
        if(wanted&&!this._pulseTimer){
            this._pulseTimer=this._timeout(125,()=>{
                if(!this._pulsing()){this._pulseTimer=null;return false;}
                this._notch.queue_repaint();return true;
            });
        }else if(!wanted&&this._pulseTimer){this._removeTimer(this._pulseTimer);this._pulseTimer=null;}
    }

    // ---------------------------------------------------------------- layout
    _layout() {
        if(!this._alive||!this._notch||!Main.layoutManager.monitors.length)return;
        const monitors=Main.layoutManager.monitors;let index=this._settings.monitor;
        if(index<0||index>=monitors.length)index=Main.layoutManager.primaryIndex;
        this._monitor=monitors[index];this._work=Main.layoutManager.getWorkAreaForMonitor(index);
        const area=this._work,edge=this._settings.edge;
        if(this._settings.visibility==='always'){this._expanded=true;this._target=1;this._progress=1;this._velocity=0;}
        this._folded=this._shouldFold();

        this._g=plan(this._providers,this._widgets,edge,false);
        this._pill=plan([],[],edge,true);
        this._scale=Math.min(this._settings.scale??1,(this._g.vertical?area.height:area.width)/this._g.length);
        const geometry=this._folded?this._pill:this._g;
        const w=geometry.width*this._scale,h=geometry.height*this._scale;
        const x=edge==='right'?area.x+area.width-w:edge==='left'?area.x:area.x+(area.width-w)/2;
        const y=edge==='top'?area.y:edge==='bottom'?area.y+area.height-h:area.y+(area.height-h)/2;
        this._notch.set_position(Math.round(x),Math.round(y));this._notch.set_size(Math.ceil(w),Math.ceil(h));

        const hidden=this._settings.visibility==='hidden'||Main.overview.visible||(this._settings.hideFullscreen&&this._monitor.inFullscreen);
        this._notch.visible=!hidden;

        // The trigger strip: the sliver plus a little slack, so it is easy to hit
        // yet far too small to swallow a desktop click.
        const pw=this._pill.width*this._scale,ph=this._pill.height*this._scale;
        const grow=4;
        const hx=edge==='right'?area.x+area.width-pw-grow:edge==='left'?area.x:area.x+(area.width-pw)/2;
        const hy=edge==='top'?area.y:edge==='bottom'?area.y+area.height-ph-grow:area.y+(area.height-ph)/2;
        this._hotspot.set_position(Math.round(hx),Math.round(hy));
        this._hotspot.set_size(Math.ceil(pw+(this._g.vertical?grow:0)),Math.ceil(ph+(this._g.vertical?0:grow)));

        const [gx,gy]=point(this._g,edge,this._g.gearAlong,this._g.depth/2);
        const cell=D.gearCell*this._scale;
        this._anchor.set_position(Math.round(x+gx*this._scale-cell/2),Math.round(y+gy*this._scale-cell/2));
        this._anchor.set_size(Math.ceil(cell),Math.ceil(cell));

        this._cardBudget=Math.max(160,(area.height-30)/this._scale);
        this._syncChrome();
        const box=`${this._notch.x},${this._notch.y},${this._notch.width},${this._notch.height},${this._folded}`;
        const moved=box!==this._box;this._box=box;
        this._invalidate(moved);
        if(hidden){this._closeAll();}
        else if(this._hover)this._showCard(this._hover,true);
    }

    // ------------------------------------------------------------------ card
    _showCard(hit,force=false) {
        if(!this._alive||!this._card)return;
        if(!hit||this._progress<.9||this._menu?.isOpen){
            if(this._hover){this._hover=null;this._card?.hide();this._tail?.hide();}
            return;
        }
        if(hit.kind==='provider'&&!this._providers[hit.index]){this._showCard(null);return;}
        if(!force&&this._hover&&this._hover.kind===hit.kind&&this._hover.index===hit.index)return;
        const appearing=!this._card.visible;
        this._hover=hit;
        const s=this._scale,g=this._g,edge=this._settings.edge,a=this._work;
        const height=hit.kind==='provider'
            ? cardLayout(this._providers[hit.index],this._cardBudget).height
            : widgetCardLayout(widgetCard(hit.ref,this._widgetData[hit.ref],this._settings)).height;
        const cw=D.cardWidth*s,ch=height*s;
        const [px,py]=point(g,edge,g.cells[hit.index].center,g.depth/2);
        const cx=this._notch.x+px*s,cy=this._notch.y+py*s;
        const gap=(D.tail+D.tailGap)*s;
        let x=edge==='right'?this._notch.x-gap-cw:edge==='left'?this._notch.x+g.depth*s+gap:cx-cw/2;
        let y=edge==='top'?this._notch.y+g.depth*s+gap:edge==='bottom'?this._notch.y-gap-ch:cy-ch/2;
        x=Math.max(a.x+8,Math.min(x,a.x+a.width-cw-8));y=Math.max(a.y+8,Math.min(y,a.y+a.height-ch-8));
        this._card.set_position(Math.round(x),Math.round(y));this._card.set_size(Math.ceil(cw),Math.ceil(ch));
        this._card.show();this._card.queue_repaint();
        if(appearing&&St.Settings.get().enable_animations){
            this._card.set_pivot_point(edge==='right'?1:edge==='left'?0:.5,edge==='bottom'?1:edge==='top'?0:.5);
            this._card.set_scale(.93,.93);this._card.opacity=0;
            this._card.ease({scale_x:1,scale_y:1,opacity:255,duration:220,mode:Clutter.AnimationMode.EASE_OUT_BACK});
        }else{this._card.set_scale(1,1);this._card.opacity=255;}
        if(g.vertical){
            const th=Math.min(D.tailHeight*s,ch-2*D.cardCorner*s);
            this._tail.set_size(Math.max(1,Math.ceil(D.tail*s)),Math.max(1,Math.ceil(th)));
            this._tail.set_position(Math.round(edge==='right'?x+cw-.5:x-D.tail*s+.5),Math.round(Math.max(y+D.cardCorner*s,Math.min(cy-th/2,y+ch-D.cardCorner*s-th))));
        }else{
            this._tail.set_size(Math.max(1,Math.ceil(D.tailHeight*s)),Math.max(1,Math.ceil(D.tail*s)));
            this._tail.set_position(Math.round(Math.max(x+D.cardCorner*s,Math.min(cx-D.tailHeight*s/2,x+cw-D.cardCorner*s-D.tailHeight*s))),Math.round(edge==='top'?y-D.tail*s+.5:y+ch-.5));
        }
        this._tail.show();this._tail.queue_repaint();
    }

    // --------------------------------------------------------------- worker
    _workerPath(){
        return GLib.file_test('/usr/lib/codenotch/codenotch-worker',GLib.FileTest.EXISTS)
            ? '/usr/lib/codenotch/codenotch-worker' : `${this.path}/../backend/codenotch-worker`;
    }
    _run(args) {
        if(!this._alive)return;
        if(this._busy){if(args.length)this._queued.push(args);return;}
        let process;
        try{process=Gio.Subprocess.new([this._workerPath(),'--snapshot',...args],Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_SILENCE);}
        catch(e){this._showError('Usage worker could not start. Reinstall the .deb package.');return;}
        this._busy=true;this._jobs.add(process);const cancel=new Gio.Cancellable();this._cancel=cancel;
        const watchdog=this._timeout(45000,()=>{process.force_exit();return false;});
        process.communicate_utf8_async(null,cancel,(proc,result)=>{
            this._jobs.delete(proc);this._removeTimer(watchdog);
            this._busy=false;
            if(!this._alive)return;
            try{
                const [ok,stdout]=proc.communicate_utf8_finish(result);
                if(!ok||!proc.get_successful())throw Error('worker exited');
                const data=JSON.parse(stdout);
                if(data.error)throw Error(data.error);
                this._accept(data);
            }catch(e){if(!cancel.is_cancelled())this._showError('Could not read usage. Try Verify all connections.');}
            if(this._queued.length)this._run(this._queued.shift());
        });
    }
    _schedulePoll() {
        this._removeTimer(this._pollTimer);
        this._pollTimer=this._timeout(this._pollDelay(),()=>{
            this._pollTimer=null;
            if(!this._busy)this._run([]);
            this._schedulePoll();return false;
        });
    }
    /** Local scan cadence. Provider HTTP is throttled separately by the worker,
     *  so this only decides how often the ~15 ms worker process runs. */
    _pollDelay() {
        if(!this._notch?.visible||Main.overview.visible)return 120000;
        if(this._providers.some(p=>p.sessions?.some(s=>s.state!=='idle')))return 6000;
        if(this._progress>.9)return 15000;
        return 30000;   // folded: nothing on screen changes until it is opened
    }
    _showError(message){if(this._statusItem)this._statusItem.label.text=message;}
    _accept(data) {
        const before=JSON.stringify(this._settings);
        const oldIDs=this._snapshot?.providers?.map(p=>p.id).join('|');
        this._snapshot=data;this._settings={...DEFAULTS,...data.settings};
        this._providers=data.providers.filter(p=>p.enabled&&(p.detected||p.windows?.length));
        this._widgets=(this._settings.widgets??[]).filter(k=>k!=='battery'||data.widgets?.battery);
        this._widgetData=data.widgets??{};
        const newIDs=data.providers.map(p=>p.id).join('|');
        if(oldIDs!==newIDs){
            // Rebuilding an open menu tears the actor out from under its grab.
            if(this._menu?.isOpen)this._rebuildPending=true;else this._buildMenu();
        }else this._updateMenu();
        if(before!==JSON.stringify(this._settings)){this._syncPanel();this._scheduleClock();}
        this._layout();this._schedulePulse();
    }
    _scheduleClock() {
        this._removeTimer(this._clockTimer);this._clockTimer=null;
        if(!this._widgets.includes('clock')&&!this._widgets.includes('date'))return;
        const period=this._settings.clockSeconds?1000:60000;
        const delay=period-(Date.now()%period)+25;
        this._clockTimer=this._timeout(delay,()=>{
            this._clockTimer=null;
            if(this._progress>.9&&this._notch?.visible)this._notch.queue_repaint();
            this._scheduleClock();return false;
        });
    }

    // ----------------------------------------------------------------- menu
    _info(menu,label) {
        const item=new PopupMenu.PopupMenuItem(label,{reactive:false,can_focus:false});
        item.label.clutter_text.line_wrap=true;item.label.clutter_text.ellipsize=0;
        item.label.set_style('max-width: 390px; font-size: 12px; color: #c8ccd0;');
        menu.addMenuItem(item);return item;
    }
    _buildMenu() {
        if(!this._menu)return;
        if(this._menu.isOpen){this._rebuildPending=true;return;}
        this._menu.removeAll();this._menuRows.clear();
        const title=this._info(this._menu,'CODENOTCH  ·  AI CONNECTIONS');
        title.label.set_style('font-weight: bold; font-size: 13px; color: #ffffff;');
        this._statusItem=this._info(this._menu,'Choose AIs, verify connections, and inspect their usage.');
        for(const p of this._snapshot?.providers??[]){
            const sub=new PopupMenu.PopupSubMenuMenuItem(p.name);this._menu.addMenuItem(sub);
            const toggle=new PopupMenu.PopupSwitchMenuItem('Show in notch',p.enabled);sub.menu.addMenuItem(toggle);
            toggle.connect('toggled',(_item,state)=>{if(this._syncing)return;this._run([state?'--enable':'--disable',p.id]);});
            const status=this._info(sub.menu,'');const source=this._info(sub.menu,p.source??'');
            const checked=this._info(sub.menu,'');const usage=this._info(sub.menu,'');
            const verify=new PopupMenu.PopupMenuItem('Verify connection');sub.menu.addMenuItem(verify);
            verify.connect('activate',()=>{status.label.text='Verifying…';this._run(['--verify',p.id]);});
            this._menuRows.set(p.id,{sub,toggle,status,source,checked,usage,verify});
        }
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const verifyAll=new PopupMenu.PopupMenuItem('Verify all enabled connections');
        verifyAll.connect('activate',()=>{this._statusItem.label.text='Verifying enabled connections…';this._run(['--verify','all']);});
        this._menu.addMenuItem(verifyAll);
        const prefs=new PopupMenu.PopupMenuItem('Widgets, appearance and more…');
        prefs.connect('activate',()=>this._openPreferences());this._menu.addMenuItem(prefs);
        this._updateMenu();this._syncPanel();
    }
    _updateMenu() {
        if(!this._snapshot||!this._statusItem)return;
        this._syncing=true;
        for(const p of this._snapshot.providers){
            const row=this._menuRows.get(p.id);if(!row)continue;
            row.toggle.setToggleState(p.enabled);
            row.sub.label.text=`${p.name}  ·  ${this._statusLabel(p)}`;
            row.status.label.text=p.message??'Not checked yet.';
            row.source.label.text=`Source: ${p.source}`;
            row.checked.label.text=p.updatedAt?`Last success: ${new Date(p.updatedAt*1000).toLocaleString()}`:'No successful live reading yet.';
            row.usage.label.text=(p.windows??[]).map(w=>`${w.label}: ${Math.round(w.fraction*100)}% used`).join('\n')||'No usage reported.';
            row.verify.setSensitive(p.enabled);
        }
        this._syncing=false;
        this._statusItem.label.text=this._settings.demo
            ? 'DEMO — sample readings; connections have not been verified.'
            : 'Switching an AI off stops its credential reads and forgets cached usage.';
    }
    _statusLabel(p) {
        return {ok:'Connected',demo:'Demo',disabled:'Off',needsAuth:'Sign-in needed',expired:'Sign-in expired',
            unavailable:'No allowance published',rateLimited:'Rate limited',offline:'Offline',stale:'Last known'}[p.status]??p.status;
    }
    _syncPanel() {
        if(this._settings.panelIcon&&!this._panel){
            this._panel=new PanelMenu.Button(0,'Codenotch');
            this._panel.add_child(new St.Icon({icon_name:'utilities-system-monitor-symbolic',style_class:'system-status-icon'}));
            Main.panel.addToStatusArea(this.uuid,this._panel);
            const entries=[
                ['AI connections and settings',()=>{
                    // Reveal a hidden notch for real, not just for this session.
                    if(this._settings.visibility==='hidden')this._run(['--set','visibility',JSON.stringify('hover')]);
                    this._settings.visibility='always'===this._settings.visibility?'always':'hover';
                    this._layout();this._expand();this._menu.open();
                }],
                ['Refresh now',()=>this._run(['--verify','all'])],
                ['Widgets and appearance…',()=>this._openPreferences()],
            ];
            for(const [label,fn] of entries){
                const item=new PopupMenu.PopupMenuItem(label);item.connect('activate',fn);this._panel.menu.addMenuItem(item);
            }
        }else if(!this._settings.panelIcon&&this._panel){this._panel.destroy();this._panel=null;}
    }

    disable() {
        this._alive=false;
        this._cancel?.cancel();for(const proc of this._jobs??[])proc.force_exit();this._jobs?.clear();
        for(const id of this._sources??[])GLib.source_remove(id);this._sources?.clear();
        for(const [object,id] of this._signals??[])object.disconnect(id);this._signals=[];
        // Close before destroy: a live popup grab outlives its actor and would
        // leave the session unable to click anything.
        this._menu?.close(BoxPointer.PopupAnimation.NONE);
        this._panel?.menu?.close(BoxPointer.PopupAnimation.NONE);
        this._menuManager?.removeMenu(this._menu);this._menu?.destroy();
        this._panel?.destroy();this._panel=null;
        for(const actor of [this._notch,this._hotspot,this._anchor,this._card,this._tail])
            if(actor){actor.remove_all_transitions?.();Main.layoutManager.removeChrome(actor);actor.destroy();}
        this._notch=this._hotspot=this._anchor=this._card=this._tail=null;
        this._menu=null;this._snapshot=null;this._queued=[];this._menuRows?.clear();
        setTextEngine(null);
    }
}
