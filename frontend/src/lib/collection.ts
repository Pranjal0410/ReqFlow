// The workspace as a file.
//
// Everything built in the app — the requests, what each one asserts, what each
// one takes out of its response for the next — lives in browser storage on one
// machine. That is fine until it is not: another developer cannot see it, a
// review cannot read it, and nothing runs it except a person clicking Send.
//
// So it is written next to the code it tests, as a file that can be committed,
// diffed and run without the app. `reqflow run` in cli/ reads exactly this.
//
// What it deliberately does not hold is credentials. A file whose whole point
// is to be committed is the last place a token should be, so a secret header
// and a secret variable are written as empty — the row survives, saying the
// header exists and has to be filled, and the value does not.

import { RequestTab, TestCase } from "../types";
import { Capture } from "./capture";
import { Variable, isSecretVariable, isSecretHeader } from "./variables";

export const FORMAT = 1;

export interface CollectionRequest {
  name: string;
  method: string;
  url: string;
  headers: { key: string; value: string; enabled: boolean }[];
  body: string;
  pathParams: Record<string, string>;
  tests: { field: string; operator: string; value: string }[];
  captures: { from: string; name: string }[];
}

export interface Collection {
  reqflow: number;
  name: string;
  baseUrl: string;
  variables: { key: string; value: string }[];
  requests: CollectionRequest[];
}

// A tab with no url is a blank one the user opened and has not filled in. It is
// not a request, and writing it out would put an empty row in a file someone
// else has to read.
function worthKeeping(tab: RequestTab): boolean {
  return Boolean(tab.url && tab.url.trim());
}

const REFERENCES_A_VARIABLE = /\{\{\s*[A-Za-z0-9_.-]+\s*\}\}/;

// "Bearer {{token}}" is not a credential. It is a reference to one, and the
// value behind it is redacted separately, where it lives.
//
// The first version of this emptied every header whose name looked sensitive,
// which took out "Bearer {{token}}" along with the real thing — and a
// collection whose Authorization header is blank is one that cannot be run,
// which is the entire reason the file exists. Written out, the request stayed
// but the way it authenticated did not.
export function headerForFile(key: string, value: string): string {
  const text = value || "";
  if (!isSecretHeader(key)) return text;
  return REFERENCES_A_VARIABLE.test(text) ? text : "";
}

// A login body carries in plain text the password that redacting the
// Authorization header was meant to keep out of the file.
//
// It becomes a placeholder rather than an empty string, because the file is
// meant to be run: `--var password=...` fills it in, and a name is something a
// reader can act on where a blank is only a thing that stopped working.
export function bodyForFile(body: string): { body: string; needs: string[] } {
  const text = body || "";
  if (!text.trim()) return { body: text, needs: [] };

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not json, so there are no field names to judge — and no way to take out
    // one value without taking out the whole thing
    return isSecretVariable(text) ? { body: "", needs: [] } : { body: text, needs: [] };
  }

  const needs: string[] = [];
  const walk = (value: any): any => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(value)) {
        if (isSecretVariable(k) && typeof v === "string") {
          if (REFERENCES_A_VARIABLE.test(v)) {
            out[k] = v;
          } else {
            const name = k.replace(/[^A-Za-z0-9_.-]/g, "");
            if (!needs.includes(name)) needs.push(name);
            out[k] = `{{${name}}}`;
          }
          continue;
        }
        out[k] = walk(v);
      }
      return out;
    }
    return value;
  };

  return { body: JSON.stringify(walk(parsed)), needs };
}

export function toCollection(
  tabs: RequestTab[],
  variables: Variable[],
  baseUrl: string,
  name: string
): Collection {
  // names the file now refers to but cannot carry a value for, listed as empty
  // variables so both the app and the runner show them as needing one
  const needed: string[] = [];

  const requests = (tabs || []).filter(worthKeeping).map((tab) => {
    const { body, needs } = bodyForFile(tab.body || "");
    for (const n of needs) if (!needed.includes(n)) needed.push(n);

    return {
      name: tab.label || `${tab.method} ${tab.url}`,
      method: tab.method,
      url: tab.url,
      headers: (tab.headers || [])
        .filter((h) => h.key && h.key.trim())
        .map((h) => ({
          key: h.key,
          value: headerForFile(h.key, h.value || ""),
          enabled: h.enabled !== false,
        })),
      body,
      pathParams: tab.pathParams || {},
      // an outcome belongs to the response that produced it, and there is no
      // response in a file
      tests: (tab.tests || []).map((t) => ({
        field: t.field,
        operator: t.operator,
        value: t.value,
      })),
      captures: (tab.captures || [])
        .filter((c) => c.from && c.name)
        .map((c) => ({ from: c.from, name: c.name })),
    };
  });

  const declared = (variables || [])
    .filter((v) => v.key && v.key.trim())
    .map((v) => ({
      key: v.key.trim(),
      // the token from a login is exactly what this must not carry
      value: isSecretVariable(v.key) ? "" : v.value || "",
    }));

  for (const n of needed) {
    if (!declared.some((v) => v.key === n)) declared.push({ key: n, value: "" });
  }

  return {
    reqflow: FORMAT,
    name: name || "workspace",
    baseUrl: baseUrl || "",
    variables: declared,
    requests,
  };
}

export function serialise(collection: Collection): string {
  return JSON.stringify(collection, null, 2) + "\n";
}

function id(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export interface Imported {
  name: string;
  baseUrl: string;
  variables: Variable[];
  tabs: RequestTab[];
}

// Reading one back.
//
// Written by hand as often as by the app, once it is a file in a repository, so
// nothing here assumes a field is present or is the type it should be. A
// collection that is half right imports the half that is right rather than
// refusing the file and saying nothing about which line was wrong.
export function fromCollection(raw: any): Imported | null {
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.requests)) return null;

  const tabs: RequestTab[] = [];
  for (const item of raw.requests) {
    const url = String(item?.url ?? "").trim();
    if (!url) continue;

    const method = String(item?.method ?? "GET").toUpperCase();
    const headers = Array.isArray(item?.headers)
      ? item.headers
          .filter((h: any) => h && String(h.key ?? "").trim())
          .map((h: any) => ({
            key: String(h.key),
            value: String(h.value ?? ""),
            enabled: h.enabled !== false,
          }))
      : [];

    const tests: TestCase[] = Array.isArray(item?.tests)
      ? item.tests
          .filter((t: any) => t && String(t.field ?? "").trim())
          .map((t: any) => ({
            id: id(),
            field: String(t.field),
            operator: String(t.operator ?? "equals"),
            value: String(t.value ?? ""),
            passed: null,
          }))
      : [];

    const captures: Capture[] = Array.isArray(item?.captures)
      ? item.captures
          .filter((c: any) => c && String(c.from ?? "").trim() && String(c.name ?? "").trim())
          .map((c: any) => ({
            id: id(),
            from: String(c.from),
            name: String(c.name),
            lastValue: null,
          }))
      : [];

    tabs.push({
      id: id(),
      method,
      url,
      body: String(item?.body ?? ""),
      headers,
      response: null,
      loading: false,
      label: String(item?.name ?? `${method} ${url}`),
      tests,
      captures,
      pathParams:
        item?.pathParams && typeof item.pathParams === "object" ? item.pathParams : {},
    });
  }

  if (tabs.length === 0) return null;

  const variables: Variable[] = Array.isArray(raw.variables)
    ? raw.variables
        .filter((v: any) => v && String(v.key ?? "").trim())
        .map((v: any) => ({ key: String(v.key).trim(), value: String(v.value ?? "") }))
    : [];

  return {
    name: String(raw.name ?? "workspace"),
    baseUrl: String(raw.baseUrl ?? ""),
    variables,
    tabs,
  };
}

// The name the file is given when the app writes it. Beside the code, not in a
// downloads folder: the requests belong to the project the same way its tests
// do, and the runner looks here first.
export const FILENAME = "reqflow.collection.json";
