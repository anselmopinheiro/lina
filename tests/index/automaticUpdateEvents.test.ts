import { describe, expect, it } from "vitest";
import {
  AutomaticUpdateEvent,
  buildStartupReconciliationPlan,
  coalesceAutomaticUpdateEvent,
  getInternalAutomaticUpdateIgnoreReason,
  getVaultEventPath,
  getVaultRenameOldPath,
  isMarkdownPath,
  normalizeAutomaticUpdatePath,
} from "../../src/index/automaticUpdateEvents";

function fileLike(path: unknown): unknown {
  return { path };
}

function coalesce(events: AutomaticUpdateEvent[]): Map<string, AutomaticUpdateEvent> {
  const pending = new Map<string, AutomaticUpdateEvent>();
  for (const event of events) {
    coalesceAutomaticUpdateEvent(pending, event);
  }
  return pending;
}

describe("automatic update vault event path extraction", () => {
  it("extracts file.path for create events", () => {
    expect(getVaultEventPath(fileLike("Inbox/new.md"))).toBe("Inbox/new.md");
  });

  it("extracts file.path for modify events", () => {
    expect(getVaultEventPath(fileLike("Inbox/edit.md"))).toBe("Inbox/edit.md");
  });

  it("extracts file.path for delete events", () => {
    expect(getVaultEventPath(fileLike("Inbox/delete.md"))).toBe("Inbox/delete.md");
  });

  it("extracts new path and old path for rename events", () => {
    expect(getVaultEventPath(fileLike("Inbox/new-name.md"))).toBe("Inbox/new-name.md");
    expect(getVaultRenameOldPath("Inbox/old-name.md")).toBe("Inbox/old-name.md");
  });

  it("ignores events without an object", () => {
    expect(getVaultEventPath(undefined)).toBeNull();
  });

  it("ignores events without file.path", () => {
    expect(getVaultEventPath({})).toBeNull();
  });

  it("ignores events with path undefined", () => {
    expect(getVaultEventPath(fileLike(undefined))).toBeNull();
  });

  it("ignores events with an empty path", () => {
    expect(getVaultEventPath(fileLike("   "))).toBeNull();
  });

  it("normalizes backslashes in paths", () => {
    expect(normalizeAutomaticUpdatePath("Folder\\note.md")).toBe("Folder/note.md");
  });

  it("recognizes Markdown paths case-insensitively", () => {
    expect(isMarkdownPath("Folder/NOTE.MD")).toBe(true);
  });
});

describe("automatic update internal path filtering", () => {
  const options = { configDir: ".obsidian", pluginId: "lina" };

  it("ignores .lina paths", () => {
    expect(getInternalAutomaticUpdateIgnoreReason(".lina/state.json", options)).toBe("internal-path");
  });

  it("ignores .obsidian paths", () => {
    expect(getInternalAutomaticUpdateIgnoreReason(".obsidian/workspace.json", options)).toBe("internal-path");
  });

  it("ignores plugin folder paths", () => {
    expect(getInternalAutomaticUpdateIgnoreReason(".obsidian/plugins/lina/main.js", options)).toBe("internal-path");
  });

  it("ignores manifest.json writes in .lina/index", () => {
    expect(getInternalAutomaticUpdateIgnoreReason(".lina/index/manifest.json", options)).toBe("internal-path");
  });

  it("ignores notes.json writes in .lina/index", () => {
    expect(getInternalAutomaticUpdateIgnoreReason(".lina/index/notes.json", options)).toBe("internal-path");
  });

  it("ignores chunks.jsonl writes in .lina/index", () => {
    expect(getInternalAutomaticUpdateIgnoreReason(".lina/index/chunks.jsonl", options)).toBe("internal-path");
  });

  it("ignores temporary files", () => {
    expect(getInternalAutomaticUpdateIgnoreReason("Inbox/note.md.tmp-123", options)).toBe("temporary-file");
  });

  it("ignores backup files", () => {
    expect(getInternalAutomaticUpdateIgnoreReason("Inbox/note.md.bak-123", options)).toBe("temporary-file");
  });

  it("ignores .tmp extension files", () => {
    expect(getInternalAutomaticUpdateIgnoreReason("Inbox/note.tmp", options)).toBe("temporary-file");
  });

  it("allows ordinary Markdown note paths", () => {
    expect(getInternalAutomaticUpdateIgnoreReason("Inbox/note.md", options)).toBeNull();
  });
});

describe("automatic update event coalescing", () => {
  it("coalesces multiple modify events for the same path", () => {
    const pending = coalesce([
      { changeType: "modify", path: "Inbox/a.md" },
      { changeType: "modify", path: "Inbox/a.md" },
    ]);
    expect(pending.size).toBe(1);
    expect(pending.get("Inbox/a.md")?.changeType).toBe("modify");
  });

  it("keeps create when create is followed by modify", () => {
    const pending = coalesce([
      { changeType: "create", path: "Inbox/a.md" },
      { changeType: "modify", path: "Inbox/a.md" },
    ]);
    expect(pending.size).toBe(1);
    expect(pending.get("Inbox/a.md")?.changeType).toBe("create");
  });

  it("keeps delete when modify is followed by delete", () => {
    const pending = coalesce([
      { changeType: "modify", path: "Inbox/a.md" },
      { changeType: "delete", path: "Inbox/a.md" },
    ]);
    expect(pending.size).toBe(1);
    expect(pending.get("Inbox/a.md")?.changeType).toBe("delete");
  });

  it("preserves oldPath and new path for rename", () => {
    const pending = coalesce([
      { changeType: "rename", path: "Inbox/new.md", oldPath: "Inbox/old.md" },
    ]);
    const event = pending.get("Inbox/old.md");
    expect(event?.oldPath).toBe("Inbox/old.md");
    expect(event?.path).toBe("Inbox/new.md");
  });

  it("coalesces events on different paths into one pending batch map", () => {
    const pending = coalesce([
      { changeType: "modify", path: "Inbox/a.md" },
      { changeType: "modify", path: "Inbox/b.md" },
    ]);
    expect(pending.size).toBe(2);
  });

  it("does not add invalid missing-path events before coalescing", () => {
    const pending = new Map<string, AutomaticUpdateEvent>();
    const path = getVaultEventPath(fileLike(undefined));
    if (path) {
      coalesceAutomaticUpdateEvent(pending, { changeType: "create", path });
    }
    expect(pending.size).toBe(0);
  });

  it("keeps pending size compact for repeated startup-like events on one path", () => {
    const events = Array.from({ length: 1255 }, () => ({ changeType: "modify" as const, path: "Inbox/a.md" }));
    expect(coalesce(events).size).toBe(1);
  });
});

describe("startup reconciliation planning", () => {
  const note = (path: string, mtime: number, size: number = 100) => ({ path, mtime, size });

  it("detects no differences when vault and index match", () => {
    const notes = [note("Inbox/a.md", 100), note("Inbox/b.md", 200)];
    const plan = buildStartupReconciliationPlan(notes, notes);

    expect(plan).toEqual({ events: [], newCount: 0, modifiedCount: 0, deletedCount: 0 });
  });

  it("detects a note created while Obsidian was closed", () => {
    const plan = buildStartupReconciliationPlan(
      [note("Inbox/existing.md", 100), note("Inbox/new.md", 200)],
      [note("Inbox/existing.md", 100)]
    );

    expect(plan.events).toEqual([{ changeType: "create", path: "Inbox/new.md" }]);
    expect(plan.newCount).toBe(1);
  });

  it("detects a note modified by mtime or size", () => {
    const plan = buildStartupReconciliationPlan(
      [note("Inbox/mtime.md", 200), note("Inbox/size.md", 100, 200)],
      [note("Inbox/mtime.md", 100), note("Inbox/size.md", 100, 100)]
    );

    expect(plan.events).toEqual([
      { changeType: "modify", path: "Inbox/mtime.md" },
      { changeType: "modify", path: "Inbox/size.md" },
    ]);
    expect(plan.modifiedCount).toBe(2);
  });

  it("detects a note deleted while Obsidian was closed", () => {
    const plan = buildStartupReconciliationPlan([], [note("Inbox/deleted.md", 100)]);

    expect(plan.events).toEqual([{ changeType: "delete", path: "Inbox/deleted.md" }]);
    expect(plan.deletedCount).toBe(1);
  });

  it("represents an offline rename deterministically as delete plus create", () => {
    const plan = buildStartupReconciliationPlan(
      [note("Inbox/new-name.md", 100)],
      [note("Inbox/old-name.md", 100)]
    );

    expect(plan.events).toEqual([
      { changeType: "delete", path: "Inbox/old-name.md" },
      { changeType: "create", path: "Inbox/new-name.md" },
    ]);
  });

  it("deletes every indexed note when the vault is empty", () => {
    const plan = buildStartupReconciliationPlan(
      [],
      [note("Inbox/b.md", 200), note("Inbox/a.md", 100)]
    );

    expect(plan.events).toEqual([
      { changeType: "delete", path: "Inbox/a.md" },
      { changeType: "delete", path: "Inbox/b.md" },
    ]);
  });

  it("produces one deterministic event per changed path in a large vault", () => {
    const indexed = Array.from({ length: 5000 }, (_, index) => note(`Notes/${index}.md`, index));
    const vault = indexed.map((item) => ({ ...item }));
    vault[100].mtime++;
    vault.push(note("Notes/new.md", 6000));
    const withoutDeleted = vault.filter((item) => item.path !== "Notes/200.md");

    const plan = buildStartupReconciliationPlan(withoutDeleted, indexed);
    const uniquePaths = new Set(plan.events.map((event) => event.path));

    expect(plan.events).toHaveLength(3);
    expect(uniquePaths.size).toBe(3);
    expect(plan).toMatchObject({ newCount: 1, modifiedCount: 1, deletedCount: 1 });
  });

  it("queues all differences into a single compact pending map", () => {
    const plan = buildStartupReconciliationPlan(
      [note("Inbox/new.md", 300), note("Inbox/modified.md", 300)],
      [note("Inbox/deleted.md", 100), note("Inbox/modified.md", 100)]
    );
    const pending = coalesce(plan.events);

    expect(pending.size).toBe(3);
    expect([...pending.values()]).toEqual(plan.events);
  });
});
