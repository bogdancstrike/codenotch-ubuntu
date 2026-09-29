import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

export function applyTheme(theme='system') {
    const schemes={system:Adw.ColorScheme.DEFAULT,light:Adw.ColorScheme.FORCE_LIGHT,dark:Adw.ColorScheme.FORCE_DARK};
    Adw.StyleManager.get_default().set_color_scheme(schemes[theme]??Adw.ColorScheme.DEFAULT);
}
// PreferencesPage exposes no content-width property; find its native clamp by type.
export function sizePreferencesPage(page) {
    const visit=widget=>{
        if(widget instanceof Adw.Clamp){widget.set_maximum_size(1000);widget.set_tightening_threshold(900);return true;}
        for(let child=widget.get_first_child();child;child=child.get_next_sibling())if(visit(child))return true;
        return false;
    };
    visit(page);
}
export function stylePreferences(window) {
    window.add_css_class('codenotch-settings');
    const css=new Gtk.CssProvider();
    css.load_from_data(`
        .codenotch-settings preferencesgroup { margin-bottom: 0; }
        .codenotch-settings row { border-radius: 10px; }
        .codenotch-settings button { min-height: 28px; }
        .codenotch-settings .codenotch-action { min-width: 112px; }
        .codenotch-settings .usage-day { min-height: 8px; min-width: 8px; padding: 0; }
        .codenotch-settings row .title { font-weight: 500; }
        .codenotch-settings stackswitcher button { padding: 8px 18px; }
        .codenotch-settings .usage-navigation { margin: 0; }
        .codenotch-settings .usage-navigation button:checked {
            background: alpha(@accent_color, .15); color: @accent_color;
        }
    `,-1);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),css,Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    return ()=>Gtk.StyleContext.remove_provider_for_display(Gdk.Display.get_default(),css);
}
