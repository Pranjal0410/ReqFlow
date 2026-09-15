// ReqFlow's own collection format, converted to Postman's — so a collection
// built here keeps working there, without the developer rebuilding it by hand.
//
// {{name}} is already how both formats spell a variable, so nothing in a url,
// header or body needs translating — {{BASE_URL}}, {{token}}, :id all mean
// the same thing to Postman they mean here. Only the JSON shape around them
// does: Postman's url is a structured object, its body carries a mode, and its
// environments are their own file.

import { randomUUID } from "crypto";

interface CollectionRequest {
  name: string;
  method: string;
  url: string;
  headers: { key: string; value: string; enabled: boolean }[];
  body: string;
}

interface Environment {
  name: string;
  variables: { key: string; value: string }[];
}

interface Collection {
  name: string;
  requests: CollectionRequest[];
  environments: Environment[];
}

interface PostmanUrl {
  raw: string;
  protocol?: string;
  host: string[];
  port?: string;
  path: string[];
  query?: { key: string; value: string }[];
}

function parseQuery(qs: string): { key: string; value: string }[] {
  return qs
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf("=");
      return at >= 0 ? { key: pair.slice(0, at), value: pair.slice(at + 1) } : { key: pair, value: "" };
    });
}

// {{BASE_URL}}/users/:id is the common case, since new tabs are built that way
// now — and it is Postman's own idiom for an environment-variable base url,
// so it goes straight into host rather than being read as one long path
// segment. Anything already absolute (an older collection, saved before
// environments existed) is split the ordinary way.
export function buildPostmanUrl(raw: string): PostmanUrl {
  const text = raw || "";

  if (text.startsWith("{{BASE_URL}}")) {
    const rest = text.slice("{{BASE_URL}}".length);
    const [pathPart, queryString] = rest.split("?");
    const path = pathPart.split("/").filter(Boolean);
    return {
      raw: text,
      host: ["{{BASE_URL}}"],
      path,
      ...(queryString ? { query: parseQuery(queryString) } : {}),
    };
  }

  try {
    const url = new URL(text);
    return {
      raw: text,
      protocol: url.protocol.replace(":", ""),
      host: url.hostname.split("."),
      ...(url.port ? { port: url.port } : {}),
      path: url.pathname.split("/").filter(Boolean),
      ...(url.search ? { query: parseQuery(url.search.slice(1)) } : {}),
    };
  } catch {
    // not a real url yet — still holds an unresolved {{name}} of its own, or
    // was never given a scheme. kept as the one path segment it is rather
    // than dropped, so raw stays the source of truth Postman falls back to.
    return { raw: text, host: [], path: [text] };
  }
}

function buildItem(req: CollectionRequest) {
  const item: any = {
    name: req.name,
    request: {
      method: req.method,
      header: (req.headers || [])
        .filter((h) => h.key && h.key.trim())
        .map((h) => ({ key: h.key, value: h.value, disabled: h.enabled === false })),
      url: buildPostmanUrl(req.url),
    },
  };

  if (req.body && req.body.trim()) {
    item.request.body = {
      mode: "raw",
      raw: req.body,
      options: { raw: { language: "json" } },
    };
  }

  return item;
}

export function buildPostmanCollection(collection: Collection) {
  return {
    info: {
      name: collection.name || "workspace",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: (collection.requests || []).map(buildItem),
  };
}

export function buildPostmanEnvironment(env: Environment) {
  return {
    id: randomUUID(),
    name: env.name || "environment",
    values: (env.variables || [])
      .filter((v) => v.key && v.key.trim())
      .map((v) => ({ key: v.key, value: v.value || "", type: "default", enabled: true })),
    _postman_variable_scope: "environment",
  };
}
