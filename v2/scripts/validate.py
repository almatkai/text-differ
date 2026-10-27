#!/usr/bin/env python3
"""Reproducible local validation; no install, real selection, clipboard, or app."""
from pathlib import Path
import os,subprocess,json,time,uuid,sys
ROOT=Path(__file__).resolve().parents[1];REPO=ROOT.parent;qa=ROOT/'.qa'
for name in ['home','tmp','cache','validation']: (qa/name).mkdir(parents=True,exist_ok=True)
env=os.environ.copy()
rustup_home=env.get('RUSTUP_HOME') or subprocess.check_output(['rustup','show','home'],text=True).strip()
env.update(HOME=str(qa/'home'),TMPDIR=str(qa/'tmp'),TMP=str(qa/'tmp'),TEMP=str(qa/'tmp'),RUSTUP_HOME=rustup_home,CARGO_HOME=str(qa/'cargo-home'),CARGO_TARGET_DIR=str(ROOT/'target'),npm_config_cache=str(qa/'cache/npm'))
results=[]
def run(name,cmd,*,overrides=None,block=None,timeout=60):
 current=env.copy();current.update(overrides or {});start=time.monotonic()
 p=subprocess.run(cmd,cwd=REPO,env=current,text=True,capture_output=True,timeout=timeout)
 output=p.stdout+p.stderr;(qa/'validation'/f'{name}.log').write_text(output)
 state='passed' if p.returncode==0 else 'blocked' if block and block in output else 'failed'
 result={'name':name,'command':cmd,'exitCode':p.returncode,'state':state,'seconds':round(time.monotonic()-start,3),'log':f'.qa/validation/{name}.log'}
 if state=='blocked':result['reason']=block
 results.append(result);print(name,state,p.returncode,flush=True)
 if state=='failed':print(output[-6000:]);raise RuntimeError(name+' failed')
 return p
manifest=['--manifest-path','v2/Cargo.toml']
run('prepare-v1-and-tools',['python3','v2/scripts/prepare.py'],timeout=60)
for toolchain,target in [('stable','target'),('1.85.0','target-msrv')]:
 build_env={'CARGO_TARGET_DIR':str(ROOT/target)}
 run('fmt-'+toolchain,['cargo','+'+toolchain,'fmt',*manifest,'--check'],overrides=build_env)
 run('test-'+toolchain,['cargo','+'+toolchain,'test','--locked','--all-targets',*manifest],overrides=build_env)
 run('clippy-'+toolchain,['cargo','+'+toolchain,'clippy','--locked','--all-targets',*manifest,'--','-D','warnings'],overrides=build_env)
 run('build-'+toolchain,['cargo','+'+toolchain,'build','--locked',*manifest],overrides=build_env)
 run('pipes-'+toolchain,['node','v2/tests/process.mjs',str(ROOT/target/'debug/text-differ')],overrides=build_env,timeout=45)
run('pinned-host-functions',['python3','v2/tests/host_contract.py'])
run('pinned-renderer-schema',['node','v2/tests/renderer.mjs'])
win={'CARGO_TARGET_DIR':str(ROOT/'target-windows-gnu')}
run('windows-gnu-check',['cargo','+stable','check','--locked','--all-targets','--target','x86_64-pc-windows-gnu',*manifest],overrides=win,block="target may not be installed")
run('windows-gnu-link',['cargo','+stable','build','--locked','--target','x86_64-pc-windows-gnu',*manifest],overrides=win,block="error calling dlltool")
run('windows-msvc-check',['cargo','+stable','check','--locked','--all-targets','--target','x86_64-pc-windows-msvc',*manifest],overrides={'CARGO_TARGET_DIR':str(ROOT/'target-windows-msvc')},block="target may not be installed")
# This fresh Cargo home has no sibling dependencies or inherited Cargo config.
isolated=qa/'isolated-runs'/uuid.uuid4().hex
isolated_env={'CARGO_HOME':str(isolated/'cargo-home'),'CARGO_TARGET_DIR':str(isolated/'target')}
run('isolated-https-release',['cargo','+stable','build','--locked','--release','--target','aarch64-apple-darwin',*manifest],overrides=isolated_env,timeout=60)
run('locked-crate-fetch',['cargo','+stable','fetch','--locked',*manifest])
run('authentic-licenses',['python3','v2/scripts/licenses.py'])
exe=isolated/'target/aarch64-apple-darwin/release/text-differ'
run('dev-package',['python3','v2/scripts/package.py',str(exe)])
package=json.loads((qa/'package-report.json').read_text())
run('extracted-production-pipes',['node','v2/tests/process.mjs',str(ROOT/package['extractedExecutable'])],timeout=45)
run('extracted-native-renderer',['node','v2/tests/renderer.mjs'])
report={'source':'12e6a2f422647b98274e3bfd63c814ed073820f2','host':'ea100cee3f69711de12485ba061950c5fc65258f','sdk':'e955911f0bf5b558f9d3eb5183df0adc95c22af2','rustStable':subprocess.check_output(['rustc','+stable','--version'],env=env,text=True).strip(),'rustMSRV':subprocess.check_output(['rustc','+1.85.0','--version'],env=env,text=True).strip(),'node':subprocess.check_output(['node','--version'],env=env,text=True).strip(),'checks':results,'freshCargoHome':str((isolated/'cargo-home').relative_to(ROOT)),'package':package,'notRun':['full host/Tauri build','live GUI/Finder/Explorer/clipboard','Windows linked executable / OS execution','installation/release/push/PR/deletion']}
(qa/'validation-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('Validation complete; inspect v2/.qa/validation-report.json',flush=True)
