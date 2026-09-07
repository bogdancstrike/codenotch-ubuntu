#!/usr/bin/gjs -m
// Rasterise an SVG with librsvg + cairo through GJS, so refreshing the README
// images needs no npm packages and no extra system dependencies.
import Rsvg from 'gi://Rsvg';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import cairo from 'cairo';

const [source,target,scaleArg]=ARGV;
if(!source||!target){printerr('usage: svg2png.js IN.svg OUT.png [scale]');imports.system.exit(2);}
const scale=Number(scaleArg??1)||1;
const handle=Rsvg.Handle.new_from_gfile_sync(Gio.File.new_for_path(source),Rsvg.HandleFlags.FLAGS_NONE,null);
const [ok,width,height]=handle.get_intrinsic_size_in_pixels();
if(!ok){printerr('svg has no intrinsic size');imports.system.exit(1);}
const surface=new cairo.ImageSurface(cairo.Format.ARGB32,Math.round(width*scale),Math.round(height*scale));
const cr=new cairo.Context(surface);
cr.scale(scale,scale);
const viewport=new Rsvg.Rectangle();
viewport.x=0;viewport.y=0;viewport.width=width;viewport.height=height;
handle.render_document(cr,viewport);
surface.flush();
surface.writeToPNG(target);
print(`${target}: ${Math.round(width*scale)}x${Math.round(height*scale)}`);
