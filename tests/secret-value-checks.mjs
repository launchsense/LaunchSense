import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { looksLikeSecretValue } from "../shared/analyzers/secretValue.ts";
import { isHardcodedCredential, trackedEnvHasLiveValue } from "../shared/analyzers/secrets.ts";
import * as F from "./fixtures.mjs";

// The value gate. Two acceptance bars:
//
//   KNOWN-REAL must fire. A false negative on a real credential is worse than a
//   false positive, so this list is a hard gate.
//
//   KNOWN-FAKE must not fire. Every one is a line that appeared in a corpus of mature
//   public repos, or in the sara-wallet scan on 2026-10-04.
//
// Every credential-shaped value comes from tests/fixtures.mjs, assembled at runtime,
// so this file never contains a contiguous key-shaped string. GitHub's secret
// scanner blocked a push for exactly that reason on 2026-10-04.

describe("KNOWN-REAL provider formats must fire", () => {
  const realLines = [
    [F.line("aws_access_key", F.FAKE_AWS), "AWS access key id format"],
    [F.line("api_key", F.FAKE_GITHUB_CLASSIC), "GitHub classic PAT"],
    [F.line("token", F.FAKE_GITHUB_PAT), "GitHub fine-grained PAT"],
    [F.line("auth_token", F.FAKE_SLACK), "Slack bot token"],
    [F.line("secret", F.FAKE_STRIPE), "Stripe test key"],
    [F.line("api_key", F.FAKE_OPENAI), "OpenAI key"],
    [F.line("OPENROUTER_API_KEY", F.FAKE_OPENROUTER), "OpenRouter key"],
    [F.line("anthropic_secret", F.FAKE_ANTHROPIC), "Anthropic key"],
    [F.line("access_token", F.FAKE_GOOGLE_OAUTH), "Google OAuth token"],
    [F.line("api_key", F.FAKE_GOOGLE_API), "Google API key"],
    [F.line("password", F.FAKE_SENDGRID), "SendGrid key"],
    [F.line("auth_token", F.FAKE_TWILIO), "Twilio key"],
    [F.line("auth_token", F.FAKE_JWT), "JWT"],
    [F.line("secret", F.FAKE_PEM), "PEM private key"],
    [F.line("api_key", F.FAKE_HEX32), "32 char hex"],
    [F.line("secret", F.FAKE_HEX40), "40 char hex"],
    [F.line("client_secret", F.FAKE_BASE64), "base64 32"],
    [F.line("API_KEY", F.FAKE_MIXED16), "16 char mixed alnum"],
    [`CLIENT_SECRET: str = "${F.FAKE_LONG}"`, "long mixed case behind an annotation"],
  ];
  for (const [source, why] of realLines) {
    it(`fires: ${why}`, () => {
      assert.equal(isHardcodedCredential(source), true, `${why} was missed: ${source}`);
    });
  }

  it("fires on a real key inside a quoted JSON key", () => {
    assert.equal(isHardcodedCredential(`"apiKey": "${F.FAKE_OPENROUTER}"`), true);
  });

  it("fires on a Go short declaration", () => {
    assert.equal(isHardcodedCredential(`apiKey := "${F.FAKE_OPENAI}"`), true);
  });

  it("fires on the second assignment when the first is an env read", () => {
    assert.equal(
      isHardcodedCredential(`const secret = process.env.SECRET, apiKey = "${F.FAKE_STRIPE}";`),
      true,
    );
  });

  it("fires on a bare provider key with no variable name", () => {
    assert.equal(isHardcodedCredential(F.FAKE_AWS), true);
    assert.equal(isHardcodedCredential(F.FAKE_STRIPE), true);
  });
});

describe("KNOWN-FAKE values must not fire", () => {
  const fakeLines = [
    ['OPENROUTER_API_KEY: str = ""', "type annotation, empty default"],
    ["password: Annotated[", "Python Annotated subscript"],
    ["apiKey: String;", "TypeScript interface member"],
    ["secret = Column(String, nullable=False)", "ORM column declaration"],
    ["cdp_key_secret=body.cdp_key_secret", "reference to another variable"],
    ["secret=chat_id", "parameter reference"],
    ["api_key = settings.API_KEY", "settings reference"],
    ['PASSWORD = os.getenv("PASSWORD", "")', "environment read"],
    ['api_key = ENV["API_KEY"]', "Ruby environment read"],
    ['apiKey = $_ENV["API_KEY"];', "PHP environment read"],
    ['var apiKey = configuration["ApiKey"];', "C# config read"],
    ["$apiKey = $env:API_KEY", "PowerShell environment read"],
    ["API_KEY = ${{ secrets.API_KEY }}", "CI injection"],
    ['api_key: "changeme"', "placeholder"],
    ['secret = "your_key_here"', "instruction"],
    ['password = "TODO"', "unfinished"],
    ['token = "xxxxxxxx"', "mask"],
    ['api_key = "example"', "documentation value"],
    ["auth: {apiKey: 'base', userId: 'user-123'},", "short literal"],
    ["    auth: {apiKey: 'extended'},", "short literal"],
    ['assert termui.hidden_prompt_func("Password: ") == "secret"', "assertion"],
    ['# api_key = "looks-real"', "comment"],
    [" * password: Retired2023", "JSDoc comment body"],
    ["        Token::RecursivePrefix => 1,", "Rust enum, not an assignment"],
    ["token_address, token_decimals = token_result", "tuple unpack"],
    ['"token_address": token_address,', "dict entry"],
    ["expected_src_token=expected_src_token,", "kwarg reference"],
    ["row.encrypted_cdp_secret = encrypted_secret", "attribute assign"],
    ['legacy_keys = ("SARA_MODEL",)', "config name"],
    [`TOKEN_MESSENGER = "${F.FAKE_EVM_ADDRESS}"`, "EVM contract address"],
  ];
  for (const [source, why] of fakeLines) {
    it(`does not fire: ${why}`, () => {
      assert.equal(isHardcodedCredential(source), false, `false positive: ${source}`);
    });
  }
});

describe("looksLikeSecretValue directly", () => {
  const mustFire = [
    F.FAKE_OPENROUTER, F.FAKE_AWS, F.FAKE_GITHUB_CLASSIC, F.FAKE_MIXED16,
    F.FAKE_LONG, F.FAKE_BASE64, F.FAKE_BASE64_SLASH,
  ];
  for (const value of mustFire) {
    it(`value fires: ${value.slice(0, 12)}...`, () => {
      assert.equal(looksLikeSecretValue(value), true);
    });
  }

  const mustNotFire = [
    ["", "empty"],
    ["base", "4 chars"],
    ["extended", "8 chars, one class"],
    ["changeme", "placeholder"],
    ["xxxxxxxx", "repeated run"],
    ["12345678", "digits only"],
    ["password", "the word"],
    ["hunter2", "7 chars, one class"],
    [F.FAKE_UUID, "UUID is an identifier"],
    ["2026-10-04", "an ISO date"],
    ["1.2.3", "a version"],
    ["/etc/secret-store/key", "a path"],
    ["dist/bin.cjs", "a build output path"],
    ["rendered_phone_check", "lowercase snake identifier is a name"],
    ["postgresql://localhost:5432/db", "a URL"],
    ["self.secret", "a reference"],
    ["<your-key-here>", "a template slot"],
  ];
  for (const [value, why] of mustNotFire) {
    it(`value does not fire: ${why}`, () => {
      assert.equal(looksLikeSecretValue(value), false, `false positive on value: ${value}`);
    });
  }
});

// WS-1. The receiver gate is scoped to source files. A config-style file names a
// credential with a dotted key, so the dot must not read as a member access there.
// The value is assembled from parts in tests/fixtures.mjs.
describe("a dotted name is a member access in source, an assignment in config", () => {
  const dotted = `jwt.secret=${F.FAKE_BASE64_SLASH}`;

  const CONFIG_STYLE = [
    "application.properties",
    "config/application.properties",
    "settings.ini",
    "settings.cfg",
    "nginx.conf",
    "pyproject.toml",
    "config/.env",
  ];
  for (const path of CONFIG_STYLE) {
    it(`fires: dotted key in ${path}`, () => {
      assert.equal(isHardcodedCredential(dotted, path), true, `was missed in ${path}`);
    });
  }

  const SOURCE_STYLE = [
    "src/config.ts",
    "app/main.py",
    "MainActivity.kt",
    "src/routes/index.svelte",
    "lib/secrets.rb",
    "index.html",
  ];
  for (const path of SOURCE_STYLE) {
    it(`does not fire: dotted key in ${path}`, () => {
      assert.equal(isHardcodedCredential(dotted, path), false, `false positive in ${path}`);
    });
  }

  it("does not fire with no path, because no path means source", () => {
    assert.equal(isHardcodedCredential(dotted), false);
    assert.equal(isHardcodedCredential(dotted, ""), false);
  });

  it("still does not fire on an env read or a placeholder in a config file", () => {
    for (const line of [
      "jwt.secret=${JWT_SECRET}",
      "jwt.secret=$JWT_SECRET",
      'jwt.secret="{{ jwt_secret }}"',
      "jwt.secret=changeme",
    ]) {
      assert.equal(isHardcodedCredential(line, "application.properties"), false, line);
    }
  });

  it("fires on a provider-shaped value under a dotted name in a config file", () => {
    assert.equal(isHardcodedCredential(`stripe.key=${F.FAKE_STRIPE}`, "application.properties"), true);
  });
});

describe("a tracked env TEMPLATE is not a leak", () => {
  it("does not flag a template with empty values", () => {
    const template = [
      "LLM_PROVIDER=openrouter",
      "LLM_MODEL=openai/gpt-4o-mini",
      "OPENROUTER_API_KEY=",
      "DATABASE_URL=sqlite:///./sara.db",
    ].join("\n");
    assert.equal(trackedEnvHasLiveValue(template), false);
  });

  it("does not flag a template with placeholder values", () => {
    assert.equal(trackedEnvHasLiveValue("API_KEY=changeme\nSECRET_KEY=your_key_here"), false);
  });

  it("DOES flag a tracked env with a real credential value", () => {
    assert.equal(trackedEnvHasLiveValue(`OPENROUTER_API_KEY="${F.FAKE_OPENROUTER}"`), true);
  });

  it("does not flag a real value under a non-credential name", () => {
    assert.equal(trackedEnvHasLiveValue("DATABASE_URL=sqlite:///./sara.db\nMODEL=gpt-4o-mini"), false);
  });

  it("ignores comments and blank lines", () => {
    assert.equal(trackedEnvHasLiveValue(`# API_KEY=${F.FAKE_OPENROUTER}\n\n`), false);
  });
});
