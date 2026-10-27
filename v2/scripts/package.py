#!/usr/bin/env python3
"""Ignored, inventory-complete ARM64 development ZIP; no fabricated artifact URL."""
from pathlib import Path
import json,hashlib,zipfile,os,sys,subprocess
ROOT=Path(__file__).resolve().parents[1]
binary=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT/'.qa/isolated-target/release/text-differ'
assert binary.is_file()
kind=subprocess.check_output(['file',str(binary)],text=True);assert 'Mach-O 64-bit executable arm64' in kind,kind
sha=lambda b:hashlib.sha256(b).hexdigest()
contents={'bin/text-differ':binary.read_bytes(),'LICENSE':(ROOT/'LICENSE').read_bytes(),'NOTICE':(ROOT/'NOTICE').read_bytes()}
for folder in ['resources','licenses']:
 for p in (ROOT/folder).rglob('*'):
  assert not p.is_symlink()
  if p.is_file():contents[p.relative_to(ROOT).as_posix()]=p.read_bytes()
manifest=json.loads((ROOT/'extension.json').read_text());assert manifest['artifacts']=={}
manifest['files']={p:sha(b) for p,b in sorted(contents.items())}
contents['extension.json']=(json.dumps(manifest,indent=2)+'\n').encode()
out=ROOT/'dist';out.mkdir(exist_ok=True);archive=out/'text-differ-dev-aarch64-apple-darwin.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for name,data in sorted(contents.items()):
  p=Path(name);assert not p.is_absolute() and '..' not in p.parts and '\\' not in name
  entry=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED
  entry.create_system=3;entry.external_attr=((0o100755 if name=='bin/text-differ' else 0o100644)<<16)
  z.writestr(entry,data)
archive_sha=sha(archive.read_bytes());extracted=ROOT/'.qa/extracted'/archive_sha
extracted.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(archive) as z:
 assert len(z.namelist())==len(set(z.namelist())) and set(z.namelist())==set(contents)
 for name in z.namelist():
  data=z.read(name);assert sha(data)==sha(contents[name]);p=extracted/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
  p.chmod(0o755 if name=='bin/text-differ' else 0o644)
assert set(manifest['files'])==set(contents)-{'extension.json'}
report={'developmentOnly':True,'installableRelease':False,'target':'aarch64-apple-darwin','archive':'dist/'+archive.name,'archiveSha256':archive_sha,'executableSha256':sha(contents['bin/text-differ']),'memberCount':len(contents),'inventoryComplete':True,'files':{p:sha(b) for p,b in sorted(contents.items())},'extractedExecutable':str((extracted/'bin/text-differ').relative_to(ROOT))}
(ROOT/'.qa/package-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='files'},indent=2))
