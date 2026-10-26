pub mod core;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tezbar_extension_sdk::{unchanged, view, BoxFuture, CoreResult, Extension, ExtensionContext};
pub const COMMAND: &str = "open-with-text-differ";
#[derive(Clone)]
enum Action {
    Compare(Option<Vec<String>>),
    Copy(Arc<str>),
}
#[derive(Clone)]
struct Screen {
    title: String,
    body: String,
    message: Option<String>,
    action: Option<(String, String, Action)>,
}
// Only irreversible token consumption and a prepared recovery are authoritative
// outside SDK state. New read/diff results live exclusively in SDK-staged state.
#[derive(Default)]
struct Authority {
    consumed: Option<String>,
    recovery: Option<Screen>,
}
type Registry = Arc<Mutex<HashMap<String, Authority>>>;
#[derive(Default)]
pub struct Adapter {
    sessions: Registry,
    sequence: AtomicU64,
}
struct SessionGuard {
    sessions: Registry,
    id: String,
}
impl Drop for SessionGuard {
    fn drop(&mut self) {
        self.sessions.lock().unwrap().remove(&self.id);
    }
}
impl Adapter {
    fn token(&self) -> String {
        format!(
            "text-differ:{}",
            self.sequence.fetch_add(1, Ordering::Relaxed)
        )
    }
    fn error(&self, message: &str, paths: Option<Vec<String>>) -> Screen {
        Screen {
            title: "Could not compare files".into(),
            body: format!("Could not compare files\n\n{message}"),
            message: None,
            action: Some((
                self.token(),
                "Retry Comparison".into(),
                Action::Compare(paths),
            )),
        }
    }
    async fn compare(&self, ctx: &ExtensionContext, paths: Option<Vec<String>>) -> Screen {
        let paths=match paths {
            Some(paths)=>paths,
            None=>match ctx.host("host.selection.read",json!({"kind":"files"})).await.and_then(selected_paths){
                Ok(paths)=>paths,
                Err(_)=>return self.error("Cannot read validated Finder/File Explorer selection. Select exactly two accessible text files and retry.",None),
            }
        };
        if paths.len() != 2 {
            let mut screen=self.error("Select exactly two files\n\nChoose two text files in Finder or File Explorer, then run this command again.",None);
            screen.title = "Select exactly two files".into();
            return screen;
        }
        let result = async {
            let left = core::read_selected(&paths[0])
                .await
                .map_err(|e| format!("First selected file: {e}"))?;
            let right = core::read_selected(&paths[1])
                .await
                .map_err(|e| format!("Second selected file: {e}"))?;
            core::compare(&left, &right).await
        }
        .await;
        match result {
            Err(error) => self.error(&error, Some(paths)),
            Ok(diff) => {
                let title = format!(
                    "{} ↔ {}",
                    basename(&paths[0], &ctx.platform),
                    basename(&paths[1], &ctx.platform)
                );
                let action = (!diff.is_empty()).then(|| {
                    (
                        self.token(),
                        "Copy Diff".into(),
                        Action::Copy(Arc::from(diff.as_str())),
                    )
                });
                Screen {
                    body: format!("{title}\n\n{diff}"),
                    title,
                    message: None,
                    action,
                }
            }
        }
    }
    fn current(&self, id: &str, state: &Value) -> Result<Screen, String> {
        let committed = Screen::from_state(state)?;
        let registry = self.sessions.lock().unwrap();
        let authority = registry.get(id).ok_or("Session is no longer current")?;
        if committed
            .action
            .as_ref()
            .is_some_and(|(token, _, _)| Some(token) == authority.consumed.as_ref())
        {
            authority
                .recovery
                .clone()
                .ok_or("Consumed action has no recovery".into())
        } else {
            Ok(committed)
        }
    }
}
fn basename<'a>(path: &'a str, platform: &str) -> &'a str {
    if platform.eq_ignore_ascii_case("windows") {
        path.trim_end_matches(['/', '\\'])
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(path)
    } else {
        path.trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or(path)
    }
}
fn selected_paths(value: Value) -> Result<Vec<String>, String> {
    let paths = value.as_array().ok_or("Expected selected path array")?;
    if paths.len() > 128 {
        return Err("Too many selected files".into());
    }
    paths
        .iter()
        .map(|p| {
            let p = p
                .as_str()
                .filter(|p| !p.is_empty() && p.len() <= 32768 && !p.contains('\0'))
                .ok_or("Invalid selected file path")?;
            if !Path::new(p).is_absolute() {
                return Err("Selected path is not absolute".into());
            }
            Ok(p.into())
        })
        .collect()
}
fn clipboard_ack(value: Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or("Clipboard completion was not acknowledged")?;
    if object.get("ok") != Some(&Value::Bool(true))
        || object.keys().any(|k| k != "ok" && k != "message")
        || object.get("message").is_some_and(|m| !m.is_string())
    {
        return Err("Clipboard completion was not acknowledged".into());
    }
    Ok(())
}
impl Screen {
    fn stage(&self, state: &mut Value) -> Value {
        let action = self
            .action
            .as_ref()
            .map(|(id, title, action)| match action {
                Action::Compare(paths) => {
                    json!({"id":id,"title":title,"kind":"compare","paths":paths})
                }
                Action::Copy(text) => {
                    json!({"id":id,"title":title,"kind":"copy","text":text.as_ref()})
                }
            });
        *state =
            json!({"title":self.title,"body":self.body,"message":self.message,"action":action});
        let actions = self
            .action
            .as_ref()
            .map(|(id, title, _)| json!({"id":id,"title":title,"kind":"action"}))
            .into_iter()
            .collect();
        let mut result = view(
            &self.title,
            json!({"type":"Detail","props":{"markdown":core::escaped_pre(&self.body)}}),
            actions,
        );
        result["refreshMs"] = Value::Null;
        if let Some(message) = &self.message {
            result["message"] = json!(message);
        }
        result
    }
    fn from_state(state: &Value) -> Result<Self, String> {
        let text = |key: &str| {
            state[key]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("Missing committed {key}"))
        };
        let action = if state["action"].is_null() {
            None
        } else {
            let a = &state["action"];
            let token = a["id"]
                .as_str()
                .ok_or("Missing committed action ID")?
                .into();
            let title = a["title"]
                .as_str()
                .ok_or("Missing committed action title")?
                .into();
            let action = match a["kind"].as_str() {
                Some("copy") => Action::Copy(Arc::from(
                    a["text"].as_str().ok_or("Missing committed copy text")?,
                )),
                Some("compare") => Action::Compare(if a["paths"].is_null() {
                    None
                } else {
                    Some(selected_paths(a["paths"].clone())?)
                }),
                _ => return Err("Invalid committed action".into()),
            };
            Some((token, title, action))
        };
        Ok(Self {
            title: text("title")?,
            body: text("body")?,
            message: state["message"].as_str().map(str::to_owned),
            action,
        })
    }
}
impl Extension for Adapter {
    fn id(&self) -> &'static str {
        "com.tezbar.native.text-differ"
    }
    fn version(&self) -> &'static str {
        env!("CARGO_PKG_VERSION")
    }
    fn commands(&self) -> &'static [&'static str] {
        &[COMMAND]
    }
    fn handle<'a>(
        &'a self,
        ctx: &'a ExtensionContext,
        command: &'a str,
        operation: &'a str,
        payload: &'a Value,
        state: &'a mut Value,
    ) -> BoxFuture<'a, CoreResult> {
        Box::pin(async move {
            if command != COMMAND {
                return Err("Unknown command".into());
            }
            let id = payload["sessionId"].as_str().ok_or("Missing sessionId")?;
            if id.is_empty() || id.len() > 256 {
                return Err("SessionId must be 1..256 bytes".into());
            }
            match operation {
                "extension:dispose-session" => {
                    self.sessions.lock().unwrap().remove(id);
                    Ok(unchanged())
                }
                "extension:run-command" => {
                    {
                        let mut registry = self.sessions.lock().unwrap();
                        if registry.len() >= 128 || registry.contains_key(id) {
                            return Err("Session exists/session limit reached".into());
                        }
                        registry.insert(id.into(), Authority::default());
                    }
                    // The SDK owns this one pending cleanup future. Its captured
                    // guard drops even if the future is never polled. Canceled opens,
                    // disposal, EOF and shutdown abort it; no timer/poll/background lease.
                    let guard = SessionGuard {
                        sessions: self.sessions.clone(),
                        id: id.into(),
                    };
                    ctx.spawn(async move {
                        let _guard = guard;
                        std::future::pending::<()>().await;
                    })?;
                    Ok(self.compare(ctx, None).await.stage(state))
                }
                "extension:refresh-session" => Ok(self.current(id, state)?.stage(state)),
                "extension:search-text-changed" | "extension:load-more" => Ok(unchanged()),
                "extension:invoke-action" => {
                    // Only the SDK-committed screen may authorize an action. A
                    // canceled ordinary read cannot install a new copyable snapshot.
                    let screen = Screen::from_state(state)?;
                    let token = payload["actionId"].as_str().ok_or("Missing actionId")?;
                    let action = screen
                        .action
                        .as_ref()
                        .filter(|(id, _, _)| id == token)
                        .ok_or("Stale action. Use the current action or reopen the command.")?
                        .2
                        .clone();
                    let recovery = match &action {
                        Action::Compare(paths) => self.error(
                            "Comparison interrupted. Retry when the selected files are stable.",
                            paths.clone(),
                        ),
                        Action::Copy(text) => {
                            let mut recovery = screen.clone();
                            recovery.message=Some("Could not confirm clipboard completion. Copy completion is uncertain. Retry Copy Diff explicitly to write the same prepared snapshot again.".into());
                            recovery.action = Some((
                                self.token(),
                                "Retry Copy Diff".into(),
                                Action::Copy(text.clone()),
                            ));
                            recovery
                        }
                    };
                    {
                        let mut registry = self.sessions.lock().unwrap();
                        let authority =
                            registry.get_mut(id).ok_or("Session is no longer current")?;
                        if authority.consumed.as_deref() == Some(token) {
                            return Err("Stale or already consumed action. Refresh the current view or reopen the command.".into());
                        }
                        // This is deliberately not rolled back by staged-state cancel.
                        authority.consumed = Some(token.into());
                        authority.recovery = Some(recovery.clone());
                    }
                    match action {
                        Action::Compare(paths) => Ok(self.compare(ctx, paths).await.stage(state)),
                        Action::Copy(text) => {
                            let ack = ctx
                                .host("host.clipboard.write", json!({"text":text.as_ref()}))
                                .await
                                .and_then(clipboard_ack);
                            let mut next = recovery;
                            if ack.is_ok() {
                                next.message = Some("Copied to clipboard".into());
                                next.action =
                                    Some((self.token(), "Copy Diff".into(), Action::Copy(text)));
                            }
                            Ok(next.stage(state))
                        }
                    }
                }
                _ => Err("Unsupported operation".into()),
            }
        })
    }
    fn shutdown<'a>(&'a self, _ctx: &'a ExtensionContext) -> BoxFuture<'a, CoreResult> {
        Box::pin(async move {
            self.sessions.lock().unwrap().clear();
            Ok(json!({"ok":true}))
        })
    }
}
#[cfg(test)]
mod tests {
    #[test]
    fn platform_specific_filenames_match_node_basename() {
        assert_eq!(
            super::basename("C:\\Users\\fixture\\left.txt", "windows"),
            "left.txt"
        );
        assert_eq!(
            super::basename("\\\\server\\share\\right.txt", "Windows"),
            "right.txt"
        );
        assert_eq!(
            super::basename("/fixture/back\\slash.txt", "macos"),
            "back\\slash.txt"
        );
    }
}
