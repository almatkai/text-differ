import { Action, ActionPanel, Detail, getSelectedFinderItems } from "@raycast/api";
import { diffLines } from "diff";
import { promises as fs } from "node:fs";
import path from "node:path";
import { useEffect, useState } from "react";

function fenced(value: string): string {
  return value.replace(/```/g, "` ` `");
}

export default function Command() {
  const [markdown, setMarkdown] = useState("Loading selected files…");
  const [plainDiff, setPlainDiff] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const selected = await getSelectedFinderItems();
        if (selected.length !== 2) {
          setMarkdown("# Select exactly two files\n\nChoose two text files in Finder or File Explorer, then run this command again.");
          return;
        }

        const [left, right] = selected;
        const [leftText, rightText] = await Promise.all([
          fs.readFile(left.path, "utf8"),
          fs.readFile(right.path, "utf8"),
        ]);
        const changes = diffLines(leftText, rightText);
        const rendered = changes
          .map((change) => `${change.added ? "+" : change.removed ? "-" : " "}${change.value}`)
          .join("");
        setPlainDiff(rendered);
        setMarkdown(
          `# ${path.basename(left.path)} ↔ ${path.basename(right.path)}\n\n` +
            `\`\`\`diff\n${fenced(rendered)}\n\`\`\``,
        );
      } catch (error) {
        setMarkdown(`# Could not compare files\n\n${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }, []);

  return (
    <Detail
      markdown={markdown}
      actions={
        plainDiff ? (
          <ActionPanel>
            <Action.CopyToClipboard title="Copy Diff" content={plainDiff} />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}
