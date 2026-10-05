// Metrics for the AI evidence harness. Deterministic, offline, no model.
//
// Every metric here is a pure function of (text, labels). Nothing calls a
// provider, nothing reads the network, and nothing looks at a repository. The
// same metric runs over the deterministic baseline and over the model answer,
// so a difference between the two is the model's contribution and nothing else.
//
// Three families:
//   lexical  jargon rate and reading ease, over the same tokenisation for both
//            texts. A proxy for "plainer", not a proxy for "correct".
//   anchors  does the rewrite still say what the finding said. Labelled, and
//            the only correctness rule in this file.
//   bands    did the order stay a permutation and stay inside its severity
//            bands. These are pass/fail invariants, not scores.

import { kendallTau, hingeLoss, swapDistance, topKHits, zeroMissViolations } from "../../shared/reports/ranking.ts";
import { actionableFindings, findingsToAsk, rankFromAnswers, tableOrder } from "../../shared/reports/priority.ts";

/**
 * Everyday words a non-developer already knows. Fixed here on purpose: a
 * vocabulary that changes per run makes two runs incomparable, and a vocabulary
 * borrowed from a corpus of findings would let the metric reward repeating the
 * input.
 *
 * Matched by stem, so "passwords" reads as plain because "password" is here.
 */
const PLAIN_STEMS = new Set([
  "account", "action", "add", "address", "allow", "alreadi", "anoth", "appli", "arent", "attack",
  "back", "bad", "bann", "batteri", "becaus", "befor", "block", "blow", "book", "break", "bring",
  "browser", "build", "busin", "call", "camer", "canchang", "cannot", "care", "carri", "case",
  "catch", "caus", "chang", "cheat", "check", "choic", "choos", "clear", "click", "close", "code",
  "cooki", "copi", "correct", "cost", "could", "count", "crack", "creat", "credit", "cut", "dama",
  "danger", "data", "databas", "day", "dead", "deal", "decid", "delete", "deni", "descript",
  "desir", "destroy", "detail", "devic", "differ", "disabl", "disclos", "do", "document", "door",
  "download", "drop", "dump", "eas", "eat", "edit", "email", "encrypt", "end", "enforc", "engin",
  "entri", "eras", "error", "escape", "event", "everi", "exact", "exampl", "except", "expir",
  "expos", "express", "extend", "extra", "fail", "fals", "familiar", "famili", "far", "fast",
  "file", "fill", "find", "fir", "fix", "flag", "flat", "flow", "folder", "follow", "form", "formatt",
  "forward", "found", "frame", "free", "from", "front", "full", "funct", "gadget", "gave", "gener",
  "get", "give", "given", "go", "grab", "grant", "great", "group", "grow", "guess", "guid", "ha",
  "hack", "had", "half", "hand", "hang", "happen", "hard", "has", "have", "havent", "he", "header",
  "hear", "heart", "held", "help", "her", "here", "hers", "hidden", "hid", "high", "him", "hire",
  "hold", "home", "hook", "hop", "hope", "host", "hot", "how", "however", "huge", "human", "hundr",
  "hurt", "i", "id", "if", "ignor", "in", "incomplet", "index", "inform", "insid", "instead",
  "interest", "internet", "into", "invent", "is", "it", "item", "its", "job", "join", "junk", "just",
  "keep", "kept", "key", "kind", "knew", "know", "known", "land", "larg", "last", "late", "laugh",
  "law", "lay", "lead", "leak", "learn", "least", "left", "lend", "less", "let", "letter", "level",
  "library", "lie", "life", "lift", "light", "like", "limit", "line", "link", "list", "listen",
  "live", "load", "local", "lock", "log", "login", "look", "loop", "loos", "lost", "lot", "low",
  "machine", "made", "mail", "main", "maintain", "make", "man", "many", "map", "mark", "match",
  "matter", "may", "me", "mean", "meant", "media", "meet", "member", "memory", "men", "message",
  "method", "middle", "might", "mil", "million", "mind", "mine", "minut", "miss", "model", "money",
  "month", "more", "most", "move", "much", "must", "my", "name", "near", "need", "never", "new",
  "news", "next", "night", "nine", "no", "nobodi", "none", "nor", "norm", "not", "note", "notic",
  "now", "number", "obtain", "occur", "off", "offer", "office", "often", "oh", "ok", "old", "on",
  "once", "one", "only", "open", "order", "other", "ought", "our", "out", "over", "own", "page",
  "pain", "pair", "paper", "part", "pass", "past", "password", "path", "pay", "people", "per",
  "person", "phone", "pick", "picture", "piece", "place", "plain", "plan", "play", "please",
  "point", "poor", "port", "possibl", "power", "present", "press", "prevent", "price", "private",
  "probabl", "problem", "process", "protect", "prove", "provider", "public", "pull", "purpose",
  "push", "put", "qualifi", "question", "quick", "quit", "quite", "quote", "radio", "rain", "raise",
  "ran", "rang", "rate", "rather", "reach", "read", "readabl", "ready", "real", "receiv", "recent",
  "recogn", "record", "red", "refuse", "regist", "reject", "relat", "rememb", "remot", "remov",
  "repair", "repeat", "replac", "report", "request", "requir", "resolv", "respect", "respons",
  "rest", "restart", "result", "retriev", "return", "reveal", "review", "reward", "right", "risk",
  "role", "roll", "room", "rule", "run", "safe", "said", "salt", "same", "save", "say", "scann",
  "scope", "screen", "script", "search", "second", "secur", "see", "seem", "send", "sent", "server",
  "servic", "session", "set", "sett", "seven", "several", "shall", "shape", "share", "she", "ship",
  "short", "should", "show", "side", "sign", "signal", "similar", "simpl", "since", "singl", "six",
  "size", "skip", "sleep", "slow", "small", "so", "some", "someon", "something", "sometimes", "soon",
  "sorry", "sort", "sound", "sourc", "space", "speak", "special", "spoil", "spot", "stack", "staff",
  "stand", "star", "start", "state", "station", "stay", "step", "still", "stop", "store", "story",
  "straight", "strange", "street", "strength", "strong", "stuck", "stuff", "subject", "submit",
  "succeed", "such", "sudden", "suggest", "suit", "sum", "sun", "suppos", "sure", "surpris", "susp",
  "swap", "symbol", "system", "table", "tag", "take", "talk", "tall", "tap", "teach", "team", "tell",
  "ten", "term", "test", "than", "thank", "that", "the", "their", "them", "then", "there", "these",
  "they", "thing", "think", "third", "this", "those", "though", "thought", "three", "through",
  "throw", "thus", "time", "to", "today", "together", "token", "told", "tomorrow", "tone", "too",
  "took", "tool", "top", "totally", "toward", "town", "track", "trade", "traffic", "train",
  "transfer", "treat", "tree", "trip", "trouble", "true", "truly", "trust", "truth", "try", "turn",
  "twice", "two", "type", "under", "understand", "unfair", "unit", "unless", "until", "up", "update",
  "upon", "us", "use", "used", "useful", "user", "usual", "valley", "value", "vari", "verif", "veri",
  "vers", "very", "victim", "view", "virus", "visit", "wait", "walk", "wall", "want", "war", "warm",
  "warn", "was", "watch", "water", "way", "we", "weak", "wear", "web", "week", "well", "were", "what",
  "when", "where", "whether", "which", "while", "white", "who", "whole", "why", "wide", "wife", "will",
  "win", "wind", "window", "wish", "with", "within", "without", "woman", "wonder", "word", "work",
  "worker", "world", "worried", "would", "write", "wrong", "yard", "year", "yes", "yesterday", "yet",
  "you", "young", "your",
]);

const WORD = /[a-z]+/g;

function words(text) {
  return text.toLowerCase().match(WORD) ?? [];
}

/** True when a word's stem is in the plain vocabulary. */
function isPlainWord(word) {
  for (let i = Math.min(word.length, 12); i >= 3; i--) {
    if (PLAIN_STEMS.has(word.slice(0, i))) return true;
  }
  return false;
}

/** Vowel-group syllable estimate. Deterministic, and stated as an estimate. */
function syllables(word) {
  const stripped = word.replace(/e$/, "");
  const groups = stripped.match(/[aeiouy]+/g);
  return Math.max(1, groups === null ? 1 : groups.length);
}

/**
 * Share of content words that are not everyday vocabulary.
 *
 * Content word = four letters or more. Shorter words carry almost no meaning in
 * either text, so counting them only adds noise. Lower is plainer. This is a
 * lexical proxy: it says the wording is less technical, and it cannot say the
 * wording is true.
 */
export function jargonRate(text) {
  const content = words(text).filter((w) => w.length >= 4);
  if (content.length === 0) return 0;
  const jargon = content.filter((w) => !isPlainWord(w));
  return jargon.length / content.length;
}

/** Flesch reading ease. An estimate on an estimate, and reported as one. */
export function readingEase(text) {
  const all = words(text);
  if (all.length === 0) return 0;
  const sentences = (text.match(/[.!?]+/g) ?? []).length || 1;
  const syl = all.reduce((sum, w) => sum + syllables(w), 0);
  return 206.835 - 1.015 * (all.length / sentences) - 84.6 * (syl / all.length);
}

export function wordCount(text) {
  return words(text).length;
}

/**
 * True when a rewrite still carries at least one labelled plain anchor.
 *
 * The anchors were written per finding before any model ran. A rewrite that
 * loses every anchor has stopped saying what the finding said, however fluent
 * it is, and this is the fixture's own rule for that.
 */
export function keepsAnchor(text, anchors) {
  const haystack = text.toLowerCase();
  return anchors.some((anchor) => {
    const stem = anchor.slice(0, Math.max(4, anchor.length - 2));
    return haystack.includes(stem);
  });
}

/**
 * Did the rewrite name a file, a path, or a directory the prompt never sent?
 *
 * The explain prompt carries fingerprints, and a fingerprint contains a path,
 * so this is a real risk rather than a hypothetical one. Any path-shaped token
 * is a leak by this definition, including the fingerprint's own path.
 */
export function leaksPath(text) {
  return /[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/.test(text) || /\b[a-z]+\.(ts|tsx|js|jsx|json|md|py|env|txt|yml|yaml)\b/i.test(text);
}

/** Did the model change the text at all? The metric that decides whether AI helped. */
export function changedText(baseline, rewrite) {
  return baseline.trim() !== rewrite.trim();
}

export function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Share of the baseline's content words that survived into the rewrite.
 *
 * Set-based, so order and grammar do not matter and a model cannot score by
 * reshuffling. This is the model-free measure of information loss, and it is
 * fairer than the anchor rule, which is a hand-written label and can be
 * stricter than the meaning. 1.0 means nothing was dropped. 0.2 means four words
 * in five are gone.
 */
export function contentRetention(baseline, rewrite) {
  const before = new Set(words(baseline).filter((w) => w.length >= 4));
  if (before.size === 0) return null;
  const after = [...new Set(words(rewrite))];
  let kept = 0;
  for (const word of before) {
    if (after.includes(word)) {
      kept += 1;
      continue;
    }
    // A light stem match, so "hashes" counts as keeping "hash".
    for (let i = Math.min(word.length, 10); i >= 4; i--) {
      if (after.some((other) => other.length >= 4 && other.startsWith(word.slice(0, i)))) {
        kept += 1;
        break;
      }
    }
  }
  return kept / before.size;
}

export function share(numerator, denominator) {
  if (denominator === 0) return null;
  return numerator / denominator;
}

/**
 * The reorder measures, computed from the product's own ranking math.
 *
 * Two of these are invariants and must be zero on every run, on every lane,
 * including a hostile one:
 *
 *   bandCrossings  the severity sequence of the returned order differs from the
 *                   floor's severity sequence, so at least one row changed band
 *   permutationFail the order is not a permutation of the actionable set, so a
 *                   row was added or dropped
 *
 * The rest are scores, and they are reported with the floor's own score beside
 * them so the delta is the lane's contribution and not an absolute.
 */
export function reorderMetrics(findings, answers, source, labels) {
  const pool = actionableFindings(findings);
  const floor = tableOrder(pool);
  const result = rankFromAnswers(findings, answers, source);
  const order = result.order;

  const severityOf = new Map(findings.map((f) => [fingerprintKey(f)]));
  const sevSeq = (list) => list.map((fp) => severityOf.get(fp) ?? "missing").join(",");
  const bandCrossings =
    sevSeq(order) === sevSeq(floor) ? 0 : countBandCrossings(floor, order, findings);

  const floorSet = new Set(floor);
  const orderSet = new Set(order);
  const dropped = floor.filter((fp) => !orderSet.has(fp));
  const added = [...orderSet].filter((fp) => !floorSet.has(fp));
  const permutationFail = dropped.length + added.length;

  const labelMap = new Map(
    pool.filter((f) => labels.has(fingerprintKey(f))).map((f) => [fingerprintKey(f), labels.get(fingerprintKey(f))]),
  );

  const bands = bandSlices(order, findings);

  return {
    source: result.source,
    providerAnswered: source !== "table",
    actionable: pool.length,
    asked: findingsToAsk(findings).length,
    floor,
    order,
    moved: order.filter((fp, i) => floor[i] !== fp).length,
    bandCrossings,
    dropped,
    added,
    permutationFail,
    infoExcluded: findings.length - pool.length,
    tau_vs_floor: kendallTau(order, floor),
    swap_distance: swapDistance(order, floor),
    // Whole-order hinge loss. Reported because it is the metric an operator would
    // compute, and reported with a warning: most of its mass is a low-labelled
    // high row sitting above a high-labelled medium row, which no lane is allowed
    // to fix, so a delta here overstates what the lane can move.
    hinge_floor: hingeLoss(floor, labelMap),
    hinge_model: hingeLoss(order, labelMap),
    // Within-band hinge loss. This is the only version of the metric the lane has
    // the authority to improve, so it is the one the delta should be read from.
    hinge_within_floor: withinBandHingeLoss(floor, findings, labelMap),
    hinge_within_model: withinBandHingeLoss(order, findings, labelMap),
    bands: bands.map((b) => ({
      severity: b.severity,
      size: b.size,
      positives: b.order.filter((fp) => labelMap.get(fp) === 1).length,
    })),
    top3_hits_floor: topKHits(floor, labelMap, 3),
    top3_hits_model: topKHits(order, labelMap, 3),
    zero_miss_violations: zeroMissViolations(order, floor, labelMap, 3),
    labelled: labelMap.size,
  };
}

/**
 * Consecutive same-severity runs, so a band is a contiguous slice. Used to
 * report each band's size and its label mix beside the scores, so a reader can
 * see which band the lane was even allowed to work in.
 */
function bandSlices(order, findings) {
  const severityOf = new Map(findings.map((f) => [f.fingerprint, f.severity]));
  const out = [];
  for (const fp of order) {
    const severity = severityOf.get(fp) ?? "info";
    const last = out[out.length - 1];
    if (last !== undefined && last.severity === severity) last.fingerprints.push(fp);
    else out.push({ severity, fingerprints: [fp] });
  }
  return out.map((band) => ({ severity: band.severity, size: band.fingerprints.length, order: band.fingerprints }));
}

/**
 * Hinge loss summed inside each severity band, which is the whole of the lane's
 * authority. A cross-band inversion is excluded on purpose: the band guard makes
 * it unfixable, so counting it would measure the guard, not the model.
 */
function withinBandHingeLoss(order, findings, labelMap) {
  const severityOf = new Map(findings.map((f) => [f.fingerprint, f.severity]));
  let total = 0;
  let current = [];
  let currentSeverity = null;
  const flush = () => {
    if (current.length > 1) total += hingeLoss(current, labelMap);
    // The slice has to be cleared, or the next band is scored together with
    // everything before it and the number comes out larger than the whole-order
    // hinge loss it is supposed to be a subset of.
    current = [];
  };
  for (const fp of order) {
    const severity = severityOf.get(fp) ?? "info";
    if (currentSeverity !== null && severity !== currentSeverity) flush();
    currentSeverity = severity;
    current.push(fp);
  }
  flush();
  return total;
}

function fingerprintKey(f) {
  return f.fingerprint;
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2, info: 3 };

/** How many rows ended up in a band their floor position did not allow. */
function countBandCrossings(floor, order, findings) {
  const severityOf = new Map(findings.map((f) => [f.fingerprint, f.severity]));
  let worst = 0;
  for (let i = 0; i < order.length; i++) {
    const here = SEVERITY_RANK[severityOf.get(order[i]) ?? "info"];
    for (let j = 0; j < i; j++) {
      const before = SEVERITY_RANK[severityOf.get(order[j]) ?? "info"];
      if (here < before) worst = Math.max(worst, 1);
    }
  }
  return worst;
}