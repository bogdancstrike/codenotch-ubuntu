#!/usr/bin/gjs -m
// Offline preview through the same Cairo renderer used by GNOME Shell.
import cairo from 'cairo';
import * as R from '../extension/render.js';
const system={cpu:.34,mem:.52,memFree:7.7,memTotal:16,disk:.41,diskFree:295,diskTotal:500};
const examples={cpu:system,memory:system,storage:system,network:{download:153600,upload:25600,received:104857600,sent:10485760,interfaces:['eth0']},
    uptime:{seconds:183600},temperature:{celsius:54,sensor:'Package id 0'},load:{one:1.42,five:1.1,fifteen:.86,cores:8},
    swap:{fraction:.12,used:.5,total:4},processes:{running:3,total:412},diskio:{read:2097152,write:524288,disks:['nvme0n1']},
    wifi:{interface:'wlan0',quality:.78,signal:-54},sun:{sunrise:'07:05',sunset:'18:52',place:'Sample city'},utc:{},moon:{},progress:{}};
const columns=3,rowHeight=400,rows=Math.ceil(Object.keys(examples).length/columns);
const surface=new cairo.ImageSurface(cairo.Format.ARGB32,1110,30+rows*rowHeight),cr=new cairo.Context(surface);
R.color(cr,'#12161c');cr.paint();
Object.entries(examples).forEach(([kind,data],i)=>{
    cr.save();cr.translate(30+(i%columns)*360,30+Math.floor(i/columns)*rowHeight);
    R.drawNotch(cr,{providers:[],widgets:[kind],data:{[kind]:data},settings:{},edge:'top',progress:1});
    cr.translate(0,110);R.drawWidgetCard(cr,R.widgetCard(kind,data),330,{});cr.restore();
});
surface.writeToPNG('/tmp/codenotch-widget-preview.png');print(`${Object.keys(examples).length} system widgets and hover cards rendered with Cairo.`);
