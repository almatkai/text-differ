#!/usr/bin/env python3
"""Compile exact pinned/patched function bodies; NOT a host build or OS test."""
from pathlib import Path
import sys,subprocess,os,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import host_patch
host_patch.main()
old=(host_patch.FIX/host_patch.REG).read_text()
new=(host_patch.OUT/host_patch.REG).read_text()
def function(s,name):
    import re
    m=re.search(r'^(?:pub(?:\([^\n]*?\))? )?fn '+name+r'(?:<[^\n]*?>)?\(',s,re.M)
    assert m,name
    end=s.index('\n}',m.start())+2
    return s[m.start():end]
names=['fallback','icon_path','command_icon_path','platform','compatible','preference_metadata','preference_file','retained_preferences_path','preferences_path']
header='''use serde_json::{json,Value};use std::path::{Path,PathBuf,Component};
#[derive(Clone)] struct Installed {id:String,slug:String,path:PathBuf,resource_path:PathBuf,manifest:Value,data_dir:PathBuf}
'''
parts=[]
for label,src in [('before',old),('after',new)]:
    part='\n'.join(function(src,n) for n in names)
    if label=='after':part+='\n'+function(src,'replacement_command')
    tests=r'''
#[test] fn active_resource_and_canonical_preferences() {
 let data=PathBuf::from(std::env::var("TEXT_DIFFER_FIXTURES").unwrap()).join(LABEL);
 let canonical=data.join("extensions/packages/com.tezbar.native.text-differ");
 let version=canonical.join("versions/fixture");std::fs::create_dir_all(version.join("resources")).unwrap();
 std::fs::write(version.join("resources/command-icon.png"),b"fixture icon").unwrap();
 std::fs::write(canonical.join("preferences.json"),b"{\"future\":true}").unwrap();
 let e=Installed{id:"com.tezbar.native.text-differ".into(),slug:"text-differ".into(),path:canonical.clone(),resource_path:version.clone(),manifest:json!({"icon":"resources/command-icon.png"}),data_dir:data};
 if LABEL=="before" {assert!(icon_path(&e).is_none());assert!(command_icon_path(&e,&e.manifest).is_none());}
 else {assert_eq!(icon_path(&e),Some(version.join("resources/command-icon.png").to_string_lossy().into()));assert_eq!(command_icon_path(&e,&e.manifest),icon_path(&e));}
 assert_eq!(preferences_path(&e).unwrap(),canonical.join("preferences.json"));
 assert_eq!(e.path,canonical,"Uninstall/discovery root is still canonical, not its version");
 assert!(retained_preferences_path(&e).ends_with("extension-preferences/com.tezbar.native.text-differ.json"));
}
'''.replace('LABEL','"'+label+'"')
    if label=='after':tests+=r'''
#[test] fn exact_verified_covered_aliases_only() {
 let e=Installed{id:"com.tezbar.native.text-differ".into(),slug:"text-differ".into(),path:PathBuf::new(),resource_path:PathBuf::new(),data_dir:PathBuf::new(),manifest:serde_json::from_str(include_str!("MANIFEST")).unwrap()};
 for alias in ["com.tezbar.native.text-differ","raycast.text-differ","com.tezbar.text-differ"] {assert_eq!(replacement_command(&[e.clone()],alias,"open-with-text-differ").unwrap(),Some(e.id.clone()));}
 for alias in ["text-differ","raycast.text-differ.evil","Raycast.text-differ","raycast.text-differ ","com.tezbar.text-differ-lookalike"] {assert_eq!(replacement_command(&[e.clone()],alias,"open-with-text-differ").unwrap(),None);}
 assert_eq!(replacement_command(&[],"raycast.text-differ","open-with-text-differ").unwrap(),None);
 assert_eq!(replacement_command(&[e.clone()],"raycast.text-differ","uncovered").unwrap(),None);
 for modify in ["health","identity","runtime","platform","command-platform"] {
  let mut bad=e.clone();match modify {"health"=>bad.manifest["healthError"]=json!("tampered"),"identity"=>bad.manifest["id"]=json!("other"),"runtime"=>bad.manifest["commands"][0]["runtime"]=json!("javascript"),"platform"=>bad.manifest["platforms"]=json!(["Linux"]),_=>bad.manifest["commands"][0]["platforms"]=json!(["Linux"])}
  assert_eq!(replacement_command(&[bad],"raycast.text-differ","open-with-text-differ").unwrap(),None);
 }
 let mut duplicate=e.clone();duplicate.id="com.tezbar.native.duplicate".into();duplicate.manifest["id"]=json!(duplicate.id);
 assert!(replacement_command(&[e,duplicate],"raycast.text-differ","open-with-text-differ").is_err());
}
'''.replace('MANIFEST',str(ROOT/'extension.json'))
    parts.append('mod '+label+' {\n'+header+part+tests+'\n}')
# Actual pinned pure runtime/artifact/path functions, without any host IO or installer.
runtime=(host_patch.FIX/'src-tauri/src/native_core/extensions/process_install.rs').read_text()
pure='\n'.join(function(runtime,n) for n in ['target_for','relative','digest','artifact_for'])
parts.append('mod pinned_runtime { use serde_json::Value; use std::path::PathBuf;\n'+pure+r'''
#[test] fn development_source_is_not_a_release_artifact() {
 let m:Value=serde_json::from_str(include_str!("MANIFEST")).unwrap();
 assert!(artifact_for(&m,"aarch64-apple-darwin").unwrap_err().contains("No verified release artifact"));
 assert_eq!(target_for("windows","x86_64"),"x86_64-pc-windows-msvc");
 assert_eq!(target_for("macos","aarch64"),"aarch64-apple-darwin");
 for path in ["../bin/x","bin/../x","bin/CON.exe","C:/x","bin/x\\y","bin/file.","/bin/x"] {assert!(relative(path).is_err());}
 assert!(relative("bin/text-differ").is_ok());
}
}'''.replace('MANIFEST',str(ROOT/'extension.json')))
# Original alias gate is compiled unchanged with its exact frozen catalog.
original=(host_patch.FIX/'src-tauri/src/native_core/extensions/v2_runtime.rs').read_text()
original=original[original.index('pub(super) fn slug'):]
catalog=str(host_patch.FIX/'src-tauri/src/native_core/extensions/v2_catalog.json')
parts.append('mod v2_catalog {pub fn source()->Vec<serde_json::Value>{serde_json::from_str(include_str!("'+catalog+'")).unwrap()}}\nmod original_gate {\n'+original+'\n#[test]fn catalog_cannot_route_this_new_alias(){assert!(slug("raycast.text-differ").is_none());}}')
# Verify preferences/removal code is byte-identical in patch, not accidentally switched.
for n in ['preferences_path','retained_preferences_path','retain_preferences']:
 if n!='retain_preferences':assert function(old,n)==function(new,n)
assert old[old.index('    for root in managed_roots(ctx) {',old.index('fn uninstall')):] == new[new.index('    for root in managed_roots(ctx) {',new.index('fn uninstall')):]
source=ROOT/'.qa/host_contract.rs';source.write_text('\n'.join(parts))
lib=list((ROOT/'target/debug/deps').glob('libserde_json-*.rlib'));assert lib
exe=ROOT/'.qa/host-contract'
subprocess.run(['rustup','run','stable','rustc','--edition=2021','--test','-A','dead_code',str(source),'-L','dependency='+str(ROOT/'target/debug/deps'),'--extern','serde_json='+str(lib[0]),'-o',str(exe)],check=True)
env=os.environ.copy();env['TEXT_DIFFER_FIXTURES']=str(ROOT/'.qa/host-fixture')
subprocess.run([str(exe),'--nocapture'],env=env,check=True)
print('Exact host function fixtures: alias/resource before+after; preference/uninstall roots unchanged. No host build.')
