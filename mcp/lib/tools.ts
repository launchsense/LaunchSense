// The tools this server publishes, and the check that an argument list matches
// the schema a client read. The schema tools/list sends is the schema the
// argument check enforces, so the two cannot drift apart.

import { isEmptyValue, jsonTypeOf } from "./protocol.ts";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// objectSchema publishes a closed object schema. A closed schema is what makes
// an argument the server does not use a visible mistake rather than a silent
// no-op.
export function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}

export function toolDefs(): ToolDef[] {
  return [
    {
      // The hosted server really reads a public repo under this name. A local
      // tool of that name that reads nothing is how a scan gets reported that
      // never happened, so this one says where the hosted read lives and is
      // named so it cannot be mistaken for it.
      name: "launchsense_scan_public_notice",
      description:
        "Does nothing by itself. It names where the public repo read actually lives: the website, or the hosted MCP address. This server reads only files on this machine and never downloads GitHub.",
      inputSchema: objectSchema({}),
    },
    {
      name: "launchsense_report",
      description: "Read a LaunchSense report by scan id.",
      inputSchema: objectSchema(
        {
          scanId: {
            type: "string",
            description:
              "The scan id the website or the hosted address gave you.",
          },
        },
        ["scanId"],
      ),
    },
    {
      name: "launchsense_github",
      description:
        "See if gh is logged in on this machine, and which repo is open. Does not send a token anywhere.",
      inputSchema: objectSchema({}),
    },
    {
      name: "launchsense_scan_repo",
      description:
        "Review the files already on this machine, under LAUNCHSENSE_ROOT. Does not download GitHub. Alpha has no login.",
      inputSchema: objectSchema({}),
    },
  ];
}

export function toolDef(name: string): ToolDef | undefined {
  return toolDefs().find((def) => def.name === name);
}

// validateArgs checks the arguments against the schema the tool publishes. A
// missing required field, a wrong JSON type, and an undeclared field are three
// different mistakes and each answer says which one it is, instead of calling
// every one of them a missing field or quietly running with the extra ignored.
// It returns null when the arguments are fine, or the reason they are not.
export function validateArgs(
  schema: Record<string, unknown>,
  args: unknown,
): string | null {
  let values: Record<string, unknown>;
  if (args === undefined || args === null) {
    values = {};
  } else if (typeof args === "object" && !Array.isArray(args)) {
    values = args as Record<string, unknown>;
  } else {
    return "arguments must be a JSON object";
  }

  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  const required = Array.isArray(schema.required)
    ? (schema.required as string[])
    : [];

  for (const name of required) {
    if (!Object.hasOwn(values, name) || isEmptyValue(values[name])) {
      return `${name} is required`;
    }
  }

  // A schema that does not say otherwise is treated as closed. Every schema
  // this server publishes sets additionalProperties, and an argument no tool
  // declares is a mistake worth reporting rather than a field to drop.
  let closed = true;
  if (typeof schema.additionalProperties === "boolean") {
    closed = !schema.additionalProperties;
  }

  for (const name of Object.keys(values).sort()) {
    const declared = Object.hasOwn(properties, name)
      ? properties[name]
      : undefined;
    if (declared === undefined || typeof declared !== "object" || declared === null) {
      if (Object.keys(properties).length === 0) {
        return `unexpected property ${name}. This tool takes no arguments.`;
      }
      return `unexpected property ${name}. Declared properties: ${Object.keys(properties)
        .sort()
        .join(", ")}`;
    }
    if (!closed) {
      continue;
    }
    const wanted = (declared as Record<string, unknown>).type;
    const got = jsonTypeOf(values[name]);
    if (typeof wanted === "string" && got !== wanted) {
      return `${name} must be a ${wanted}, got ${got}`;
    }
  }

  return null;
}
