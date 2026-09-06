import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Rulebook } from "../../src/rulebook/rulebook.js";
import { toDiskSnapshot, toPolicyRulebookSnapshot, writeSnapshotFile } from "../../src/rulebook/snapshot.js";

describe("rulebook snapshot serialization", () => {
  it("maps camelCase in-memory fields to the frozen snake_case on-disk field list", () => {
    const rb = new Rulebook();
    const rule = rb.proposeCandidate(1, {
      type: "authorship_signal",
      conditions: [{ feature: "authorAssociation", operator: "equals", value: "NONE" }],
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 5,
      successCount: 5,
      failureCount: 0,
    });
    rb.consolidate(1);
    const metrics = rb.computeMetrics(1, 5);
    const snapshot = rb.toVersionSnapshot("V1", 1, metrics);
    const disk = toDiskSnapshot(snapshot);

    const diskRule = disk.rules.find((r) => r.id === rule.id)!;
    expect(diskRule.recommended_behavior).toBe("RESOLVED_COMPLETED");
    expect(diskRule.support_count).toBe(5);
    expect(diskRule.success_count).toBe(5);
    expect(diskRule.failure_count).toBe(0);
    expect(diskRule.contradiction_count).toBe(0);
    expect(diskRule.created_round).toBe(1);
    expect(diskRule.updated_round).toBe(1);
    expect(diskRule.status).toBe("active");

    expect(disk.metrics.examples_seen).toBe(5);
    expect(disk.metrics.active_rules).toBe(1);
    expect(disk.metrics.candidate_rules).toBe(0);
    expect(disk.metrics.retired_rules).toBe(0);
    expect(disk.metrics.compression_ratio).toBeCloseTo(5);

    const prov = disk.provenance[rule.id]!;
    expect(prov.created_from_round).toBe(1);
    expect(prov.evidence_example_count).toBe(5);
    expect(prov.source_rule_ids).toEqual([]);
  });

  it("writes a version snapshot file to disk under <dir>/<version>.json", () => {
    const rb = new Rulebook();
    rb.proposeCandidate(1, {
      type: "content_shape_signal",
      conditions: [{ feature: "hasQuestionMark", operator: "truthy" }],
      recommendedBehavior: "RESOLVED_NO_NEW_WORK",
      supportCount: 4,
      successCount: 3,
      failureCount: 1,
    });
    const dir = mkdtempSync(path.join(tmpdir(), "rulebook-snapshot-"));
    try {
      const file = writeSnapshotFile(dir, rb.toVersionSnapshot("V1", 1, rb.computeMetrics(1, 4)));
      expect(file).toBe(path.join(dir, "V1.json"));
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      expect(parsed.version).toBe("V1");
      expect(parsed.round).toBe(1);
      expect(Array.isArray(parsed.rules)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("projects only ACTIVE rules to the frozen contracts.RulebookSnapshot shape (for A2 plumbing)", () => {
    const rb = new Rulebook();
    const active = rb.proposeCandidate(1, {
      type: "authorship_signal",
      conditions: [{ feature: "authorAssociation", operator: "equals", value: "NONE" }],
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 5,
      successCount: 5,
      failureCount: 0,
    });
    rb.proposeCandidate(1, {
      type: "content_shape_signal",
      conditions: [{ feature: "bodyLengthBucket", operator: "equals", value: "short" }],
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 1,
      successCount: 1,
      failureCount: 0,
    }); // stays candidate — not enough support to promote
    rb.consolidate(1);

    const policySnapshot = toPolicyRulebookSnapshot(rb.getRules());
    expect(policySnapshot.version).toBe("V3");
    expect(policySnapshot.rules).toHaveLength(1);
    expect(policySnapshot.rules[0]!.id).toBe(active.id);
    expect(policySnapshot.rules[0]!.recommendedBehavior).toBe("RESOLVED_COMPLETED");
  });
});
