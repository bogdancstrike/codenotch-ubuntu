import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import {GLYPHS} from './glyphs.js';

// Sidebar navigation in place of the stock top view switcher: sections
// (Panel, Accounts, Application), a search field that also matches rows
// inside pages, and one content stack. Pages stay ordinary PreferencesPages.
export class SettingsShell {
    constructor(window,{title='Settings',onPageChanged=null}={}) {
        this.window=window;this.pages=new Map();this.onPageChanged=onPageChanged;this.query='';
        this.stack=new Gtk.Stack({transition_type:Gtk.StackTransitionType.CROSSFADE,transition_duration:120,hexpand:true,vexpand:true});

        this.list=new Gtk.ListBox({css_classes:['navigation-sidebar'],selection_mode:Gtk.SelectionMode.SINGLE});
        this.list.set_header_func((row,before)=>{
            if(before&&before.section===row.section){row.set_header(null);return;}
            row.set_header(new Gtk.Label({label:row.section,xalign:0,css_classes:['caption-heading','dim-label','sidebar-section'],
                margin_start:12,margin_top:before?18:6,margin_bottom:6}));
        });
        this.list.set_filter_func(row=>!this.query||row.matches(this.query));
        this.list.set_sort_func((a,b)=>a.order-b.order);
        this.list.connect('row-selected',(_list,row)=>{if(row)this.show(row.pageId,{fromSidebar:true});});

        this.search=new Gtk.SearchEntry({placeholder_text:'Search settings',margin_start:12,margin_end:12,margin_top:6,margin_bottom:6});
        this.search.connect('search-changed',()=>{
            this.query=this.search.get_text().trim().toLowerCase();this.list.invalidate_filter();this.list.invalidate_headers();
        });
        this.search.connect('activate',()=>{
            for(let i=0,row;(row=this.list.get_row_at_index(i));i++)
                if(row.matches(this.query)){this.list.select_row(row);return;}
        });
        const sidebarBox=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL});
        sidebarBox.append(this.search);
        sidebarBox.append(new Gtk.ScrolledWindow({child:this.list,vexpand:true,hscrollbar_policy:Gtk.PolicyType.NEVER}));
        const sidebarView=new Adw.ToolbarView({content:sidebarBox});
        sidebarView.add_top_bar(new Adw.HeaderBar({show_title:false}));
        const sidebar=new Adw.NavigationPage({title:'Codenotch',tag:'sidebar',child:sidebarView});

        this.contentView=new Adw.ToolbarView({content:this.stack});
        this.header=new Adw.HeaderBar({title_widget:new Adw.WindowTitle({title})});
        this.contentView.add_top_bar(this.header);
        this.content=new Adw.NavigationPage({title,tag:'content',child:this.contentView});

        this.split=new Adw.NavigationSplitView({sidebar,content:this.content,min_sidebar_width:220,max_sidebar_width:280,sidebar_width_fraction:.25,vexpand:true});
        this.toasts=new Adw.ToastOverlay({child:this.split});
        window.set_content(this.toasts);window.set_size_request(360,480);
        const narrow=new Adw.Breakpoint({condition:Adw.BreakpointCondition.parse('max-width: 680sp')});
        narrow.add_setter(this.split,'collapsed',true);window.add_breakpoint(narrow);
    }
    // `keywords` are searched as well as every row and group title in the page.
    add(id,page,{section,title,icon,keywords='',order=this.pages.size*10}={}) {
        const row=new Gtk.ListBoxRow();row.pageId=id;row.section=section;row.order=order;
        const box=new Gtk.Box({spacing:12,margin_top:8,margin_bottom:8,margin_start:6,margin_end:6});row.set_child(box);
        box.append(typeof icon==='string'?new Gtk.Image({icon_name:icon}):icon);
        row.titleLabel=new Gtk.Label({label:title,xalign:0,hexpand:true,ellipsize:Pango.EllipsizeMode.END});box.append(row.titleLabel);
        row.matches=query=>`${row.titleLabel.get_label()} ${section} ${keywords} ${pageText(page)}`.toLowerCase().includes(query);
        this.list.append(row);this.stack.add_named(page,id);
        this.pages.set(id,{page,row});
        if(this.pages.size===1)this.list.select_row(row);
        return row;
    }
    remove(id) {
        const entry=this.pages.get(id);if(!entry)return;
        if(this.visible()===id)this.show(this.pages.keys().next().value);
        this.list.remove(entry.row);this.stack.remove(entry.page);this.pages.delete(id);
    }
    // The list's JS callbacks must not outlive the window (GJS shutdown warnings).
    destroy() {for(const unset of ['set_header_func','set_filter_func','set_sort_func'])this.list[unset](null);}
    toast(text) {this.toasts.add_toast(new Adw.Toast({title:text,timeout:4}));}
    rename(id,title) {this.pages.get(id)?.row.titleLabel.set_label(title);}
    has(id) {return this.pages.has(id);}
    visible() {return this.stack.get_visible_child_name();}
    visiblePage() {return this.stack.get_visible_child();}
    show(id,{fromSidebar=false}={}) {
        const entry=this.pages.get(id);if(!entry)return;
        this.stack.set_visible_child_name(id);
        if(!fromSidebar&&this.list.get_selected_row()!==entry.row)this.list.select_row(entry.row);
        this.split.set_show_content(true);
        this.onPageChanged?.(id);
    }
}
// Provider glyph in the current foreground color, so it follows selection and theme.
export function glyphIcon(name,size=16) {
    if(!GLYPHS[name])return new Gtk.Image({icon_name:'network-server-symbolic'});
    const area=new Gtk.DrawingArea({content_width:size,content_height:size,valign:Gtk.Align.CENTER});
    area.set_draw_func((widget,cr,width,height)=>{
        const c=widget.get_color();cr.setSourceRGBA(c.red,c.green,c.blue,c.alpha);cr.newPath();
        for(const loop of GLYPHS[name]){loop.forEach(([x,y],i)=>i?cr.lineTo(x*width,y*height):cr.moveTo(x*width,y*height));cr.closePath();}
        cr.setFillRule(1);cr.fill();
    });
    return area;
}
// Big page heading, as the first group of a PreferencesPage.
export function pageHeading(page,title,description='') {
    const group=new Adw.PreferencesGroup();
    const box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:6});
    box.append(new Gtk.Label({label:title,xalign:0,css_classes:['title-1'],wrap:true}));
    const detail=new Gtk.Label({label:description,xalign:0,wrap:true,css_classes:['dim-label'],visible:!!description});box.append(detail);
    group.add(box);page.add(group);
    return {group,detail};
}
// Segmented choice (Pulse/macOS style) as a row suffix. Returns a setter so
// callers can sync it without triggering `change`.
export function segmented(group,title,subtitle,labels,keys,current,change) {
    const row=new Adw.ActionRow({title,subtitle});
    const box=new Gtk.Box({css_classes:['linked','segmented'],valign:Gtk.Align.CENTER,homogeneous:true});row.add_suffix(box);
    let syncing=false,first=null;const buttons=[];
    labels.forEach((text,index)=>{
        const button=new Gtk.ToggleButton({label:text,group:first});first??=button;buttons.push(button);box.append(button);
        button.connect('toggled',()=>{if(button.active&&!syncing)change(keys[index]);});
    });
    const set=key=>{syncing=true;buttons[Math.max(0,keys.indexOf(key))].set_active(true);syncing=false;};
    set(current);group.add(row);
    return {row,set};
}
function pageText(page) {
    const words=[];
    const walk=widget=>{
        if(widget instanceof Adw.PreferencesRow)words.push(widget.get_title?.()??'',widget.get_subtitle?.()??'');
        else if(widget instanceof Adw.PreferencesGroup)words.push(widget.get_title()??'',widget.get_description()??'');
        for(let child=widget.get_first_child();child;child=child.get_next_sibling())walk(child);
    };
    walk(page);return words.join(' ');
}
