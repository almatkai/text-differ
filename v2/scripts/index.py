#!/usr/bin/env python3
"""Hash every Git-visible file in the WHOLE clone, excluding only this index."""
from pathlib import Path
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[2]
SELF='v2/evidence/INDEX.json'
paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT).decode().split('\0')
files={}
for p in sorted(set(paths)-{'',SELF}):
 assert not any(c in p.split('/') for c in ['.qa','target','target-msrv','target-windows-gnu','target-windows-msvc','node_modules','dist','__pycache__']),p
 source=ROOT/p;assert source.is_file() and not source.is_symlink(),p
 files[p]={'bytes':source.stat().st_size,'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
out=ROOT/SELF;out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps({'scope':'whole Git-visible clone, tracked plus untracked; self excluded','files':files},indent=2)+'\n')
print('Indexed',len(files),'Git-visible files')
