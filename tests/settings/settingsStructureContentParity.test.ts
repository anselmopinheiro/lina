import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  captureDeclarativeSettingsParityManifest,
  type DeclarativeSettingsParityManifest,
  type SettingsParityUnit,
} from "./declarativeSettingsParityManifest";
import {
  captureImperativeSettings,
  installImperativeSettingsInstrumentation,
  restoreImperativeSettingsInstrumentation,
} from "./imperativeSettingsParityCapture";
import type { ImperativeSettingsManifest } from "./imperativeSettingsParityHarness";

type ParityFindingType =
  | "PARITY-MISSING-IMPERATIVE"
  | "PARITY-MISSING-CANDIDATE"
  | "PARITY-CONTROL-KIND";

interface ParityFinding {
  id: string;
  type: ParityFindingType;
  imperative: string;
  candidate: string;
  impact: "material";
  recommendation: string;
}

const normaliseText = (value: string | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();

function setting(manifest: ImperativeSettingsManifest, name: string, section: string) {
  return manifest.items.find((item) => item.kind === "setting" && item.name === name && item.section === section);
}

function content(manifest: ImperativeSettingsManifest, text: string, section: string) {
  return manifest.items.find((item) => item.kind === "content" && item.section === section && normaliseText(item.text) === normaliseText(text));
}

function candidateItem(manifest: DeclarativeSettingsParityManifest, id: string) {
  const item = manifest.items.find((entry) => entry.id === id);
  if (!item) throw new Error(`Missing candidate item ${id}.`);
  return item;
}

function primaryUnit(manifest: DeclarativeSettingsParityManifest, id: string): SettingsParityUnit {
  const unit = candidateItem(manifest, id).units[0];
  if (!unit) throw new Error(`Candidate item ${id} has no rendered unit.`);
  return unit;
}

/**
 * Small, explicit C2 report: it records real divergences instead of assigning
 * synthetic imperative IDs or treating them as aliases.
 */
function collectMaterialFindings(
  imperative: ImperativeSettingsManifest,
  candidate: DeclarativeSettingsParityManifest,
): ParityFinding[] {
  const strings = getStrings("pt-PT");
  const findings: ParityFinding[] = [];
  if (!content(imperative, strings.settingsDeviceDescription, strings.settingsDeviceSection)) {
    findings.push({
      id: "device-description",
      type: "PARITY-MISSING-IMPERATIVE",
      imperative: "device description paragraph",
      candidate: "no candidate definition",
      impact: "material",
      recommendation: "Add a detached informational candidate definition, or remove the imperative paragraph in a later approved phase.",
    });
  } else {
    findings.push({
      id: "device-description",
      type: "PARITY-MISSING-CANDIDATE",
      imperative: strings.settingsDeviceDescription,
      candidate: "no candidate definition",
      impact: "material",
      recommendation: "Add a detached informational candidate definition, or remove the imperative paragraph in a later approved phase.",
    });
  }

  const supportDescription = primaryUnit(candidate, "support-description");
  if (!content(imperative, supportDescription.description, strings.settingsSupportSection)) {
    findings.push({
      id: "support-description",
      type: "PARITY-MISSING-IMPERATIVE",
      imperative: "no support description paragraph",
      candidate: normaliseText(supportDescription.description),
      impact: "material",
      recommendation: "Add the support description to the imperative UI, or remove the candidate definition in a later approved phase.",
    });
  }

  for (const [id, section] of [["analysis-credential", strings.settingsAnalysisSection], ["embeddings-credential", strings.settingsEmbeddingsSection]] as const) {
    const imperativeCredential = setting(imperative, strings.settingsApiKey, section);
    const candidateCredential = primaryUnit(candidate, id);
    if (!imperativeCredential || imperativeCredential.controlKinds.join(",") !== candidateCredential.controlKinds.join(",")) {
      findings.push({
        id,
        type: "PARITY-CONTROL-KIND",
        imperative: imperativeCredential?.controlKinds.join(",") ?? "missing",
        candidate: candidateCredential.controlKinds.join(","),
        impact: "material",
        recommendation: "Reconcile the credential interaction shape only in the later controls/persistence parity phase.",
      });
    }
  }

  const binaryStatus = primaryUnit(candidate, "binary-status");
  const imperativeBinaryReadDiagnostics = imperative.items.filter((item) => item.kind === "content" && item.section === strings.settingsBinarySection && [strings.settingsBinaryConfiguredPreference, strings.settingsBinaryEffectiveSource].some((prefix) => normaliseText(item.text).startsWith(`${prefix}:`)));
  if (binaryStatus.description && imperativeBinaryReadDiagnostics.length > 0) {
    findings.push({
      id: "binary-read-diagnostics",
      type: "PARITY-MISSING-CANDIDATE",
      imperative: imperativeBinaryReadDiagnostics.map((item) => normaliseText(item.text)).join(" | "),
      candidate: normaliseText(binaryStatus.description),
      impact: "material",
      recommendation: "Model the additional binary diagnostic rows explicitly before a cutover; do not fold them into an unrelated status definition.",
    });
  }
  return findings;
}

beforeEach(() => {
  installImperativeSettingsInstrumentation();
});

afterEach(() => {
  restoreImperativeSettingsInstrumentation();
});

describe("settings structure and content parity", () => {
  it("derives deterministic, serializable, secret-free manifests from the two real sources", () => {
    const imperative = captureImperativeSettings().manifest;
    const firstCandidate = captureDeclarativeSettingsParityManifest();
    const secondCandidate = captureDeclarativeSettingsParityManifest();
    const serialized = JSON.stringify({ imperative, candidate: firstCandidate });

    expect(imperative.items).toHaveLength(59);
    expect(firstCandidate.groups).toHaveLength(12);
    expect(firstCandidate.items).toHaveLength(46);
    expect(firstCandidate).toEqual(secondCandidate);
    expect(JSON.parse(serialized)).toEqual({ imperative, candidate: firstCandidate });
    for (const forbidden of ["SUPER_SECRET_SENTINEL", "Authorization", "Bearer", "harness-device"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it("keeps the real 1:N compositions explicit without invoking callbacks", () => {
    const candidate = captureDeclarativeSettingsParityManifest();
    const strings = getStrings("pt-PT");

    expect(candidateItem(candidate, "analysis-model").units.map((unit) => unit.name)).toEqual([strings.settingsModel, strings.settingsManualModel]);
    expect(candidateItem(candidate, "embeddings-model").units.map((unit) => unit.name)).toEqual([strings.settingsModel, strings.settingsManualModel, undefined]);
    expect(["check-binary-copy", "create-or-update-binary-copy", "remove-binary-copy"].map((id) => primaryUnit(candidate, id).buttonLabels)).toEqual([
      [strings.settingsBinaryCheck],
      [strings.settingsBinaryCreate],
      [strings.settingsBinaryRemove],
    ]);
  });

  it("classifies the material C2 divergences rather than hiding them behind aliases", () => {
    const imperative = captureImperativeSettings().manifest;
    const candidate = captureDeclarativeSettingsParityManifest();
    const findings = collectMaterialFindings(imperative, candidate);

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "device-description", type: "PARITY-MISSING-CANDIDATE" }),
      expect.objectContaining({ id: "support-description", type: "PARITY-MISSING-IMPERATIVE" }),
      expect.objectContaining({ id: "analysis-credential", type: "PARITY-CONTROL-KIND", imperative: "text", candidate: "text,button" }),
      expect.objectContaining({ id: "embeddings-credential", type: "PARITY-CONTROL-KIND", imperative: "text", candidate: "text,button" }),
      expect.objectContaining({ id: "binary-read-diagnostics", type: "PARITY-MISSING-CANDIDATE" }),
    ]));
    expect(findings.every((finding) => finding.impact === "material")).toBe(true);
  });
});
