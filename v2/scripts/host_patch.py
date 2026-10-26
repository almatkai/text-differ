#!/usr/bin/env python3
"""Generate ONLY unapplied generic prerequisites from immutable host fixtures."""
from pathlib import Path
import difflib
ROOT=Path(__file__).resolve().parents[1]
FIX=ROOT/'tests/fixtures/host'
OUT=ROOT/'.qa/patched-host'
REG='src-tauri/src/native_core/extensions/registry.rs'
NATIVE='src-tauri/src/native_core/extensions/native.rs'
DETAIL='src/renderer/src/raycast-api/index.tsx'

def patch_registry(s):
    s=s.replace('    path: PathBuf,\n    manifest:', '    path: PathBuf,\n    resource_path: PathBuf,\n    manifest:')
    s=s.replace('            let mut manifest = if native {','            let mut resource_path = path.clone();\n            let mut manifest = if native {')
    s=s.replace('                    Ok(package) => package.manifest,','                    Ok(package) => { resource_path = package.dir; package.manifest },')
    s=s.replace('                path,\n                manifest,','                path,\n                resource_path,\n                manifest,')
    s=s.replace('        path,\n        manifest: Value::Null,','        resource_path: path.clone(),\n        path,\n        manifest: Value::Null,')
    s=s.replace('extension.path.join(relative)', 'extension.resource_path.join(relative)')
    s=s.replace('extension.path.join("assets").join(relative)', 'extension.resource_path.join("assets").join(relative)')
    before='/// Native implementations use the same discovery and platform rules as the launcher.'
    helper='''// Candidates are supplied only by collect(): native entries resolve and verify
// their active package; damaged entries carry healthError and cannot authorize.
fn replacement_command(entries: &[Installed], requested: &str, command: &str) -> Result<Option<String>, String> {
    let mut found = None;
    for entry in entries {
        if !entry.id.starts_with("com.tezbar.native.")
            || entry.manifest["id"] != entry.id
            || !entry.manifest["healthError"].is_null()
            || !compatible(&entry.manifest, false)
        { continue; }
        let matches = requested == entry.id || entry.manifest["replaces"].as_array()
            .is_some_and(|aliases| aliases.iter().any(|alias| alias.as_str() == Some(requested)));
        let covered = entry.manifest["commands"].as_array().is_some_and(|commands| commands.iter()
            .any(|c| c["name"] == command && c["runtime"] == "rust" && compatible(c, true)));
        if matches && covered {
            if found.is_some() { return Err("Ambiguous installed extension replacement".into()); }
            found = Some(entry.id.clone());
        }
    }
    Ok(found)
}

pub(super) fn verified_native_command(ctx: &CoreContext, requested: &str, command: &str) -> Result<Option<String>, String> {
    replacement_command(&collect(ctx), requested, command)
}

'''
    assert before in s
    return s.replace(before,helper+before)

def patch_native(s):
    old='''            if requested.starts_with("com.tezbar.native.") || v2_runtime::slug(requested).is_some()
            {
                self.launch(ctx, files, body).await
            } else {
                return None;
            }'''
    new='''            let command = body["commandName"].as_str().unwrap_or("");
            match registry::verified_native_command(ctx, requested, command) {
                Ok(Some(canonical)) => {
                    let mut selected = body.clone();
                    selected["extensionId"] = json!(canonical);
                    self.launch(ctx, files, &selected).await
                }
                Ok(None) if requested.starts_with("com.tezbar.native.") => self.launch(ctx, files, body).await,
                Ok(None) => return None,
                Err(error) => Err(error),
            }'''
    assert old in s
    return s.replace(old,new)

def patch_detail(s):
    old='''              onRunPrimaryAction={onRunPrimaryAction}
              onOpenActions={openActions}'''
    new='''              onRunPrimaryAction={() => onRunPrimaryAction()}
              onOpenActions={() => openActions()}'''
    assert old in s
    i=s.index("            <DetailRuntime")
    return s[:i]+s[i:].replace(old,new,1)

def main():
    diff=[]
    for p,fn in [(REG,patch_registry),(NATIVE,patch_native),(DETAIL,patch_detail)]:
        src=(FIX/p).read_text();new=fn(src);dest=OUT/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(new)
        diff.extend(difflib.unified_diff(src.splitlines(True),new.splitlines(True),fromfile='a/'+p,tofile='b/'+p))
    dest=ROOT/'integration/host-prerequisites.patch';dest.parent.mkdir(exist_ok=True);dest.write_text(''.join(diff))
if __name__=='__main__':main()
