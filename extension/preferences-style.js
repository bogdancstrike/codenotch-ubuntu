import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

export function applyTheme(theme='system') {
    const schemes={system:Adw.ColorScheme.DEFAULT,light:Adw.ColorScheme.FORCE_LIGHT,dark:Adw.ColorScheme.FORCE_DARK};
    Adw.StyleManager.get_default().set_color_scheme(schemes[theme]??Adw.ColorScheme.DEFAULT);
}
export function stylePreferences(window) {
    window.add_css_class('codenotch-settings');
    const css=new Gtk.CssProvider();
    css.load_from_data(`
        .codenotch-settings preferencesgroup { margin-bottom: 8px; }
        .codenotch-settings row { border-radius: 10px; }
        .codenotch-settings row .title { font-weight: 500; }
        .codenotch-settings stackswitcher button { padding: 10px 18px; }
        .codenotch-settings .usage-navigation { margin-top: 4px; margin-bottom: 12px; }
        .codenotch-settings .usage-navigation button:checked {
            background: alpha(@accent_color, .15); color: @accent_color;
        }
    `,-1);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),css,Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    return ()=>Gtk.StyleContext.remove_provider_for_display(Gdk.Display.get_default(),css);
}
