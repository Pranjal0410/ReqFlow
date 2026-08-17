import { parseError } from "../services/applyCode";
import {
  hasRealCode,
  coerceVerify,
  dropDuplicateLines,
  coerceLayers,
  snapPath,
  UnusableCode,
  registeredRoute,
  alignPath,
} from "../services/codegen";

// Told a project has no controller layer, the model answers with a controller
// entry whose body is a comment saying exactly that. Rendered as a tab, that is
// an empty file where a developer expects code, so the layer is judged on what
// survives having its comments stripped.
describe("hasRealCode", () => {
  it("rejects a block comment standing in for a layer", () => {
    expect(
      hasRealCode("/* This project does not use a separate controller layer */")
    ).toBe(false);
  });

  it("rejects line comments and whitespace", () => {
    expect(hasRealCode("// nothing to add here\n//\n   \n")).toBe(false);
    expect(hasRealCode("   ")).toBe(false);
  });

  it("keeps code that happens to be commented", () => {
    expect(hasRealCode("// adds a comment\nrouter.post('/x', handler);")).toBe(true);
    expect(hasRealCode("/** doc */\nconst f = () => 1;")).toBe(true);
  });
});

// The read-back request is sent for real against the user's server, so a plan
// the model only half committed to has to collapse to nothing. A route invented
// to fill the field would answer 404 and be reported as the new endpoint
// failing, which sends the developer to read code that is fine.
describe("coerceVerify", () => {
  it("keeps a complete plan", () => {
    expect(
      coerceVerify({ idFrom: "data.id", get: { method: "get", path: "/api/users/:id" } })
    ).toEqual({ idFrom: "data.id", get: { method: "GET", path: "/api/users/:id" } });
  });

  it("drops a plan with no route to read back", () => {
    expect(coerceVerify({ idFrom: "data.id" })).toBeNull();
    expect(coerceVerify({ idFrom: "data.id", get: {} })).toBeNull();
    expect(coerceVerify(null)).toBeNull();
    expect(coerceVerify("later")).toBeNull();
  });

  it("drops a path that is not a path", () => {
    expect(coerceVerify({ get: { method: "GET", path: "api/users" } })).toBeNull();
  });

  // a create endpoint that returns nothing useful still gets its route called
  it("allows a plan with no id to carry over", () => {
    expect(coerceVerify({ idFrom: "", get: { method: "GET", path: "/api/users" } })).toEqual({
      idFrom: null,
      get: { method: "GET", path: "/api/users" },
    });
  });
});

// A model asked for "only the new code" hands back the file's imports and its
// export too, because that is what a complete file looks like. Pasted in, a
// second `const router = express.Router()` is a SyntaxError, and the file stops
// loading — the endpoint that was just added takes the whole project with it.
describe("dropDuplicateLines", () => {
  const existing = `const express = require('express');
const router = express.Router();

const users = [];

router.get('/', list);

module.exports = router;`;

  it("removes a declaration the file already has", () => {
    const out = dropDuplicateLines(
      "const router = express.Router();\n\nrouter.post('/', create);",
      existing
    );
    expect(out).not.toContain("express.Router()");
    expect(out).toContain("router.post('/', create);");
  });

  it("removes a repeated export", () => {
    const out = dropDuplicateLines("router.post('/', create);\n\nmodule.exports = router;", existing);
    expect(out).not.toContain("module.exports");
    expect(out).toContain("router.post");
  });

  it("removes a repeated require", () => {
    const out = dropDuplicateLines("const express = require('express');\nrouter.put('/', x);", existing);
    expect(out).not.toContain("require('express')");
  });

  // the point is to remove duplicated structure, not duplicated behaviour
  it("keeps ordinary code that happens to appear twice", () => {
    const out = dropDuplicateLines("router.post('/', create);\n  res.json(user);", "  res.json(user);");
    expect(out).toContain("res.json(user)");
  });

  it("keeps a declaration the file does not already have", () => {
    const out = dropDuplicateLines("const MAX = 10;\nrouter.post('/', create);", existing);
    expect(out).toContain("const MAX = 10;");
  });

  it("leaves code alone when nothing is duplicated", () => {
    const code = "router.post('/', (req, res) => {\n  res.json({});\n});";
    expect(dropDuplicateLines(code, existing)).toBe(code);
  });

  it("does not leave a hole where the removed lines were", () => {
    const out = dropDuplicateLines(
      "const express = require('express');\nconst router = express.Router();\n\n\nrouter.post('/', create);",
      existing
    );
    expect(out).toBe("router.post('/', create);");
  });
});

// Told plainly not to, small models still answer src/routes/users.js for a
// project whose router is routes/users.js. Written as claimed, the code lands in
// a file nothing requires: it parses, the server boots, and the endpoint 404s
// with its own source sitting on disk.
describe("coerceLayers path snapping", () => {
  const references = [
    { layer: "router", path: "/proj/routes/users.js", content: "", reason: "" },
    { layer: "service", path: "/proj/services/users.js", content: "", reason: "" },
  ] as any;

  const layersOf = (raw: any) => coerceLayers(raw, references, "/proj");

  it("snaps an invented src/ prefix back to the real file", () => {
    const out = layersOf([{ layer: "router", path: "src/routes/users.js", code: "router.post('/', x);" }]);
    expect(out[0].path).toBe("routes/users.js");
  });

  it("leaves a path that is already the project's own alone", () => {
    const out = layersOf([{ layer: "service", path: "services/users.js", code: "function a() {}" }]);
    expect(out[0].path).toBe("services/users.js");
  });

  it("fills in the path when the model gave none", () => {
    const out = layersOf([{ layer: "router", path: "", code: "router.post('/', x);" }]);
    expect(out[0].path).toBe("routes/users.js");
  });

  // a layer the project genuinely does not have keeps what the model chose,
  // since there is no real file to snap it to
  it("keeps the claimed path for a layer the project does not have", () => {
    const out = layersOf([{ layer: "middleware", path: "middleware/auth.js", code: "const a = 1;" }]);
    expect(out[0].path).toBe("middleware/auth.js");
  });

  it("still drops a layer that is only a comment", () => {
    expect(layersOf([{ layer: "router", path: "routes/users.js", code: "// nothing here" }])).toHaveLength(0);
  });
});

// The protection that went missing when the two-step path was removed: the
// single-shot path never stripped repeated imports, so a model that returned
// them broke every file it touched.
describe("coerceLayers strips what the file already has", () => {
  const references = [
    {
      layer: "router",
      path: "/proj/routes/users.js",
      content:
        "const express = require('express');\nconst usersService = require('../services/users');\n\nmodule.exports = router;\n",
      reason: "",
    },
  ] as any;

  it("removes an import the file already declares", () => {
    const out = coerceLayers(
      [
        {
          layer: "router",
          path: "routes/users.js",
          code: "const usersService = require('../services/users');\n\nrouter.post('/', create);",
        },
      ],
      references,
      "/proj"
    );
    expect(out[0].code).not.toContain("require('../services/users')");
    expect(out[0].code).toContain("router.post('/', create);");
  });

  it("drops a layer left with nothing after the duplicates go", () => {
    const out = coerceLayers(
      [
        {
          layer: "router",
          path: "routes/users.js",
          code: "const express = require('express');\nconst usersService = require('../services/users');",
        },
      ],
      references,
      "/proj"
    );
    expect(out).toHaveLength(0);
  });
});

// A project with more than one router is the normal case, and the snapping used
// to assume there was only one. Asked for a products endpoint against a project
// with auth.js, incidents.js and users.js, it wrote products code into auth.js —
// an unrelated file, which does not answer the new route and can break the one
// it landed in.
describe("snapPath with several files per layer", () => {
  const real = new Set([
    "src/routes/auth.js",
    "src/routes/incidents.js",
    "src/routes/users.js",
    "src/services/authService.js",
  ]);
  const known = new Map([
    ["router", "src/routes/auth.js"],
    ["service", "src/services/authService.js"],
  ]);

  it("keeps a path that is a real file", () => {
    expect(snapPath("src/routes/incidents.js", "router", real, known)).toBe(
      "src/routes/incidents.js"
    );
  });

  it("fixes a misspelled path by matching the file name", () => {
    expect(snapPath("routes/incidents.js", "router", real, known)).toBe(
      "src/routes/incidents.js"
    );
  });

  it("allows a genuinely new resource its own file in the right directory", () => {
    // this is the regression: it used to come back as src/routes/auth.js
    expect(snapPath("src/routes/products.js", "router", real, known)).toBe(
      "src/routes/products.js"
    );
  });

  it("refuses a directory the project does not use", () => {
    expect(snapPath("lib/handlers/products.js", "router", real, known)).toBe(
      "src/routes/auth.js"
    );
  });

  it("falls back to the layer's file when nothing was claimed", () => {
    expect(snapPath("", "service", real, known)).toBe("src/services/authService.js");
  });
});

// The write refuses code that does not parse — correctly, nothing broken ever
// reaches the project. But that refusal arrives at the end of a review the
// developer has already done, and reads as the app failing rather than as the
// model having produced a stray bracket. "Unexpected token ')'" on a diff is not
// something anyone can act on.
describe("code that does not parse", () => {
  it("is recognised before it becomes a diff", () => {
    // the shape that actually reached a developer: an extra closing bracket,
    // reported as "Unexpected token ')'" at the end of a review they had
    // already read through
    const broken = "const setCommander = async (id) => {\n  return id;\n};\n)";
    expect(parseError("service.js", broken)).toBeTruthy();
  });

  it("is reported as the model's slip, not the project's problem", () => {
    const err = new UnusableCode("service code: Unexpected token ')'");
    expect(err.name).toBe("UnusableCode");
    // named so the caller can simply ask again instead of telling the developer
    // to go and fix something
    expect(err.message).toMatch(/does not parse/);
    expect(err.message).not.toMatch(/your project|check your/i);
  });

  it("does not fire on code that is merely unusual", () => {
    const fine = "const a = async () => ({ ok: true });\nmodule.exports = { a };";
    expect(parseError("service.js", fine)).toBeNull();
  });
});

// The stripper is for imports the target file already has. It matched any line
// starting with const, at any indentation — and a router holding
// `const { userId } = req.body;` in one handler had that exact line cut out of a
// newly generated one. The code parsed, applied, booted, and answered 500 on a
// name that was never bound.
describe("dropDuplicateLines only touches the file's own top level", () => {
  const router = `const express = require('express');
const { incidentService } = require('../services');

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  res.json({ status });
});
`;

  it("keeps a local that happens to match a line elsewhere in the file", () => {
    const block = `router.patch('/:id/priority', async (req, res) => {
  const { status } = req.body;
  res.json({ status });
});`;
    expect(dropDuplicateLines(block, router)).toContain("const { status } = req.body;");
  });

  it("still removes an import the file already has", () => {
    const block = `const { incidentService } = require('../services');

router.get('/x', async (req, res) => res.json({}));`;
    const kept = dropDuplicateLines(block, router);
    expect(kept).not.toContain("require('../services')");
    expect(kept).toContain("router.get('/x'");
  });

  it("keeps an import the file does not have", () => {
    const block = `const { User } = require('../models');\nrouter.get('/y', () => {});`;
    expect(dropDuplicateLines(block, router)).toContain("require('../models')");
  });

  it("does not treat an indented import as the file's own", () => {
    // a require inside a function is deliberate, and not the clash this guards
    const block = `router.get('/z', async () => {\n  const express = require('express');\n});`;
    expect(dropDuplicateLines(block, router)).toContain("require('express')");
  });
});

// A model wrote router.patch('/:id/commander', ...) and reported
// "method": "POST" in the same answer. ReqFlow verified with POST, got a 404,
// and told the developer their server was running code from before the write —
// while the route sat in the file, correct, under a different verb.
describe("the method comes from the code, not from beside it", () => {
  const router = (verb: string) => [
    { layer: "router", code: `router.${verb}('/:id/commander', async (req, res) => res.json({}));` },
    { layer: "service", code: "const updateCommander = async () => ({});" },
  ];

  it("reads the verb the route actually registers", () => {
    expect(registeredRoute(router("patch"))).toEqual({
      method: "PATCH",
      path: "/:id/commander",
    });
  });

  it("ignores a registration that is not the router's", () => {
    const layers = [
      { layer: "service", code: "// router.get('/x') is mentioned here in a comment" },
    ];
    expect(registeredRoute(layers)).toBeNull();
  });

  it("has nothing to say when no route is registered", () => {
    expect(registeredRoute([{ layer: "router", code: "const a = 1;" }])).toBeNull();
  });

  it("keeps the mount and takes the tail the code registered", () => {
    expect(alignPath("/api/incidents/:id/commander", "/:id/commander")).toBe(
      "/api/incidents/:id/commander"
    );
    // the model named a different tail than the one it wrote
    expect(alignPath("/api/incidents/:id/lead", "/:id/commander")).toBe(
      "/api/incidents/:id/commander"
    );
  });

  it("leaves the path alone when there is nothing to align it to", () => {
    expect(alignPath("/api/incidents", undefined)).toBe("/api/incidents");
    expect(alignPath("/api/incidents", "/")).toBe("/api/incidents");
  });

  it("does not cut a path shorter than the tail it read", () => {
    expect(alignPath("/x", "/a/b/c")).toBe("/x");
  });
});
