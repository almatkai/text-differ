function normalizeActionTitle(typeName, props) {
  if (typeof props.title === "string" && props.title.trim().length > 0) {
    return props.title.trim();
  }
  switch (typeName) {
    case "Action.CopyToClipboard":
      return "Copy to Clipboard";
    case "Action.Paste":
      return "Paste";
    case "Action.OpenInBrowser":
      return "Open in Browser";
    case "Action.Push":
      return "Open";
    case "Action.Pop":
      return "Back";
    case "Action.ShowInFinder":
      return "Show in Finder";
    case "Action.SubmitForm":
      return "Submit";
    default:
      return "Action";
  }
}
function stableActionId(index, typeName, title) {
  const hash = (0, import_node_crypto2.createHash)("sha1").update(`${index}:${typeName}:${title}`).digest("hex").slice(0, 12);
  return `ext-action-${index}-${hash}`;
}
function parseShortcut(shortcut) {
  if (!shortcut || typeof shortcut !== "object") return void 0;
  const s = shortcut;
  const modifiers = Array.isArray(s.modifiers) ? s.modifiers.filter((m) => typeof m === "string") : void 0;
  const key = typeof s.key === "string" ? s.key : void 0;
  if (!modifiers && !key) return void 0;
  return { modifiers, key };
}
function pushEffect(session, effect) {
  session.effects.push(effect);
  if (session.effects.length > 50) {
    session.effects.splice(0, session.effects.length - 50);
  }
}
async function copyToSystemClipboard(session, value) {
  const effectValue = typeof value === "string" ? value : value && typeof value === "object" ? String(
    value.text ?? value.file ?? ""
  ) : String(value ?? "");
  pushEffect(session, { kind: "clipboard", value: effectValue.slice(0, 2e3) });
  if (session.effectMode === "record") return;
  await copyClipboardContent(value);
}
function registerAction(typeName, props, session) {
  const index = session.currentActions.length;
  const title = normalizeActionTitle(typeName, props);
  const id = stableActionId(index, typeName, title);
  const kind = typeName === "Action.CopyToClipboard" || typeName === "Action.Paste" ? "copy" : typeName === "Action.OpenInBrowser" ? "open" : typeName === "Action.Push" ? "push" : typeName === "Action.Pop" ? "pop" : typeName === "Action.SubmitForm" ? "submit-form" : typeName === "Action.ShowInFinder" ? "show-in-finder" : "action";
  const style = typeof props.style === "string" && props.style.toLowerCase() === "destructive" ? "destructive" : "default";
  const action = {
    id,
    title,
    style,
    shortcut: parseShortcut(props.shortcut),
    kind
  };
  session.currentActions.push(action);
  const handler = async (formValues) => {
    if (kind === "copy") {
      const content = props.content ?? props.title ?? "";
      await copyToSystemClipboard(session, content);
      if (typeName === "Action.Paste" && session.effectMode !== "record") await pasteClipboardContent();
      const callback = typeName === "Action.Paste" ? props.onPaste : props.onCopy;
      if (typeof callback === "function") await Promise.resolve(callback());
    }
    if (kind === "open") {
      const url = typeof props.url === "string" ? props.url : "";
      if (url) {
        pushEffect(session, { kind: "open", value: url });
        if (session.effectMode !== "record") await shell.openExternal(url);
        if (typeof props.onOpen === "function") await Promise.resolve(props.onOpen());
      }
    }
    if (kind === "show-in-finder") {
      const path4 = typeof props.path === "string" ? props.path : "";
      if (path4) {
        pushEffect(session, { kind: "show-in-finder", value: path4 });
        if (session.effectMode !== "record") shell.showItemInFolder(path4);
      }
    }
    if (kind === "push" && props.target !== void 0) {
      session.stack.push(props.target);
    }
    if (kind === "pop") {
      if (session.stack.length > 1) {
        session.stack.pop();
      }
    }
    if (kind === "submit-form" && typeof props.onSubmit === "function") {
      await Promise.resolve(
        props.onSubmit(formValues ?? {})
      );
      return;
    }
    if (typeof props.onAction === "function") {
      const event = typeName === "MenuBarExtra.Item" ? { type: "left-click" } : void 0;
      await Promise.resolve(props.onAction(event));
    }
  };
  session.actionHandlers.set(id, handler);
}
