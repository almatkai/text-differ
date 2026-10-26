#!/usr/bin/env python3
"""Verify review inputs without reading SDK/app siblings or any user files."""
from pathlib import Path
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[2];V2=ROOT/'v2'
sha=lambda b:hashlib.sha256(b).hexdigest()
p=json.loads((V2/'evidence/provenance.json').read_text())
for name,record in p['fixtures'].items():assert sha((ROOT/name).read_bytes())==record['sha256'],name
source=p['source']['commit']
for name in subprocess.check_output(['git','ls-tree','-r','--name-only',source],cwd=ROOT,text=True).splitlines():
 original=subprocess.check_output(['git','show',source+':'+name],cwd=ROOT)
 expected=original+(b'\n[Standalone Rust V2 (development review)](v2/README.md).\n' if name=='README.md' else b'')
 assert (ROOT/name).read_bytes()==expected,name
assert sha((V2/'resources/command-icon.png').read_bytes())==p['upstream']['ownAndUpstreamPNGsha256']
lock=(V2/'Cargo.lock').read_text();assert 'git+https://github.com/almatkai/tezbar-extension-sdk-rust.git?rev='+p['sdk']['commit'] in lock
assert 'path =' not in (V2/'Cargo.toml').read_text().split('[dependencies]')[1].split("[target.")[0], 'Dependency must not use SDK path'
for dep in json.loads((V2/'licenses/rust-locked.json').read_text()):
 for name,digest in dep['files'].items():assert sha((V2/name).read_bytes())==digest,name
print('Immutable fixtures, exact V1 bytes plus discovery link, original PNG, HTTPS SDK lock and authentic notices verified.')
