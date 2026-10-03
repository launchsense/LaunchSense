import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { looksLikeSecretValue } from "../shared/analyzers/secretValue.ts";
import { isHardcodedCredential, trackedEnvHasLiveValue } from "../shared/analyzers/secrets.ts";

// The value gate. Two acceptance bars:
//
//   KNOWN-REAL must fire. A false negative on a real credential is worse than a
//   false positive, so this list is a hard gate. Every value here is a documented
//   provider key FORMAT, never a live key.
//
//   KNOWN-FAKE must not fire. Every one is a line that actually appeared in a corpus
//   of 6 mature public repos, or in the sara-wallet scan on 2026-10-04.

describe("KNOWN-REAL provider formats must fire", () => {
  const realLines = [
    ['aws_access_key = ""AKIA"+"IOSFODNN7EXAMPLE""', "AWS access key id format"],
    ['api_key = ""ghp_"+"abcdefghij1234567890ABCD""', "GitHub classic PAT"],
    ['token = ""github_pat_"+"abcdef1234567890"+"abcdef1234abcd""', "GitHub fine-grained PAT"],
    ['auth_token = ""xoxb-"+"123456789012"+"-ABCDEFGHIJKLMNopqr""', "Slack bot token"],
    ['secret = ""sk_test_"+"4eC39HqLyjWDarjt"+"T1zdp7dc""', "Stripe test key"],
    ['api_key = ""sk-"+"abcdefghij1234567890"+"abcdefghij1234567890""', "OpenAI key"],
    ['OPENROUTER_API_KEY = ""sk-or-v1-"+"abcdef1234567890abcdef1234567890abcdef12""', "OpenRouter key"],
    ['anthropic_secret = ""sk-ant-api03-"+"abcdefghij1234567890"+"abcdefghij1234567890""', "Anthropic key"],
    ['access_token = ""ya29."+"a0AfH6SMBxxxxxxxxxxxxx1234567890ab""', "Google OAuth token"],
    ['api_key = ""AIza"+"SyB4eC39HqLyjWDarjt"+"T1zdp7dc9vWxYz1234""', "Google API key"],
    ['password = ""SG."+"abcdefghij1234567890"+"."+"ABCDEFGHIJ1234567890abcdef""', "SendGrid key"],
    ['auth_token = ""SK"+"abcdef1234567890"+"abcdef1234567890ab""', "Twilio key"],
    ['auth_token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJ"', "JWT"],
    ['secret = "-----BEGIN RSA PRIVATE KEY-----"', "PEM private key"],
    ['api_key = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"', "32 char hex"],
    ['secret = "da39a3ee5e6b4b0d3255bfef95601890afd80709"', "40 char hex"],
    ['client_secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYzK8w5Dg="', "base64 32"],
    ['API_KEY = "a1b2c3d4e5f6g7h8"', "16 char mixed alnum"],
    ['CLIENT_SECRET: str = "aVeryLongRealSecretValue"', "long mixed case behind an annotation"],
  ];
  for (const [line, why] of realLines) {
    it(`fires: ${why}`, () => {
      assert.equal(isHardcodedCredential(line), true, `${why} was missed: ${line}`);
    });
  }

  it("fires on a real key inside a quoted JSON key", () => {
    // This was a real false negative found on 2026-10-04.
    assert.equal(
      isHardcodedCredential('"apiKey": ""sk-or-v1-"+"abcdef1234567890abcdef1234567890""'),
      true,
    );
  });

  it("fires on a Go short declaration", () => {
    assert.equal(isHardcodedCredential('apiKey := "sk-realvalue12345678"'), true);
  });

  it("fires on the second assignment on a line when the first is an env read", () => {
    assert.equal(
      isHardcodedCredential('const secret = process.env.SECRET, apiKey = "sk-live-a1b2c3d4e5";'),
      true,
      "a real key after an env read on the same line must not be lost",
    );
  });
});

describe("KNOWN-FAKE values must not fire", () => {
  const fakeLines = [
    ['OPENROUTER_API_KEY: str = ""', "type annotation, empty default (18 hits in sara-wallet)"],
    ['password: Annotated[', "Python Annotated subscript"],
    ['apiKey: String;', "TypeScript interface member"],
    ['secret = Column(String, nullable=False)', "ORM column declaration"],
    ['cdp_key_secret=body.cdp_key_secret', "reference to another variable"],
    ['secret=chat_id', "parameter reference"],
    ['api_key = settings.API_KEY', "settings reference"],
    ['PASSWORD = os.getenv("PASSWORD", "")', "environment read"],
    ['api_key = ENV["API_KEY"]', "Ruby environment read"],
    ['apiKey = $_ENV["API_KEY"];', "PHP environment read"],
    ['var apiKey = configuration["ApiKey"];', "C# config read"],
    ['$apiKey = $env:API_KEY', "PowerShell environment read"],
    ['API_KEY = ${{ secrets.API_KEY }}', "CI injection"],
    ['api_key: "changeme"', "placeholder"],
    ['secret = "your_key_here"', "instruction"],
    ['password = "TODO"', "unfinished"],
    ['token = "xxxxxxxx"', "mask"],
    ['api_key = "example"', "documentation value"],
    ["auth: {apiKey: 'base', userId: 'user-123'},", "short literal (corpus hit)"],
    ["    auth: {apiKey: 'extended'},", "short literal (corpus hit)"],
    ['assert termui.hidden_prompt_func("Password: ") == "secret"', "assertion"],
    ['# api_key = "looks-real"', "comment"],
    [' * password: Retired2023', "JSDoc comment body"],
    ['        Token::RecursivePrefix => 1,', "Rust enum, not an assignment"],
  ];
  for (const [line, why] of fakeLines) {
    it(`does not fire: ${why}`, () => {
      assert.equal(isHardcodedCredential(line), false, `false positive: ${line}`);
    });
  }
});

describe("looksLikeSecretValue directly", () => {
  const mustFire = [
    ""sk-or-v1-"+"abcdef1234567890abcdef1234567890"",
    ""AKIA"+"IOSFODNN7EXAMPLE"",
    ""ghp_"+"abcdefghij1234567890ABCD"",
    "a1b2c3d4e5f6g7h8",
    "aVeryLongRealSecretValue",
    "wJalrXUtnFEMI/K7MDENG/bPxRfiCYzK8w",
  ];
  for (const v of mustFire) {
    it(`value fires: ${v.slice(0, 24)}...`, () => {
      assert.equal(looksLikeSecretValue(v), true);
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
    ["550e8400-e29b-41d4-a716-446655440000", "UUID is an identifier"],
    ["2026-10-04", "an ISO date"],
    ["1.2.3", "a version"],
    ["/etc/secret-store/key", "a path"],
    ["postgresql://localhost:5432/db", "a URL"],
    ["self.secret", "a reference"],
    ["<your-key-here>", "a template slot"],
  ];
  for (const [v, why] of mustNotFire) {
    it(`value does not fire: ${why}`, () => {
      assert.equal(looksLikeSecretValue(v), false, `false positive on value: ${v}`);
    });
  }
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
    assert.equal(
      trackedEnvHasLiveValue('OPENROUTER_API_KEY=""sk-or-v1-"+"abcdef1234567890abcdef1234567890""'),
      true,
    );
  });

  it("does not flag a real value under a non-credential name", () => {
    assert.equal(trackedEnvHasLiveValue("DATABASE_URL=sqlite:///./sara.db\nMODEL=gpt-4o-mini"), false);
  });

  it("ignores comments and blank lines", () => {
    assert.equal(trackedEnvHasLiveValue("# API_KEY="sk-or-v1-"+"abcdef1234567890abcdef"\n\n"), false);
  });
});
