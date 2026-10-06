import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANALYTICS_TABLES,
  ANALYTICS_SOURCES,
  FOLD_SCAN_FIELDS,
  REPO_ID_PURPOSES,
} from "../convex/analytics/inventory.ts";

// NOTICE-REACHABLE, and CODE-TRUTHFUL. Three defects, one file of tests.
//
// 1. Nothing declared which columns the analytics tables hold, so "analytics never
//    carries PII" was a promise with no list behind it. A promise with no list
//    cannot be checked and cannot be broken quietly either.
// 2. Two write paths broke the promise while saying they honoured it.
//    logEvent is a public mutation, so shareId and refShareId arrived from the
//    visitor's URL and were sliced and stored, which made `?ref=ada@example.com`
//    an email address on an analytics row. usageDiagnostics took four declared
//    strings from the usage route body and sliced them into storage.
// 3. The privacy notice said nothing about the rule, so a reader could not check
//    it and a change to the schema could not fail anything.
//
// No network, no database, and no clock. The schema is read as text and the
// inventory is imported directly, so the whole file runs offline.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

function read(...parts) {
  const full = join(repo, ...parts);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

const schemaText = read("convex", "schema.ts");

// Prose is reflowed by the formatter, so every sentence check runs against a
// whitespace-flattened copy.
function flat(source) {
  return source.replace(/\s+/g, " ");
}

/**
 * One table's field list, parsed out of convex/schema.ts.
 *
 * Comments are stripped first because several columns carry a doc comment above
 * them, and a doc comment contains the word "email" often enough that reading it
 * as a column would be wrong. Returns name to declared type text, in order.
 */
function tableFields(name) {
  const start = schemaText.indexOf(`${name}: defineTable(`);
  assert.notEqual(start, -1, `${name} must exist in convex/schema.ts`);
  const open = schemaText.indexOf("{", start);
  assert.notEqual(open, -1, `${name} must declare an object`);

  // Walk out of the field object by counting brackets. A field's own type can be
  // a v.union of literals or a v.object, so splitting on commas alone is wrong.
  let depth = 0;
  let end = -1;
  for (let at = open; at < schemaText.length; at += 1) {
    const character = schemaText[at];
    if (character === "{" || character === "(" || character === "[") depth += 1;
    else if (character === "}" || character === ")" || character === "]") {
      depth -= 1;
      if (depth === 0) {
        end = at;
        break;
      }
    }
  }
  assert.notEqual(end, -1, `${name}'s field object must close`);

  const body = schemaText
    .slice(open, end)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

  const fields = [];
  let fieldDepth = 0;
  let buffer = "";
  const flush = () => {
    const match = buffer.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]+)$/);
    if (match !== null) fields.push({ field: match[1], type: match[2].trim() });
  };
  for (const character of body.slice(1)) {
    if (character === "{" || character === "(" || character === "[") fieldDepth += 1;
    if (character === "}" || character === ")" || character === "]") fieldDepth -= 1;
    if (character === "," && fieldDepth === 0) {
      flush();
      buffer = "";
      continue;
    }
    buffer += character;
  }
  flush();
  return fields;
}

/** True when a declared type holds a v.string() anywhere inside it. */
function isStringColumn(type) {
  return /v\.string\(\)/.test(type);
}

describe("the analytics tables declare no PII column", () => {
  it("inventory every analytics table, and say what each one is for", () => {
    assert.equal(ANALYTICS_TABLES.length, 7, "seven analytics tables are governed by this rule");
    for (const table of ANALYTICS_TABLES) {
      assert.ok(table.role.length > 0, `${table.table} must say what it is for`);
      assert.ok(table.fields.length > 0, `${table.table} must list its columns`);
    }
  });

  it("classify no column as PII, in any table", () => {
    // The rule in one assertion. A column classified PII means somebody found
    // one and did not remove it, and this is where that has to stop.
    for (const table of ANALYTICS_TABLES) {
      for (const field of table.fields) {
        assert.notEqual(
          field.klass,
          "pii",
          `${table.table}.${field.field} is classified PII: analytics must never carry PII`,
        );
      }
    }
  });

  it("use one of the four declared classes on every column", () => {
    const allowed = new Set(["pii", "pseudonymous", "repoId", "technical"]);
    for (const table of ANALYTICS_TABLES) {
      for (const field of table.fields) {
        assert.ok(
          allowed.has(field.klass),
          `${table.table}.${field.field} has the unknown class ${field.klass}`,
        );
        assert.ok(field.why.length > 0, `${table.table}.${field.field} must say why it is not PII`);
      }
    }
  });

  it("refuse a column whose name could hold an email, a name, an address, or a phone", () => {
    // Split camelCase into words before matching. A substring pattern over the
    // raw name is what let userEmail through the first time this rule was
    // written: the character before "Email" is a lower-case letter, so a rule
    // anchored on a word boundary never fires.
    const wordsIn = (field) =>
      field
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);

    const PII_WORDS = new Set([
      "email",
      "mail",
      "mailbox",
      "name",
      "names",
      "firstname",
      "lastname",
      "fullname",
      "surname",
      "nickname",
      "username",
      "handle",
      "contact",
      "accountname",
      "customername",
      "displayname",
      "phone",
      "telephone",
      "mobile",
      "msisdn",
      "address",
      "street",
      "city",
      "postal",
      "postcode",
      "zip",
      "latitude",
      "longitude",
      "geo",
      "ip",
      "ipv4",
      "ipv6",
      "remoteaddr",
      "clientaddr",
      "useragent",
      "hostname",
      "deviceid",
      "macaddress",
    ]);

    // The only names that trip the shape on purpose, and why each is safe. An
    // exception has to be written down here with its reason, so a fourth one is
    // a visible decision rather than a silent hole.
    const REVIEWED_NAME_EXCEPTIONS = new Map([
      [
        "usageEvents.clientName",
        "The coding tool that called, mapped through a fixed eight-value allowlist. Not a person's name.",
      ],
      [
        "usageEvents.toolName",
        "The MCP tool that was called, and only one of two known names can land.",
      ],
      [
        "usageEvents.mcpMethodName",
        "The OpenTelemetry mcp.method.name attribute, which is initialize, tools/list, or tools/call.",
      ],
    ]);

    for (const table of ANALYTICS_TABLES) {
      for (const field of table.fields) {
        const full = `${table.table}.${field.field}`;
        const hit = wordsIn(field.field).filter((word) => PII_WORDS.has(word));
        if (hit.length === 0) continue;
        assert.ok(
          REVIEWED_NAME_EXCEPTIONS.has(full),
          `${full} is named after PII (${hit.join(", ")}) and has no written reason for existing: ${REVIEWED_NAME_EXCEPTIONS.get(full) ?? "no reason recorded"}`,
        );
      }
    }
  });

  it("give every string column a bound, so no column is free text", () => {
    // A v.string() column with no stated bound is free text by another name.
    // This is the check that stops one arriving quietly, which is why every
    // string column in the inventory names the check that keeps it closed.
    for (const table of ANALYTICS_TABLES) {
      for (const entry of table.fields) {
        const declared = tableFields(table.table).find((f) => f.field === entry.field);
        assert.ok(declared !== undefined, `${table.table}.${entry.field} must exist in the schema`);
        if (!isStringColumn(declared.type)) continue;
        assert.ok(
          typeof entry.boundedBy === "string" && entry.boundedBy.length > 0,
          `${table.table}.${entry.field} is a string column with no bound recorded, so it is unreviewed free text: say the enum, the allowlist, or the shape check that keeps it closed`,
        );
      }
    }
  });

  it("keep the repository identifier in the hashed form only", () => {
    // The one identifier the rule allows. It is allowed as a day-scoped HMAC, so
    // the only column that may hold it is repoKey, and the write path refuses
    // anything that is not 64 lower-case hex characters.
    const repoIdColumns = [];
    for (const table of ANALYTICS_TABLES) {
      for (const field of table.fields) {
        if (field.klass === "repoId") repoIdColumns.push(`${table.table}.${field.field}`);
      }
    }
    assert.deepEqual(
      repoIdColumns,
      ["usageEvents.repoKey"],
      "the repository identifier belongs in exactly one analytics column, hashed",
    );
    const ingest = read("convex", "analytics", "ingest.ts");
    assert.match(
      ingest,
      /\^\[0-9a-f\]\{64\}\$/,
      "the usageEvents write path must refuse a repoKey that is not 64 lower-case hex characters",
    );
  });

  it("name the three technical purposes the repository identifier is allowed to serve", () => {
    assert.deepEqual(
      [...REPO_ID_PURPOSES],
      ["running the scan", "linking a rescan", "counting the funnel"],
      "the rule lists exactly three purposes, and a fourth must be a deliberate change",
    );
  });
});

describe("the inventory matches the schema, so a new PII column cannot arrive quietly", () => {
  it("lists the same columns in the same order as every analytics table declares", () => {
    for (const table of ANALYTICS_TABLES) {
      const declared = tableFields(table.table).map((entry) => entry.field);
      const listed = table.fields.map((entry) => entry.field);
      assert.deepEqual(
        listed,
        declared,
        `${table.table} columns have drifted from convex/schema.ts. A new column has to be classified in convex/analytics/inventory.ts before it can ship.`,
      );
    }
  });

  it("covers exactly the tables the rule names, and no table twice", () => {
    const names = ANALYTICS_TABLES.map((table) => table.table);
    assert.equal(new Set(names).size, names.length, "no table may be listed twice");
    for (const expected of [
      "usageEvents",
      "dailyMetrics",
      "analyticsEvents",
      "rateLimits",
      "usageDiagnostics",
      "providerCalls",
      "findingTransitions",
    ]) {
      assert.ok(names.includes(expected), `the rule must cover ${expected}`);
    }
  });

  it("describes the scans row as a source, and names every column the fold reads", () => {
    // scans is the product's table and the rule does not govern it: a scan
    // cannot run without the literal repository name. What the rule governs is
    // what leaves it, so the list is the fold's read projection and every entry
    // says the fate of the value.
    const scans = ANALYTICS_SOURCES.find((source) => source.table === "scans");
    assert.ok(scans !== undefined, "scans must be listed as an analytics source");
    for (const field of scans.fields) {
      assert.ok(
        field.fate.length > 0,
        `scans.${field.field} must say what the analytics lane does with the value`,
      );
      assert.ok(field.klass.length > 0, `scans.${field.field} must be classified`);
    }

    // The projection and the table cannot drift apart either. If someone adds a
    // scans column to FoldScan without saying what happens to it, this fails.
    const rollup = read("convex", "analytics", "rollup.ts");
    const projection = rollup.match(/export type FoldScan = \{([\s\S]*?)\n\};/);
    assert.ok(projection !== null, "FoldScan must still be a declared type in the fold");
    const declared = [...projection[1].matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(
      [...FOLD_SCAN_FIELDS].sort(),
      declared.sort(),
      "the scans columns the fold reads and the ones the inventory lists have drifted apart",
    );
  });

  it("say the repository name is dropped rather than written, on both sides of the fold", () => {
    const rollup = read("convex", "analytics", "rollup.ts");
    assert.match(
      rollup,
      /function repoIdentity\(scan: FoldScan\)/,
      "the fold builds a repo identity in memory, so that claim has something behind it",
    );
    // No metric name may take a repository as a dimension.
    const dims = [...rollup.matchAll(/add\(\s*"[^"]+",\s*\{([^}]*)\}/g)].map((m) => m[1]);
    assert.ok(dims.length > 0, "the fold must add metric rows, or this check proves nothing");
    for (const bag of dims) {
      for (const key of bag.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
        assert.doesNotMatch(
          key[1],
          /^(owner|repo|repoUrl|sha|repoKey)$/,
          `a dailyMetrics dimension named ${key[1]} would put the repository on a stored row`,
        );
      }
    }
  });
});

describe("the write paths cannot put a person's details on an analytics row", () => {
  const queries = read("convex", "scans", "queries.ts");
  const limit = read("convex", "mcpLimit.ts");

  it("keeps a share link id only when it has the shape the server minted", () => {
    // logEvent is a public mutation. Before the check, the visitor's own URL
    // became a stored column, so `?ref=ada@example.com` was an email address on
    // an analytics row.
    assert.match(queries, /export function publicIdOrNull/, "the shape check must be reachable");
    assert.match(
      queries,
      /\^\[0-9a-f\]\{32\}\$/,
      "the share id shape must be 32 lower-case hex characters, the shape newPublicId mints",
    );
    assert.doesNotMatch(
      queries,
      /shareId:\s*args\.shareId\.slice/,
      "a slice bounds the length, not the content: an email address would still land",
    );
    assert.match(queries, /shareId:\s*publicIdOrNull\(args\.shareId\)/);
    assert.match(queries, /refShareId:\s*publicIdOrNull\(args\.refShareId\)/);
  });

  it("drops a malformed share id but still records the event", () => {
    // The event is the measurement. The id is not what any metric segments on,
    // so dropping a malformed one loses no number and keeps the funnel honest.
    const block = queries.match(/export const logEvent = mutation\(\{[\s\S]*?\n\}\);/);
    assert.ok(block !== null, "logEvent must still be a mutation in queries.ts");
    const insert = block[0].match(/ctx\.db\.insert\("analyticsEvents"[\s\S]*?\n\s*\}\);/);
    assert.ok(insert !== null, "logEvent must still insert an analyticsEvents row");
    for (const column of ["shareId:", "refShareId:"]) {
      assert.match(insert[0], new RegExp(`${column}\\s*publicIdOrNull\\(`));
      assert.doesNotMatch(insert[0], new RegExp(`${column}\\s*args\\.\\w+\\.slice`));
    }
  });

  it("keeps only closed labels in usageDiagnostics, so a name or an address cannot land", () => {
    assert.match(limit, /export function isDeclaredValue/, "the allowlist check must be reachable");
    // A character shape accepts "AdaLovelace". The fields must use closed sets and
    // normalize anything outside them, so a name can never be stored raw.
    assert.doesNotMatch(
      limit,
      /\^\[A-Za-z0-9\._\+\-\]\{1,20\}\$/,
      "a character shape accepts a person's name, so it is not the gate",
    );
    assert.match(limit, /const ALLOWED_HARNESS = new Set\(/);
    assert.match(limit, /const ALLOWED_ORDER_SOURCE = new Set\(/);
    assert.match(limit, /declaredOr\(args\.stage, ALLOWED_STAGE, "other"\)/);
    assert.match(limit, /declaredOr\(args\.tier, ALLOWED_TIER, "other"\)/);
    assert.match(limit, /declaredOr\(args\.harness, ALLOWED_HARNESS, "other"\)/);
    assert.match(limit, /declaredOr\(args\.orderSource, ALLOWED_ORDER_SOURCE, "unspecified"\)/);
    assert.doesNotMatch(
      limit,
      /harness: args\.harness\b/,
      "the raw harness value must never be inserted; only the normalized label",
    );
  });

  it("reports whether the usage row was actually stored", () => {
    // The route answered {stored:true} even when the row was refused, and the
    // installer told the person their counts were sent. All three links agree now.
    assert.match(limit, /returns: v\.boolean\(\)/, "recordUsage must report whether it stored");
    assert.match(read("convex", "http.ts"), /return json\(\{ stored \}\)/);
    assert.match(
      read("mcp", "review-entry.ts"),
      /body\["stored"\] === true/,
      "the installer must read the stored flag, not only the status",
    );
  });

  it("reads no caller network address into any key", () => {
    // The notice says the counter holds no part of your network address, and the
    // rule says no analytics row carries one. Same input, so it is checked once
    // here for the analytics side.
    //
    // Comments are stripped first: convex/mcpLimit.ts names the header in the
    // comment that records its removal, and reading that as a live read would
    // make this check a lie rather than a guard.
    const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    for (const [name, source] of [
      ["convex/http.ts", read("convex", "http.ts")],
      ["convex/mcpLimit.ts", limit],
      ["convex/analytics/ingest.ts", read("convex", "analytics", "ingest.ts")],
      ["convex/analytics/rollup.ts", read("convex", "analytics", "rollup.ts")],
    ]) {
      assert.doesNotMatch(
        code(source),
        /x-forwarded-for|forwarded/i,
        `${name} must not read the caller's network address: no analytics row may hold one`,
      );
    }
  });
});

describe("the notice states the analytics data rule on every surface that carries it", () => {
  // The five sentences are the rule in plain words. They are the same on all
  // three surfaces, and every one of them is true of the code above.
  const RULE = [
    "Analytics holds no personal information.",
    "No email address, no network address, and no free text is written to an analytics row.",
    "The only label that names anything is the coding tool that sent the call, which is a claim about a tool and not about a person.",
    "The only identifier analytics is allowed is the repository identifier, and we use it for technical purposes only: running the scan, linking a rescan, and counting the funnel.",
    "Every other value on an analytics row is a count, a code, a time, or one of a closed set of labels.",
  ];

  const surfaces = [
    ["docs/PRIVACY.md", flat(read("docs", "PRIVACY.md"))],
    ["src/pages/Privacy.tsx", flat(read("src", "pages", "Privacy.tsx"))],
    ["llms.txt", flat(read("llms.txt"))],
  ];

  it("prints the rule on every surface, not on one of them", () => {
    for (const [name, text] of surfaces) {
      for (const sentence of RULE) {
        assert.ok(text.includes(sentence), `${name} is missing the analytics data rule: "${sentence}"`);
      }
    }
  });

  it("says the repository identifier is for technical purposes only", () => {
    // The part a reader is most likely to need, checked on its own so a failure
    // names the sentence rather than the list.
    const purposeSentence =
      "The only identifier analytics is allowed is the repository identifier, and we use it for technical purposes only: running the scan, linking a rescan, and counting the funnel.";
    for (const [name, text] of surfaces) {
      assert.ok(
        text.includes(purposeSentence),
        `${name} must say the repository identifier is used for technical purposes only`,
      );
    }
  });

  it("names the three purposes the repository identifier serves", () => {
    for (const purpose of REPO_ID_PURPOSES) {
      for (const [name, text] of surfaces) {
        assert.ok(text.includes(purpose), `${name} does not name the purpose: ${purpose}`);
      }
    }
  });

  it("does not claim the rule covers more than the code does", () => {
    // A notice that says "no identifier at all" would be false: a day-scoped
    // HMAC repository key is a real row value, and the scans table holds the
    // literal owner and repo. The honest claim is the one above, so a stronger
    // claim is a defect.
    const overclaims = [
      /no identifier at all/i,
      /stores no identifier/i,
      /never stores the repository name/i,
      /we do not know who you are/i,
      /not personal data/i,
      /no data about you/i,
      /never carries any identifier/i,
      /holds no identifier of any kind/i,
      // "anonymous" is only an overclaim when it is applied to the analytics or
      // the numbers. The notice uses it correctly elsewhere ("rather than being
      // treated as anonymous" about a refused credential), so the patterns are
      // anchored to the analytics claim and not to the bare word.
      /anonymous analytics/i,
      /analytics is anonymous/i,
      /numbers are anonymous/i,
      /fully anonymous/i,
      /no personal data/i,
      /no identifier of any kind/i,
      /never store your name/i,
    ];
    for (const [name, text] of surfaces) {
      for (const pattern of overclaims) {
        assert.doesNotMatch(text, pattern, `${name} claims more than the code does: ${pattern}`);
      }
    }
  });

  it("uses no em dash, en dash, ellipsis, or middle dot in the rule copy", () => {
    for (const [name, text] of surfaces) {
      for (const character of [/\u2014/, /\u2013/, /\u2026/, /\u00b7/]) {
        assert.doesNotMatch(text, character, `${name} contains ${character}`);
      }
    }
  });

  it("names the file the rule lives in, so a reader can check it", () => {
    for (const [name, text] of surfaces) {
      assert.ok(
        text.includes("convex/analytics/inventory.ts"),
        `${name} must name the file the column-by-column list lives in`,
      );
    }
  });

  it("keeps the notice's own heading structure unchanged", () => {
    // The rule was added as body copy, so the two copies still have to match
    // heading for heading. A new section on one side only would drift the page
    // away from the file the notice also lives in.
    const docHeadings = [...read("docs", "PRIVACY.md").matchAll(/^## (.+)$/gm)].map((m) =>
      flat(m[1]).trim(),
    );
    const pageHeadings = [
      ...read("src", "pages", "Privacy.tsx").matchAll(/<h2 id="[^"]+">([\s\S]*?)<\/h2>/g),
    ].map((m) => flat(m[1]).trim());
    assert.deepEqual(docHeadings, pageHeadings, "docs/PRIVACY.md and /privacy have drifted apart");
  });
});