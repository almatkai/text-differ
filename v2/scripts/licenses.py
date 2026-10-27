#!/usr/bin/env python3
"""Copy authentic license/notice bytes from exact locked, fetched Cargo sources."""
from pathlib import Path
import os,subprocess,json,hashlib,shutil
ROOT=Path(__file__).resolve().parents[1]
env=os.environ.copy();env['CARGO_HOME']=str(ROOT/'.qa/cargo-home')
metadata=json.loads(subprocess.check_output(['cargo','+stable','metadata','--locked','--format-version','1','--manifest-path',str(ROOT/'Cargo.toml')],env=env))
report=[]
for package in metadata['packages']:
 if package['name']=='text-differ-v2':continue
 source=Path(package['manifest_path']).parent.resolve()
 assert str(source).startswith(str(ROOT/'.qa')), 'No sibling/global source inputs'
 copied={}
 for p in source.iterdir():
  if p.is_file() and p.name.upper().startswith(('LICENSE','LICENCE','COPYING','COPYRIGHT','NOTICE','UNLICENSE')):
   relative=Path('licenses/rust')/(package['name']+'-'+package['version'])/p.name
   dest=ROOT/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest)
   copied[str(relative)]=hashlib.sha256(p.read_bytes()).hexdigest()
 missing_license=not bool(copied)
 if missing_license:
  for name in ['README.md','AUTHORS']:
   p=source/name
   if p.is_file():
    relative=Path('licenses/rust')/(package['name']+'-'+package['version'])/name
    dest=ROOT/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest)
    copied[str(relative)]=hashlib.sha256(p.read_bytes()).hexdigest()
 report.append({'name':package['name'],'version':package['version'],'source':package['source'],'declaredLicense':package['license'],'files':copied,'missingText':missing_license})
(ROOT/'licenses/rust-locked.json').write_text(json.dumps(report,indent=2)+'\n')
shutil.copyfile(ROOT/'tests/fixtures/host/LICENSE',ROOT/'licenses/host-Apache-2.0.txt')
print('Locked packages:',len(report),'missing authentic license files:',[p['name'] for p in report if p['missingText']])
