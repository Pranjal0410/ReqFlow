/**
 * The project every model is asked to add to, and the tasks it is asked for.
 *
 * Kept apart from the harness because the fixture is the part that decides
 * whether the benchmark is worth anything. An easy project produces a table
 * where every model scores full marks, which reads as "they are all fine" and
 * means "this measured nothing". The first version of this was exactly that: a
 * bare router file with no dependencies, on which a model that had already been
 * seen writing broken code scored three out of three.
 *
 * So this project has the things real ones have and models get wrong:
 *
 *   - a service layer, so a router that inlines its logic is visibly not
 *     matching the project. Layer invention was a real failure seen here.
 *   - an existing validation helper, so writing a new one is a style miss
 *     rather than a matter of taste.
 *   - an error shape used consistently, so a different one stands out.
 *   - real dependencies in package.json, so requiring something outside them
 *     is the actual failure that took a server down during this work.
 */

export interface Fixture {
  files: Record<string, string>;
  // what the harness boots
  entry: string;
}

const SERVICE = `const users = [{ id: 1, name: 'Ada Lovelace', email: 'ada@example.com' }];

function list() {
  return users;
}

function find(id) {
  return users.find((u) => u.id === Number(id));
}

function nextId() {
  return users.reduce((max, u) => Math.max(max, u.id), 0) + 1;
}

module.exports = { list, find, nextId, users };
`;

// A helper the project already has. A model that writes its own validation
// instead of using this one is not matching the project, however good its code
// is on its own.
const VALIDATE = `function required(body, fields) {
  const missing = fields.filter((f) => !body[f]);
  return missing.length ? \`\${missing.join(', ')} required\` : null;
}

module.exports = { required };
`;

const ROUTER = `const express = require('express');
const router = express.Router();
const usersService = require('../services/users');
const { required } = require('../lib/validate');

router.get('/', (req, res) => {
  res.json(usersService.list());
});

router.get('/:id', (req, res) => {
  const user = usersService.find(req.params.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  res.json(user);
});

module.exports = router;
`;

const SERVER = (port: number) => `const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/users', require('./routes/users'));
app.listen(${port}, () => console.log('ready'));
`;

export function fixture(port: number): Fixture {
  return {
    entry: "server.js",
    files: {
      "server.js": SERVER(port),
      "routes/users.js": ROUTER,
      "services/users.js": SERVICE,
      "lib/validate.js": VALIDATE,
      "package.json": JSON.stringify(
        { name: "bench-project", private: true, dependencies: { express: "^5.0.0" } },
        null,
        2
      ),
    },
  };
}

export interface Task {
  id: string;
  description: string;
  // how the harness proves the endpoint works, run against the booted server
  check: (call: Caller) => Promise<{ pass: boolean; why: string | null }>;
}

export type Caller = (
  method: string,
  path: string,
  body?: any
) => Promise<{ status: number; json: any }>;

export const TASKS: Task[] = [
  {
    id: "create",
    description:
      "POST /api/users that creates a user from name and email and returns the created user with status 201",
    async check(call) {
      const created = await call("POST", "/api/users", {
        name: "Grace Hopper",
        email: "grace@example.com",
      });
      if (created.status !== 201 && created.status !== 200) {
        return { pass: false, why: `create answered ${created.status}` };
      }
      if (created.json?.name !== "Grace Hopper" || created.json?.email !== "grace@example.com") {
        return { pass: false, why: "create did not echo what it was given" };
      }
      const id = created.json?.id;
      if (id === undefined || id === null) return { pass: false, why: "create returned no id" };

      // an endpoint that answers but stores nothing is not working
      const back = await call("GET", `/api/users/${id}`);
      if (back.status !== 200 || back.json?.name !== "Grace Hopper") {
        return { pass: false, why: "the created user could not be read back" };
      }
      return { pass: true, why: null };
    },
  },
  {
    id: "validated create",
    description:
      "POST /api/users that creates a user from name and email, rejecting the request with 400 when either field is missing, and returning the created user with 201 otherwise",
    async check(call) {
      const bad = await call("POST", "/api/users", { name: "No Email" });
      if (bad.status !== 400) {
        return { pass: false, why: `a request missing email answered ${bad.status}, not 400` };
      }
      const good = await call("POST", "/api/users", {
        name: "Katherine Johnson",
        email: "katherine@example.com",
      });
      if (good.status !== 201 && good.status !== 200) {
        return { pass: false, why: `a valid request answered ${good.status}` };
      }
      if (good.json?.id === undefined) return { pass: false, why: "valid create returned no id" };
      return { pass: true, why: null };
    },
  },
  {
    id: "update by id",
    description:
      "PATCH /api/users/:id that updates a user's name, answering 404 when the user does not exist and returning the updated user otherwise",
    async check(call) {
      const missing = await call("PATCH", "/api/users/9999", { name: "Nobody" });
      if (missing.status !== 404) {
        return { pass: false, why: `an unknown id answered ${missing.status}, not 404` };
      }
      const updated = await call("PATCH", "/api/users/1", { name: "Ada L" });
      if (updated.status !== 200) return { pass: false, why: `update answered ${updated.status}` };
      if (updated.json?.name !== "Ada L") {
        return { pass: false, why: "update did not return the new name" };
      }
      const back = await call("GET", "/api/users/1");
      if (back.json?.name !== "Ada L") return { pass: false, why: "the update did not stick" };
      return { pass: true, why: null };
    },
  },
];

// Style is scored on rules that can be checked rather than felt, and every one
// of these is a failure a real model produced during this work.
// Does the router call things the service actually provides? This is the failure
// the benchmark uncovered and the one no other check sees: every file compiles,
// the server boots, the untouched routes answer, and only the new endpoint dies
// with "is not a function". Compiling is about a file; this is about two files
// agreeing, which is what the product is really producing.
export function contractBreaks(routerCode: string, serviceExports: string[]): string[] {
  const called = new Set<string>();

  // usersService.create(...)
  for (const [, name] of routerCode.matchAll(/usersService\s*\.\s*(\w+)\s*\(/g)) {
    called.add(name);
  }
  // const { create } = require('../services/users')
  for (const [, names] of routerCode.matchAll(
    /\{([^}]*)\}\s*=\s*require\(['"]\.\.\/services\/users['"]\)/g
  )) {
    for (const raw of names.split(",")) {
      const name = raw.split(":")[0].trim();
      if (name) called.add(name);
    }
  }

  return [...called]
    .filter((name) => !serviceExports.includes(name))
    .map((name) => `router calls usersService.${name}, which the service does not export`);
}

export function styleViolations(code: string, projectFiles: string): string[] {
  const bad: string[] = [];

  const declared = ["express", "../services/users", "../lib/validate"];
  for (const [, dep] of code.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
    if (!declared.includes(dep)) {
      bad.push(`requires ${dep}, which this project does not use`);
    }
  }

  // referencing something nothing defines: the failure that took a server down
  for (const symbol of ["bodyParser", "asyncHandler", "Joi", "z"]) {
    const used = new RegExp(`\\b${symbol}\\s*\\.`).test(code);
    const defined = new RegExp(`(const|let|var)\\s+\\{?[^=]*\\b${symbol}\\b`).test(code);
    if (used && !defined) bad.push(`uses ${symbol}, which is defined nowhere`);
  }

  // the project keeps its data behind a service; a router that reaches past it
  // is not matching the shape it was shown
  if (/\busers\s*\.\s*push\s*\(/.test(code) && !/usersService|require\(['"]\.\.\/services/.test(code)) {
    bad.push("touches the users array directly instead of going through the service");
  }

  // it has a validation helper already
  if (/\b(function|const)\s+(validate|checkRequired|isValid)\b/.test(code)) {
    bad.push("writes its own validation instead of using the project's required()");
  }

  if (/router\.post\(\s*['"]\/:/.test(code)) {
    bad.push("puts the create route behind a path parameter");
  }

  // Registering on `app` inside a router file. It is not defined there, so the
  // file throws on load and takes every route in it down. This went uncounted
  // through a whole benchmark run: the endpoint failed and the style score
  // still read zero, which made a real, repeated fault invisible.
  if (/\bapp\s*\.\s*(get|post|put|patch|delete|use)\s*\(/.test(code)) {
    bad.push("registers on app instead of the file's router");
  }

  // The routes in this file are relative to where the router is mounted, so a
  // path carrying the mount prefix is a different url from the one asked for.
  if (/router\.(get|post|put|patch|delete)\(\s*['"]\/api\//.test(code)) {
    bad.push("repeats the mount prefix in the route path");
  }

  const doubles = (code.match(/"/g) || []).length;
  const singles = (code.match(/'/g) || []).length;
  if (doubles > singles && doubles > 2) {
    bad.push("uses double quotes where the project uses single");
  }

  // the project answers errors as { error: "..." }
  if (/res\.status\(\d+\)\.json\(\s*\{\s*(message|msg|err)\s*:/.test(code)) {
    bad.push("uses a different error shape from the project's { error }");
  }

  void projectFiles;
  return bad;
}
