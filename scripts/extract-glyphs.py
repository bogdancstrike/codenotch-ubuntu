#!/usr/bin/env python3
"""Convert upstream's MIT-licensed unit-box polygon outlines without retracing."""
import json, re, sys
from pathlib import Path
src=Path(sys.argv[1]).read_text()
glyphs={}
for match in re.finditer(r'static let (\w+): \[\[CGPoint\]\] = \[', src):
    i=match.end(); depth=1; end=i
    while depth:
        depth += (src[end]=='[')-(src[end]==']'); end+=1
    body=src[i:end-1]
    loops=[]
    for loop in re.findall(r'\[([^\[\]]+)\]',body):
        points=[[float(x),float(y)] for x,y in re.findall(r'CGPoint\(x: ([\d.-]+), y: ([\d.-]+)\)',loop)]
        if points: loops.append(points)
    glyphs[match.group(1)]=loops
Path(sys.argv[2]).write_text('// MIT: Copyright (c) 2026 Vinz. Converted from GlyphOutline.swift.\nexport const GLYPHS = '+json.dumps(glyphs,separators=(',',':'))+';\n')
