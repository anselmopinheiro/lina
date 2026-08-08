import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import { createDeclarativeSettingsBinaryBindings } from "../../src/settings/declarativeSettingsBinaryBindings";
import { createDeclarativeSettingsBinaryRenderers } from "../../src/settings/declarativeSettingsBinaryRenderers";
import { createDeclarativeSettingsLifecycleController } from "../../src/settings/declarativeSettingsLifecycleController";
import type { PureBinaryResult } from "../../src/settings/pureSettingsAsyncActions";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function createBinaryFactory(initial: PureBinaryResult | undefined = { status: "absent" }, ownerPrefix = "candidate-a") {
  const lifecycle = createDeclarativeSettingsLifecycleController({ requestHostUpdate() {}, scheduleUpdate() {} });
  const check = deferred<PureBinaryResult>();
  const create = deferred<PureBinaryResult>();
  const removal = deferred<void>();
  const calls: string[] = [];
  let confirmed = true;
  const bindings = createDeclarativeSettingsBinaryBindings({
    lifecycle,
    getCurrentStatus: () => initial,
    check() { calls.push("check"); return check.promise; },
    createOrUpdate() { calls.push("create"); return create.promise; },
    remove() { calls.push("remove"); return removal.promise; },
    async confirmRemove() { calls.push("confirm"); return confirmed; },
    getReadPreference: () => "jsonl",
    getMaintainBinaryCopy: () => false,
  });
  const renderers = createDeclarativeSettingsBinaryRenderers({
    bindings,
    strings: getStrings("en"),
    ownerPrefix,
  });
  return {
    lifecycle, bindings, renderers, check, create, removal, calls,
    setConfirmed(value: boolean) { confirmed = value; },
  };
}

function createSettingDouble() {
  const calls: { name?: string; elements: Array<{ tag: string; options: Record<string, unknown> }> } = { elements: [] };
  const setting = {
    setName(value: string) { calls.name = value; return setting; },
    descEl: {
      createEl(tag: string, options: Record<string, unknown>) {
        const element = { tag, options: { ...options } };
        calls.elements.push(element);
        return { setText(value: string) { element.options.text = value; } };
      },
    },
  };
  return { calls, setting };
}

describe("candidate binary renderer factory", () => {
  it("renders every public binary status with normalized safe feedback", () => {
    const statuses: Array<PureBinaryResult | undefined> = [
      undefined,
      { status: "disabled" }, { status: "absent" }, { status: "valid" }, { status: "outdated" },
      { status: "incomplete" }, { status: "invalid" }, { status: "unsupported" }, { status: "error" },
      { status: "outdated", reasonCode: "legacy-manifest" },
    ];
    for (const status of statuses) {
      const test = createBinaryFactory(status);
      const rendered = createSettingDouble();
      test.renderers.createBinaryStatusRenderer()(rendered.setting as never, {} as never);
      expect(rendered.calls.name).toBe(getStrings("en").settingsBinaryStatus);
      expect(rendered.calls.elements[0].options.attr).toEqual({ "aria-live": "polite" });
      expect(JSON.stringify(rendered.calls)).not.toContain("SUPER_SECRET_SENTINEL");
      expect(JSON.stringify(test.renderers.getDiagnosticSnapshot())).not.toContain("SUPER_SECRET_SENTINEL");
    }
    const legacy = createBinaryFactory({ status: "outdated", reasonCode: "legacy-manifest" });
    const rendered = createSettingDouble();
    legacy.renderers.createBinaryStatusRenderer()(rendered.setting as never, {} as never);
    expect(rendered.calls.elements[0].options.text).toContain(getStrings("en").settingsBinaryStatusLegacyManifest);
  });

  it("delegates check, create, and remove to one injected binding with binary-domain exclusion", async () => {
    const test = createBinaryFactory();
    const check = test.renderers.createCheckBinaryAction();
    const create = test.renderers.createCreateOrUpdateBinaryAction();
    const remove = test.renderers.createRemoveBinaryAction();

    check.run();
    expect(test.calls).toEqual(["check"]);
    expect(check.isDisabled()).toBe(true);
    expect(create.isDisabled()).toBe(true);
    expect(remove.isDisabled()).toBe(true);
    create.run();
    remove.run();
    expect(test.calls).toEqual(["check"]);
    test.check.resolve({ status: "valid" });
    await Promise.resolve();
    await Promise.resolve();

    create.run();
    expect(test.calls).toEqual(["check", "create"]);
    test.create.resolve({ status: "valid" });
    await Promise.resolve();
    await Promise.resolve();

    remove.run();
    await Promise.resolve();
    expect(test.calls).toEqual(["check", "create", "confirm", "remove"]);
    test.removal.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(test.bindings.getSnapshot()).toMatchObject({ status: "absent", feedback: "success", pending: false });
  });

  it("keeps cancellation inert, honors legacy blocking, and neutralizes invalidated work", async () => {
    const legacy = createBinaryFactory({ status: "outdated", reasonCode: "legacy-manifest" });
    const legacyCreate = legacy.renderers.createCreateOrUpdateBinaryAction();
    expect(legacyCreate.isDisabled()).toBe(true);
    legacyCreate.run();
    expect(legacy.calls).toEqual([]);

    const test = createBinaryFactory();
    const remove = test.renderers.createRemoveBinaryAction();
    test.setConfirmed(false);
    remove.run();
    await Promise.resolve();
    expect(test.calls).toEqual(["confirm"]);
    expect(test.bindings.getSnapshot()).toMatchObject({ pending: false, feedback: "idle" });

    const check = test.renderers.createCheckBinaryAction();
    check.run();
    test.bindings.invalidate();
    test.check.resolve({ status: "unsupported" });
    await Promise.resolve();
    await Promise.resolve();
    expect(test.bindings.getSnapshot()).toMatchObject({ status: "absent", pending: false, feedback: "idle" });
  });

  it("keeps factories independent and disposes only their local action facade", () => {
    const first = createBinaryFactory({ status: "absent" }, "candidate-first");
    const second = createBinaryFactory({ status: "valid" }, "candidate-second");
    const firstAction = first.renderers.createCheckBinaryAction();
    const secondAction = second.renderers.createCheckBinaryAction();
    first.renderers.dispose();
    first.renderers.dispose();
    firstAction.run();
    secondAction.run();

    expect(first.calls).toEqual([]);
    expect(second.calls).toEqual(["check"]);
    expect(first.renderers.getDiagnosticSnapshot()).toMatchObject({
      ownerIds: ["candidate-first-binary"], disposed: true, readiness: "DISPOSED",
    });
    expect(second.renderers.getDiagnosticSnapshot()).toMatchObject({
      ownerIds: ["candidate-second-binary"], disposed: false, readiness: "READY",
    });
    expect(first.lifecycle.isDisposed()).toBe(false);
    expect(createDeclarativeSettingsBinaryRenderers.toString()).not.toContain("createPureBinaryRuntime");
  });
});
