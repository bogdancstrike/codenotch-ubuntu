#!/usr/bin/gjs -m
// Offline preview through the same Cairo renderer used by GNOME Shell.
import cairo from 'cairo';
import * as R from '../extension/render.js';
const surface=new cairo.ImageSurface(cairo.Format.ARGB32,1110,900),cr=new cairo.Context(surface);
R.color(cr,'#12161c');cr.paint();
const system={cpu:.34,mem:.52,memFree:7.7,memTotal:16,disk:.41,diskFree:295,diskTotal:500};
const examples={cpu:system,memory:system,storage:system,network:{download:153600,upload:25600,received:104857600,sent:10485760,interfaces:['eth0']},uptime:{seconds:183600},temperature:{celsius:54,sensor:'Package id 0'}};
Object.entries(examples).forEach(([kind,data],i)=>{
 cr.save();cr.translate(30+(i%3)*360,30+Math.floor(i/3)*430);
 R.drawNotch(cr,{providers:[],widgets:[kind],data:{[kind]:data},settings:{},edge:'top',progress:1});
 cr.translate(0,110);R.drawWidgetCard(cr,R.widgetCard(kind,data),330,{});cr.restore();
});
surface.writeToPNG('/tmp/codenotch-widget-preview.png');print('Six new widgets and hover cards rendered with Cairo.');
