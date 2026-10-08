// AI evidence harness.
//
// Runs one labelled synthetic fixture through the product's own prompt
// builders, the product's own guards, and the product's own ranking math, and
// reports numbers. Deterministic by construction: the fixture is fixed, the
// metrics are pure functions, and nothing in this file reads a repository, a
// private folder, or an env value.
//
// Three tracks, one per AI role the placement note allows:
//
//   A  licence-unknown lookup   fetch      shared/licensing/lookup.ts
//   B  plain-word assist        summarize  shared/ai/deterministic.ts + validate.ts
//   C  reorder inside a band    assist     shared/adapters/decision.ts + priority.ts
//
// Run it three ways:
//
//   stub   no lane, deterministic. What the product does with no provider.
//   local  the local Ollama server on 127.0.0.1, free, nothing leaves the box.
//
//   node --experimental-strip-types scripts/ai-evidence/harness.mjs --lane=stub
//   LAUNCHSENSE_LOCAL_DECISION=1 node --experimental-strip-types \
//     scripts/ai-evidence/harness.mjs --lane=local --model=granite4:3b --reps=5 --assist-reps=5
//
// One rule the numbers must obey: a lane that did not answer is reported as not
// measured, never as a zero. A silent lane that scored zero would look like the
// best rung in the product.

import { writeFileSync } from "node:fs";

import { ASSIST_FIXTURE, GUARD_PROBES, REORDER_FIXTURE, licenseFixture } from "./fixture.mjs";
import {
  changedText,
  contentRetention,
  jargonRate,
  keepsAnchor,
  leaksPath,
  mean,
  readingEase,
  reorderMetrics,
  share,
  wordCount,
} from "./metrics.mjs";
import { LocalChatLane, keyPresence, localModels, localOllamaUp } from "./lanes.mjs";

// The product's own modules. Imported, never reimplemented, so a number here is
// a number about the shipped code.
import { buildExplainPrompt, deterministicPlan } from "../../shared/ai/deterministic.ts";
import { validateAiPlan } from "../../shared/ai/validate.ts";
import { classifyLookupAnswer, licenseLookupRefusal, suggestUnknownLicenses } from "../../shared/licensing/lookup.ts";
import { callAiLane } from "../../convex/adapters/ai.ts";
import { decide, looksLikeSecret } from "../../shared/adapters/decision.ts";
import { findingsToAsk, questionIdFor } from "../../shared/reports/priority.ts";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const LANE = flag("lane", "stub");
const REPS = Number(flag("reps", "3"));
const ASSIST_REPS = Number(flag("assist-reps", String(REPS)));
const CHAT_MODEL = flag("model", "ornith-9b:latest");
const OUT = flag("out", "");

// ---------------------------------------------------------------- track A

async function trackLicense(chat) {
  const { components, labels } = licenseFixture();

  // 1. The refusal path, which is the product's default. Nothing is asked and
  //    nothing is guessed, so every other row is read against this.
  const refusal = licenseLookupRefusal(components);
  const configured = chat !== null;
  const result = configured
    ? await suggestUnknownLicenses(components, { lane: await chat.lookupLane() })
    : licenseLookupRefusal(components);

  const rows = result.suggestions.map((s) => {
    const label = labels.get(`${s.name}@${s.version}`);
    return {
      name: s.name,
      version: s.version,
      bucket: label.bucket,
      labelId: label.id,
      labelConfidence: label.confidence,
      registryId: label.registryId,
      expression: label.expression,
      suggested: s.suggested,
      usable: s.usable,
      reason: s.reason,
      hit: label.id !== null && s.suggested === label.id,
      falseId: label.id === null && s.suggested !== null,
      refused: s.suggested === null,
    };
  });

  const byBucket = new Map();
  for (const row of rows) {
    const bucket = byBucket.get(row.bucket) ?? { n: 0, hit: 0, falseId: 0, refused: 0, usable: 0 };
    bucket.n += 1;
    if (row.hit) bucket.hit += 1;
    if (row.falseId) bucket.falseId += 1;
    if (row.refused) bucket.refused += 1;
    if (row.usable) bucket.usable += 1;
    byBucket.set(row.bucket, bucket);
  }

  const labelled = rows.filter((r) => r.labelId !== null);
  const unlabelled = rows.filter((r) => r.labelId === null);
  const usable = rows.filter((r) => r.usable);

  // 2. Guard probes on fixed strings. No lane is asked, so these say nothing
  //    about a model and everything about the refusal path.
  const probes = GUARD_PROBES.map((probe) => {
    const classified = classifyLookupAnswer(probe.answer);
    return {
      probeId: probe.id,
      refused: classified.id === null,
      expectedRefusal: probe.expectRefusal,
      matched: (classified.id === null) === probe.expectRefusal,
      resolved: classified.id,
      why: probe.why,
    };
  });

  return {
    fixtureComponents: components.length,
    lanes: {
      refusalPath: {
        configured: refusal.configured,
        asked: refusal.asked,
        suggestions: refusal.suggestions.length,
      },
      laneConfigured: configured,
      asked: result.asked,
      suggestions: result.suggestions.length,
    },
    knowledge: {
      labelled: labelled.length,
      hits: labelled.filter((r) => r.hit).length,
      accuracy: share(labelled.filter((r) => r.hit).length, labelled.length),
      unlabelled: unlabelled.length,
      falseIds: unlabelled.filter((r) => r.falseId).length,
      falseIdRate: share(unlabelled.filter((r) => r.falseId).length, unlabelled.length),
      // The number a reader is exposed to. An id that survives the whitelist is
      // shown to a person, so its precision is the product's number, not accuracy.
      usableSuggestions: usable.length,
      usableAndCorrect: usable.filter((r) => r.hit).length,
      usablePrecision: share(usable.filter((r) => r.hit).length, usable.length),
    },
    byBucket: Object.fromEntries(byBucket),
    guardProbes: {
      n: probes.length,
      matched: probes.filter((p) => p.matched).length,
      mismatched: probes.filter((p) => !p.matched).map((p) => p.probeId),
      probes,
    },
    rows,
  };
}

// ---------------------------------------------------------------- track B

async function trackAssist(chat, reps) {
  const findings = ASSIST_FIXTURE;
  const baseline = deterministicPlan(findings);
  const baselineByFp = new Map(baseline.explanations.map((e) => [e.fingerprint, e.plain]));
  const actionable = findings.filter((f) => f.severity !== "info");
  const info = findings.filter((f) => f.severity === "info");
  const anchorOf = new Map(findings.map((f) => [f.fingerprint, f.anchors]));
  const actionableFps = new Set(actionable.map((f) => f.fingerprint));

  const prompt = buildExplainPrompt(findings);
  // The product refuses before anything leaves the machine when the built
  // wording holds something key-shaped (convex/scans/aiExplain.ts).
  const secretShape = looksLikeSecret(prompt);

  // What the SHIPPED product does with no key configured. This is the real
  // behaviour of convex/adapters/ai.ts in this environment, not a stand-in.
  const shipped = await callAiLane(prompt);

  const runs = [];
  const perFindingRuns = [];
  let laneMsTotal = 0;

  for (let rep = 0; rep < reps; rep++) {
    let served = baseline;
    let accepted = false;
    let rejectionReason = null;
    let laneError = null;
    let laneFinish = null;
    let laneUsage = null;
    const started = Date.now();
    if (chat !== null && secretShape === null) {
      const call = await chat.complete(prompt);
      laneError = call.error;
      laneFinish = call.finishReason ?? null;
      laneUsage = call.usage ?? null;
      if (call.ok) {
        // The product's own acceptance rule, run unchanged on the model answer.
        const validated = validateAiPlan(call.json, findings);
        if (validated.ok) {
          accepted = true;
          served = validated.value;
        } else {
          // The designed outcome: the whole plan is dropped and the shipped
          // wording is what the reader gets.
          rejectionReason = validated.reason;
        }
      }
    }
    laneMsTotal += Date.now() - started;

    // The deterministic plan is also shaped {explanations, notActionable}, so a
    // naive read of `served` would count our own wording as model-written. This
    // flag comes from control flow, the way convex/scans/aiExplain.ts computes
    // providerCalled.
    const servedFps = new Set([
      ...served.explanations.map((e) => e.fingerprint),
      ...served.notActionable.map((e) => e.fingerprint),
    ]);

    const perFinding = findings.map((finding) => {
      const base = baselineByFp.get(finding.fingerprint) ?? null;
      const modelEntry = served.explanations.find((e) => e.fingerprint === finding.fingerprint) ?? null;
      const bucketEntry = served.notActionable.find((e) => e.fingerprint === finding.fingerprint) ?? null;
      const text = modelEntry?.plain ?? bucketEntry?.reason ?? null;
      return {
        fingerprint: finding.fingerprint,
        severity: finding.severity,
        actionable: finding.severity !== "info",
        modelWritten: accepted && modelEntry !== null,
        bucketed: bucketEntry !== null,
        baseline: base,
        served: text,
        changed: base === null || text === null ? false : changedText(base, text),
        anchorKept: text === null ? null : keepsAnchor(text, anchorOf.get(finding.fingerprint)),
        retention: base === null || text === null ? null : contentRetention(base, text),
        jargonBaseline: base === null ? null : jargonRate(base),
        jargonServed: text === null ? null : jargonRate(text),
        wordsBaseline: base === null ? null : wordCount(base),
        wordsServed: text === null ? null : wordCount(text),
        easeBaseline: base === null ? null : readingEase(base),
        easeServed: text === null ? null : readingEase(text),
        pathLeak: text !== null ? leaksPath(text) : false,
      };
    });
    perFindingRuns.push(perFinding);

    const scored = perFinding.filter((r) => r.baseline !== null && r.served !== null);
    runs.push({
      rep: rep + 1,
      laneError,
      laneFinish,
      laneUsage,
      accepted,
      rejectionReason,
      explanationsServed: served.explanations.length,
      notActionableServed: served.notActionable.length,
      duplicateEntries: served.explanations.length + served.notActionable.length - servedFps.size,
      actionableDropped: actionable.filter((f) => !servedFps.has(f.fingerprint)).length,
      // An info row explained as an action is a category error the validator does
      // not check, because its coverage rule only walks the actionable set.
      infoExplainedAsAction: served.explanations.filter((e) => !actionableFps.has(e.fingerprint)).length,
      rowsServed: scored.length,
      changed: scored.filter((r) => r.changed).length,
      anchorKept: scored.filter((r) => r.anchorKept === true).length,
      anchorLost: scored.filter((r) => r.anchorKept === false).length,
      pathLeaks: scored.filter((r) => r.pathLeak).length,
      retention: mean(scored.map((r) => r.retention)),
      jargonBaseline: mean(scored.map((r) => r.jargonBaseline)),
      jargonServed: mean(scored.map((r) => r.jargonServed)),
      easeBaseline: mean(scored.map((r) => r.easeBaseline)),
      easeServed: mean(scored.map((r) => r.easeServed)),
      wordsBaseline: mean(scored.map((r) => r.wordsBaseline)),
      wordsServed: mean(scored.map((r) => r.wordsServed)),
    });
  }

  const baselineAnchors = perFindingRuns[0].filter((r) => r.baseline !== null);
  const acceptedRuns = runs.filter((r) => r.accepted);
  const scoredTotal = runs.reduce((s, r) => s + r.rowsServed, 0);

  return {
    fixtureFindings: findings.length,
    actionable: actionable.length,
    info: info.length,
    reps,
    preflight: { secretShape, promptBytes: prompt.length },
    // The fixture's own sanity check. If the shipped wording failed the anchor
    // rule the label would be broken and every model score below would be measured
    // from an invalid base, so this number is reported beside the model's.
    baselineAnchorRecall: share(
      baselineAnchors.filter((r) => keepsAnchor(r.baseline, anchorOf.get(r.fingerprint))).length,
      baselineAnchors.length,
    ),
    shippedLane: {
      ok: shipped.ok,
      source: shipped.source,
      error: shipped.error,
      model: shipped.model,
    },
    modelLane:
      chat === null
        ? { configured: false }
        : {
            configured: true,
            model: CHAT_MODEL,
            errors: [...new Set(runs.map((r) => r.laneError))],
            finishReasons: [...new Set(runs.map((r) => r.laneFinish))],
            completionTokens: runs.map((r) => r.laneUsage?.completion_tokens ?? null),
          },
    summary: {
      runs: runs.length,
      accepted: acceptedRuns.length,
      acceptRate: share(acceptedRuns.length, runs.length),
      laneErrors: runs.map((r) => r.laneError),
      rejectionReasons: [...new Set(runs.map((r) => r.rejectionReason))],
      // What a reader actually got. A rejected plan means our wording.
      modelWrittenRows: runs.reduce((s, r) => s + r.changed, 0),
      totalRows: scoredTotal,
      changedShare: share(runs.reduce((s, r) => s + r.changed, 0), scoredTotal),
      actionableDroppedTotal: runs.reduce((s, r) => s + r.actionableDropped, 0),
      duplicateEntriesTotal: runs.reduce((s, r) => s + r.duplicateEntries, 0),
      infoExplainedAsAction: runs.reduce((s, r) => s + r.infoExplainedAsAction, 0),
      pathLeaks: runs.reduce((s, r) => s + r.pathLeaks, 0),
      laneMsTotal,
      laneMsPerRun: runs.map(() => 0),
    },
    writing: {
      rowsScoredPerRun: runs[0].rowsServed,
      jargonBaseline: runs[0].jargonBaseline,
      easeBaseline: runs[0].easeBaseline,
      wordsBaseline: runs[0].wordsBaseline,
      // Model numbers are averaged over accepted runs only. Averaging over a run
      // that fell back to our wording would dilute the model with our own text.
      jargonServedAccepted: acceptedRuns.length === 0 ? null : mean(acceptedRuns.map((r) => r.jargonServed)),
      easeServedAccepted: acceptedRuns.length === 0 ? null : mean(acceptedRuns.map((r) => r.easeServed)),
      wordsServedAccepted: acceptedRuns.length === 0 ? null : mean(acceptedRuns.map((r) => r.wordsServed)),
      anchorRecallAccepted:
        acceptedRuns.length === 0
          ? null
          : share(
              acceptedRuns.reduce((s, r) => s + r.anchorKept, 0),
              acceptedRuns.reduce((s, r) => s + r.rowsServed, 0),
            ),
      anchorLostAccepted: acceptedRuns.reduce((s, r) => s + r.anchorLost, 0),
      // The model-free information measure, averaged over accepted runs.
      retentionAccepted: acceptedRuns.length === 0 ? null : mean(acceptedRuns.map((r) => r.retention)),
      jargonDelta: acceptedRuns.length === 0 ? null : mean(acceptedRuns.map((r) => r.jargonServed)) - runs[0].jargonBaseline,
      easeDelta: acceptedRuns.length === 0 ? null : mean(acceptedRuns.map((r) => r.easeServed)) - runs[0].easeBaseline,
    },
    runs,
    perFinding: perFindingRuns[0],
    perFindingAccepted: acceptedRuns.length === 0 ? null : perFindingRuns[runs.indexOf(acceptedRuns[0])],
  };
}

// ---------------------------------------------------------------- track C

async function trackReorder(chat, reps) {
  const findings = REORDER_FIXTURE;
  const labels = new Map(findings.map((f) => [f.fingerprint, f.label]));
  const infoSet = new Set(findings.filter((f) => f.severity === "info").map((f) => f.fingerprint));
  const asked = findingsToAsk(findings);

  // The question set is built here exactly as convex/scans/rankScan.ts builds
  // it: one closed noul question per finding the lane may move.
  const questions = {};
  for (const f of asked) {
    questions[questionIdFor(f.fingerprint)] = {
      type: "noul",
      instructions: `Does this need fixing before the builder shares their repo: ${f.title} (severity ${f.severity}).`,
      criteria: {
        true: "A stranger could be harmed or embarrassed if this ships as it is.",
        false: "Real, but not something to fix before sharing.",
      },
    };
  }

  const floorRun = reorderMetrics(findings, null, "table", labels);
  const runs = [];
  for (let i = 0; i < reps; i++) {
    const result = await decide(
      // rankState is the product's own view of what leaves the machine.
      asked.map((f) => ({ title: f.title, severity: f.severity, ruleId: f.ruleId })),
      questions,
    );
    runs.push({
      ...reorderMetrics(findings, result.ok ? result.answers : null, result.source, labels),
      laneOk: result.ok,
      laneError: result.error,
      attempts: result.attempts,
      latencyMs: result.latencyMs,
      rep: i + 1,
    });
  }

  // Only runs where the lane actually answered count toward a model score. A run
  // that fell back to the table must read as not measured, never as a score of
  // zero, or a silent lane would look like the best rung in the product.
  const modelRuns = runs.filter((r) => r.providerAnswered);
  const scored = modelRuns.length > 0;
  const withinFloor = floorRun.hinge_within_floor;
  const withinModel = scored ? mean(modelRuns.map((r) => r.hinge_within_model)) : null;
  const hingeModel = scored ? mean(modelRuns.map((r) => r.hinge_model)) : null;

  return {
    fixtureRows: findings.length,
    actionable: floorRun.actionable,
    infoExcluded: floorRun.infoExcluded,
    questionsAsked: asked.length,
    bands: floorRun.bands,
    reps,
    floor: floorRun,
    runs,
    summary: {
      runs: runs.length,
      laneAnswered: runs.filter((r) => r.laneOk).length,
      laneSources: [...new Set(runs.map((r) => r.source))],
      // Invariants. Zero on every run of every lane, and the whole reason they are
      // measured is that a non-zero here is a product defect, not a score.
      bandCrossings: runs.reduce((s, r) => s + r.bandCrossings, 0),
      permutationFailures: runs.reduce((s, r) => s + r.permutationFail, 0),
      droppedAnywhere: runs.reduce((s, r) => s + r.dropped.length, 0),
      addedAnywhere: runs.reduce((s, r) => s + r.added.length, 0),
      infoRowsLeaked: runs.reduce((s, r) => s + r.order.filter((fp) => infoSet.has(fp)).length, 0),
      zeroMissTotal: runs.reduce((s, r) => s + r.zero_miss_violations.length, 0),
      // Scores, over the answered runs only.
      scoredRuns: modelRuns.length,
      moved: modelRuns.map((r) => r.moved),
      meanMoved: scored ? mean(modelRuns.map((r) => r.moved)) : null,
      hingeFloor: floorRun.hinge_floor,
      hingeModel,
      hingeDelta: scored ? floorRun.hinge_floor - hingeModel : null,
      hingeWithinFloor: withinFloor,
      hingeWithinModel: withinModel,
      // The only delta the lane has the authority to earn. The whole-order hinge
      // counts cross-band inversions and the band guard makes those unfixable, so
      // reading hingeDelta as the model's contribution overstates it.
      hingeWithinDelta: scored ? withinFloor - withinModel : null,
      top3HitsFloor: floorRun.top3_hits_floor,
      top3HitsModel: scored ? mean(modelRuns.map((r) => r.top3_hits_model)) : null,
      tauVsFloor: modelRuns.map((r) => r.tau_vs_floor),
      swapDistance: modelRuns.map((r) => r.swap_distance),
      latencyMs: runs.map((r) => r.latencyMs),
    },
  };
}

// ---------------------------------------------------------------- main

const report = {
  harness: "ai-evidence",
  fixture: "scripts/ai-evidence/fixture.mjs",
  laneRequested: LANE,
  reps: REPS,
  assistReps: ASSIST_REPS,
  chatModel: CHAT_MODEL,
  reachability: {
    // Names and booleans only. No value is read, formatted, or written anywhere.
    keyNamesPresent: keyPresence(),
    localOllama: null,
    localModelsAvailable: [],
    localModelsUsed: [],
  },
  tracks: {},
  notMeasured: [],
};

async function main() {
  report.reachability.localOllama = await localOllamaUp();
  report.reachability.localModelsAvailable = (await localModels()).map((m) => m.name);

  let chat = null;
  if (LANE === "local") {
    if (!report.reachability.localOllama.up) {
      throw new Error("the local lane was requested and no local Ollama server answered");
    }
    chat = new LocalChatLane(CHAT_MODEL);
    report.reachability.localModelsUsed = [CHAT_MODEL];
  }

  report.tracks.license = await trackLicense(chat);
  report.tracks.assist = await trackAssist(chat, LANE === "local" ? ASSIST_REPS : 1);
  report.tracks.reorder = await trackReorder(chat, LANE === "local" ? REPS : 1);
  if (chat !== null) report.reachability.chatStats = chat.stats();

  report.notMeasured = [
    "Whether a rewrite reads better to a person. This fixture has no human label, so plainness is a lexical proxy and nothing here is a readability judgement.",
    "Whether the licence labels are correct. They were written by reading public package metadata, not by querying a registry from this harness, which made no request to any registry.",
    "Whether the reorder labels match an operator's judgement. They were authored by rule in the fixture, small N, and a disagreeing operator would relabel them and every score would move.",
    "Spend. No token or cost number is recorded anywhere in this harness, and the only lane used is local, which bills nothing.",
    "Stability across model versions. Three local models were run once each. A different tag would move every number here and the report would need to be re-run.",
    "Hosted lane behaviour. Jev, Perplexity, Gemini and Ollama Cloud were not called: no key was set and this harness does not acquire one.",
  ];

  const json = JSON.stringify(report, null, 2);
  if (OUT !== "") writeFileSync(OUT, `${json}\n`, "utf8");
  process.stdout.write(`${json}\n`);
}

main().catch((error) => {
  process.stderr.write(`harness failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});