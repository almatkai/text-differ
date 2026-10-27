#!/usr/bin/env python3
"""Disposable exact-root-lock V1 copy and QA dependencies, all below .qa."""
from pathlib import Path
import os,subprocess,shutil
ROOT=Path(__file__).resolve().parents[1];REPO=ROOT.parent
SOURCE='12e6a2f422647b98274e3bfd63c814ed073820f2'
qa=ROOT/'.qa'
for name in ['home','tmp','cache','v1','tools']: (qa/name).mkdir(parents=True,exist_ok=True)
env=os.environ.copy();env.update(HOME=str(qa/'home'),TMPDIR=str(qa/'tmp'),npm_config_cache=str(qa/'cache/npm'))
for p in subprocess.check_output(['git','ls-tree','-r','--name-only',SOURCE],cwd=REPO,text=True).splitlines():
 dest=qa/'v1'/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(subprocess.check_output(['git','show',SOURCE+':'+p],cwd=REPO))
for name in ['package.json','package-lock.json']:shutil.copyfile(ROOT/'tests/tools'/name,qa/'tools'/name)
for name in ['v1','tools']:
 subprocess.run(['npm','ci','--prefix',str(qa/name),'--ignore-scripts','--no-audit','--no-fund'],env=env,check=True)
for action in ['test','typecheck']:
 subprocess.run(['npm','--prefix',str(qa/'v1'),'run',action],env=env,check=True)
