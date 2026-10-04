// When a check is unknown, a model may pick one next look from this list.
// The picked sentence is a quote. It is not a finding and it does not change unknown.

export interface UnknownInput {
  findings: Array<{ ruleId: string; why: string }>;
  notChecked: Array<{ reason: string }>;
}

export function suggestionOptions(input: UnknownInput): Record<string, string> | null {
  const blob = [
    ...input.findings.map((item) => item.why),
    ...input.notChecked.map((item) => item.reason),
  ].join(" ");
  const unknown =
    /unknown/i.test(blob) ||
    /not queried/i.test(blob) ||
    /not read/i.test(blob) ||
    /incomplete/i.test(blob) ||
    /No license signals/i.test(blob);
  if (!unknown) return null;
  const options: Record<string, string> = {
    "leave-unknown": "Leave the gap as unknown. Do not turn it into a pass or a license name.",
    "name-the-gap": "Name the file or package that was missing. Do not guess a term.",
  };
  if (/No license signals/i.test(blob)) {
    options["look-spdx"] = "Look for a SPDX header or REUSE.toml in files this read did not open. A missing file is not a ban.";
  }
  if (/not queried|No reliable terms/i.test(blob)) {
    options["registry-empty"] = "The registries did not supply terms. Do not copy another package's license onto this one.";
  }
  return options;
}

export function quoteForChoice(choice: string, options: Record<string, string>): string | null {
  const text = options[choice];
  if (text === undefined) return null;
  return text;
}
