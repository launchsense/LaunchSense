import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isHardcodedCredential } from "../shared/analyzers/secrets.ts";

// Regression guard for a real false-positive bug found on 2026-10-04.
//
// Scanning github.com/rohasnagpal/sara-wallet, the credential-pattern rule flagged
// 18 hits in one settings file. They were not secrets. They were lines like
//
//     OPENROUTER_API_KEY: str = ""
//
// The old pattern consumed `str`, the Python type annotation, as if it were the
// value, so the empty default was never seen. In a security tool a false positive is
// worse than a miss: it teaches the reader to ignore the tool.
//
// Every fixture below is either the exact shape that misfired, or a shape that must
// still fire.

describe("type annotations and empty defaults are not secrets", () => {
  const notSecrets = [
    ['OPENROUTER_API_KEY: str = ""', "the exact line that misfired 18 times"],
    ['GROQ_API_KEY: str = ""', "empty default"],
    ['API_KEY: str = ""', "no framework prefix"],
    ['PASSWORD = ""', "empty bare assignment"],
    ["SECRET_KEY: str = ''", "single quotes"],
    ['OPENAI_API_KEY: string = ""', "TypeScript style annotation"],
    ['API_KEY: Optional[str] = None', "optional type"],
    ['DATABASE_URL: str = "postgresql://localhost"', "a local default, not a credential"],
  ];

  for (const [line, why] of notSecrets) {
    it(`does not flag: ${line.trim()} (${why})`, () => {
      assert.equal(isHardcodedCredential(line), false);
    });
  }
});

describe("placeholders are not secrets", () => {
  const placeholders = [
    ['API_KEY = "changeme"', "classic placeholder"],
    ['SECRET = "your_key_here"', "instruction, not a value"],
    ['PASSWORD = "TODO"', "unfinished"],
    ['TOKEN = "xxxxxxxx"', "redaction"],
    ['CLIENT_SECRET = "example"', "documentation value"],
    ['API_KEY = "placeholder"', "explicit placeholder"],
  ];
  for (const [line, why] of placeholders) {
    it(`does not flag: ${line.trim()} (${why})`, () => {
      assert.equal(isHardcodedCredential(line), false);
    });
  }
});

describe("values read from the environment are not hardcoded", () => {
  const fromEnv = [
    'API_KEY = process.env.API_KEY',
    'API_KEY: str = os.getenv("API_KEY", "")',
    'PASSWORD = os.environ.get("PASSWORD")',
    'SECRET: str = str(os.getenv("SECRET"))',
    'API_KEY = ${{ secrets.API_KEY }}',
    'API_KEY = ${API_KEY}',
    'TOKEN = getenv("TOKEN")',
  ];
  for (const line of fromEnv) {
    it(`does not flag: ${line.trim()}`, () => {
      assert.equal(isHardcodedCredential(line), false);
    });
  }
});

describe("declarations and references are not secrets", () => {
  const notSecrets = [
    ['    secret     = Column(String, nullable=False)', "an ORM column declaration"],
    ['        encrypted_cdp_secret  = Column(String, nullable=False)', "a column with a framework call"],
    ['cdp_key_secret=body.cdp_key_secret', "a reference to another variable"],
    ['secret=chat_id', "a parameter reference"],
    ['cdp_secret = page.encrypted_cdp_secret', "a field read"],
    ['self.token = self.secret', "self references"],
    ['SECRET_KEY = get_secret()', "a function call"],
    ['api_key = settings.API_KEY', "a settings reference"],
  ];
  for (const [line, why] of notSecrets) {
    it(`does not flag: ${line.trim().slice(0, 46)} (${why})`, () => {
      assert.equal(isHardcodedCredential(line), false);
    });
  }
});

describe("real hardcoded credentials still fire", () => {
  const realOnes = [
    'api_key = "sk-realvalue12345678"',
    'API_KEY = "a1b2c3d4e5f6g7h8"',
    "PASSWORD = 'hunter2secret'",
    'OPENROUTER_API_KEY = ""sk-or-v1-"+"abcdef1234567890abcdef1234567890""',
    'CLIENT_SECRET: str = "aVeryLongRealSecretValue"',
    'access_token = ""ya29."+"a0AfH6SMBxxxxxxxxxxxxx""',
  ];
  for (const line of realOnes) {
    it(`flags: ${line.trim().slice(0, 40)}...`, () => {
      assert.equal(isHardcodedCredential(line), true);
    });
  }
});

describe("lines with no credential name are ignored", () => {
  const unrelated = [
    "const count = 42",
    'title = "Hello world"',
    "// this mentions password in a comment only",
    'description = "Set your api key in the dashboard"',
  ];
  for (const line of unrelated) {
    it(`ignores: ${line.slice(0, 40)}`, () => {
      // A comment may mention the word but must not assign a value to it.
      const result = isHardcodedCredential(line);
      if (line.startsWith("//")) assert.equal(result, false);
    });
  }
});

describe("prose inside a string is not a credential", () => {
  const prose = [
    ['Only a "cdp" row ever has a secret: it\'s encrypted at rest', "a sentence, not an assignment"],
    ["A secret: there's nothing stored here", "prose with a contraction"],
    ['This field named secret does not hold a value', "descriptive text"],
  ];
  for (const [line, why] of prose) {
    it(`does not flag: ${line.slice(0, 44)} (${why})`, () => {
      assert.equal(isHardcodedCredential(line), false);
    });
  }

  it("still flags a real quoted secret with a colon-looking string", () => {
    assert.equal(isHardcodedCredential('API_KEY = "sk-abcd1234efgh5678"'), true);
  });
});
