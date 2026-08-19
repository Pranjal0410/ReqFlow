import { Router, Request, Response } from "express";
import { generateEndpoint, GeneratedLayer, VerifyPlan } from "../services/codegen";
import { UnreadableFolderError } from "../services/fileReader";
import { coerceInstructions } from "../services/instructions";
import { planApply, applyPlan, OutsideProjectError, AccessDenied } from "../services/applyCode";
import { waitForServer } from "../services/readiness";
import { beginRun, endRun, cancelRun } from "../services/cancellation";
import { restartProject, startProject, isOurs, Ownership } from "../services/projectRunner";
import { forwardRequest } from "../services/proxy";

const router = Router();

// Code for an endpoint that does not exist yet, written in the style of the
// endpoints that do. This route only generates: putting the result into the
// project is /apply below, behind a preview the developer has to approve.
router.post("/", async (req: Request, res: Response) => {
  const { projectPath, description, instructions } = req.body;

  if (!projectPath) {
    return res.status(400).json({ error: "projectPath is required. Scan a project first." });
  }
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: "description is required" });
  }

  try {
    res.json(
      await generateEndpoint(
        String(projectPath),
        String(description).trim(),
        coerceInstructions(instructions)
      )
    );
  } catch (err: any) {
    // codegen reads the project to copy its style, so it meets the same refusal
    // the scan does, and for the same reason it is not a server fault
    const status = err instanceof UnreadableFolderError ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

function readLayers(raw: any): GeneratedLayer[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const layers: GeneratedLayer[] = [];
  for (const l of raw) {
    if (!l || typeof l.path !== "string" || typeof l.code !== "string") return null;
    if (!l.path.trim() || !l.code.trim()) return null;
    layers.push({ layer: String(l.layer || "code"), path: l.path, code: l.code });
  }
  return layers;
}

function writeFailed(err: any, res: Response) {
  if (err instanceof OutsideProjectError) return res.status(400).json({ error: err.message });
  if (err instanceof UnreadableFolderError) return res.status(403).json({ error: err.message });

  // Named so the app can offer the folder dialog rather than only quoting the
  // sentence that tells the developer to go and find it themselves.
  if (err instanceof AccessDenied && err.recoverable) {
    return res.status(403).json({ error: err.message, code: "ACCESS_DENIED", errno: err.errno });
  }

  return res.status(500).json({ error: err.message });
}

// What the write would do, without doing any of it. Every field the preview
// shows comes from the same function that performs the write, so the diff on
// screen cannot describe one thing while the apply does another.
router.post("/plan", (req: Request, res: Response) => {
  const { projectPath, layers } = req.body;
  const parsed = readLayers(layers);

  if (!projectPath) return res.status(400).json({ error: "projectPath is required" });
  if (!parsed) return res.status(400).json({ error: "layers must each have a path and code" });

  try {
    const plan = planApply(String(projectPath), parsed);
    // nextContent is the whole file after the write, which the preview does not
    // need and which would be the largest thing in the response by far
    res.json({
      files: plan.files.map(({ nextContent, absPath, ...rest }) => rest),
      git: plan.git,
      backups: plan.backups,
    });
  } catch (err: any) {
    writeFailed(err, res);
  }
});

// The write itself. The plan is rebuilt here from the same two inputs rather
// than accepted from the client: a request that could name its own destination
// and contents would be a write-anything endpoint wearing a preview.
router.post("/apply", async (req: Request, res: Response) => {
  const { projectPath, layers } = req.body;
  const parsed = readLayers(layers);

  if (!projectPath) return res.status(400).json({ error: "projectPath is required" });
  if (!parsed) return res.status(400).json({ error: "layers must each have a path and code" });

  try {
    res.json({ applied: await applyPlan(planApply(String(projectPath), parsed)) });
  } catch (err: any) {
    writeFailed(err, res);
  }
});

// Where the new record's id is in the create response. "data.id" is how this
// app spells it everywhere the user sees it, and "id" is what a model reaches
// for, because that is the field's actual name. Both are accepted: they name the
// same field of the same body, and refusing the second one meant a verified
// endpoint reporting that its id was missing when the id was right there.
export function readId(body: any, idFrom: string | null): string | null {
  if (!idFrom) return null;

  const parts = idFrom.split(".").filter(Boolean);
  if (parts.length === 0) return null;

  const path = parts[0] === "data" ? parts.slice(1) : parts;
  let cursor: any = body;

  for (const key of path) {
    if (cursor === null || typeof cursor !== "object") return null;
    cursor = cursor[key];
  }

  // an object would go into a url as [object Object], and the whole body is not
  // an id however the field was spelled
  if (cursor === null || cursor === undefined || typeof cursor === "object") return null;
  return String(cursor);
}

const PATH_PARAM = /:[A-Za-z_][A-Za-z0-9_]*/;

export function fillPathParam(path: string, id: string | null): string {
  if (!id) return path;
  return path.replace(PATH_PARAM, encodeURIComponent(id));
}

// The endpoint's own path parameters. An endpoint whose path carries an :id
// cannot be called at all without one, and until this the literal ":id" was
// sent — so every PATCH /users/:id and DELETE /users/:id came back 404 and read
// as a broken endpoint rather than a request that was never properly formed.
export function fillNamedParams(
  path: string,
  values: Record<string, string> | undefined
): string {
  if (!values) return path;
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name) =>
    values[name] === undefined || values[name] === null
      ? whole
      : encodeURIComponent(String(values[name]))
  );
}


// The collection an :id-carrying path belongs to. /api/incidents/:id/priority is
// a thing you do to one incident, and the list of incidents is one segment above
// the parameter.
export function collectionOf(path: string): string | null {
  const at = path.split("/").findIndex((seg) => seg.startsWith(":"));
  if (at <= 0) return null;
  return path.split("/").slice(0, at).join("/") || null;
}

// An id that actually exists, taken from the running server rather than invented.
//
// A generated PATCH /incidents/:id could not be checked at all: the value was
// not ours to make up, and a guessed one answers 404 in a way indistinguishable
// from a broken endpoint. But the developer's own server knows a real id, and
// asking it is exactly what they would do by hand — so the collection is fetched
// and the first record's id is used. Nothing is invented; if the list is empty
// or shaped unexpectedly, the honest "not run" answer stands.
// Every id in the collection, in order, so a record the endpoint refuses can be
// followed by one it accepts.
export function idsIn(payload: any): string[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
    ? (Object.values(payload).find(Array.isArray) as any[] | undefined) ?? []
    : [];

  const ids: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    for (const key of ["id", "_id", "uuid", "slug"]) {
      const v = (item as any)[key];
      if (typeof v === "string" && v) return_push(ids, v);
      else if (typeof v === "number") return_push(ids, String(v));
      else continue;
      break;
    }
  }
  return ids;
}

function return_push(into: string[], value: string) {
  if (!into.includes(value)) into.push(value);
}


// A literal record id sitting in a path the model wrote.
//
// Asked for a read-back route, a model will happily answer
// /api/incidents/60d5ec49f3e4b8001f8e4d3a/assignees — a real-looking ObjectId
// that exists in no database anywhere. Sent as written it answers 404, and a
// read-back 404 turned an endpoint that had just answered 200 into "Applied,
// not working". The id was never ours to send.
const LITERAL_ID =
  /\/([0-9a-fA-F]{24}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d{6,})(?=\/|$)/;

export function hasInventedId(path: string, known: (string | null)[]): boolean {
  const match = LITERAL_ID.exec(path);
  if (!match) return false;
  return !known.filter(Boolean).includes(match[1]);
}

// Swap the invented value for the record this run actually used.
export function useKnownId(path: string, id: string): string {
  return path.replace(LITERAL_ID, `/${id}`);
}

// Why ReqFlow could not find a record to run this endpoint against, and what to
// do about it. There are three different reasons and they used to share one
// sentence — the developer was told "no record to use" whether the list needed a
// login, was genuinely empty, or did not exist at all.
export function describeLookup(collection: string | null, blockedBy: number | null): string {
  if (!collection) {
    return "there is no collection to take one from. Fill it in on the request tab and send it yourself.";
  }
  if (blockedBy === 401 || blockedBy === 403) {
    return `${collection} needs a login before it will list anything, and this workspace has no credential to offer it. Ask the agent to log in — it will save the token as {{token}} — then apply again, or fill the value in on the request tab and send it yourself.`;
  }
  if (blockedBy === 404) {
    return `${collection} does not exist on this server, so there was nothing to take an id from. Fill it in on the request tab and send it yourself.`;
  }
  if (blockedBy !== null) {
    return `${collection} answered ${blockedBy}, so there was no record to take an id from. Fill it in on the request tab and send it yourself.`;
  }
  return `${collection} is empty, so there is no record to run this against yet. Create one first, or fill the value in on the request tab and send it yourself.`;
}

// An id in the request body that names a record on the developer's server.
//
// A generated test body arrives holding "commanderId": "60d5ec49f3e4b8001f8b4568"
// — a real-looking ObjectId belonging to nobody. The endpoint validates that the
// user exists, correctly answers 400, and ReqFlow reports the endpoint as not
// working when what was wrong was the request it made up.
//
// So the invented value is swapped for one that exists. The collection is taken
// from the field's own name — commanderId and userId both point at users — and
// it is fetched from the running server, so nothing here is guessed: either a
// real record answers or the original body is left exactly as it was.
export function collectionForField(field: string): string[] {
  const base = field.replace(/[_-]?id$/i, "");
  if (!base) return [];

  const guesses = [`/api/${base.toLowerCase()}s`, `/api/${base.toLowerCase()}`];
  // a field naming a person points at users however it is spelled: commander,
  // assignee, owner, author, reporter
  if (/user|commander|assignee|owner|author|reporter|createdby|updatedby/i.test(field)) {
    guesses.unshift("/api/users");
  }
  return [...new Set(guesses)];
}

// the body travels as a string on the wire and as an object here
export function parseBody(body: any): Record<string, any> {
  if (!body) return {};
  if (typeof body === "object") return { ...body };
  try {
    const parsed = JSON.parse(String(body));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function idFieldsIn(body: any): { field: string; value: string }[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const found: { field: string; value: string }[] = [];
  for (const [field, value] of Object.entries(body)) {
    if (typeof value !== "string") continue;
    if (!LOOKS_LIKE_ID.test(value)) continue;
    found.push({ field, value });
  }
  return found;
}

const LOOKS_LIKE_ID =
  /^([0-9a-fA-F]{24}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d{6,})$/;

// What to do next, in terms of the status that actually came back.
//
// "Read your server's output, fix it, or undo with git" was the same sentence
// for every failure, including the ones that are not failures. An endpoint told
// to answer 409 when a record is already resolved, answering 409 on a record
// that is already resolved, has done exactly what was asked — reporting that as
// broken with no direction leaves the developer to work out which of the two it
// was.
export function nextStepFor(status: number, method: string, path: string): string | null {
  if (status === 401 || status === 403) {
    return "The endpoint needs credentials this request did not carry. Add them on the request tab and send it yourself.";
  }
  if (status === 409) {
    return `${method} ${path} refused this record's current state, which may be exactly what you asked it to do. Nothing is wrong with the code on that evidence — try a record in a different state, or send it from the request tab.`;
  }
  if (status === 400 || status === 422) {
    return "The endpoint rejected the request body. Check the fields on the request tab against what the code validates, then send it yourself.";
  }
  if (status === 404) {
    return `${method} ${path} answered 404. Either the route is not registered where you think it is, or the record in the path does not exist — the request tab shows which id was used.`;
  }
  if (status === 405) {
    return `The route exists but not for ${method}. Check the method against how it was registered.`;
  }
  if (status >= 500) {
    return "The endpoint threw. Your server's output has the stack trace, and the change is still in your files.";
  }
  return null;
}

export function firstIdIn(payload: any): string | null {
  // A list comes back under whatever name the project chose — data, items,
  // results, or "incidents". Naming a fixed set of wrappers only works on APIs
  // that happened to pick one of them, so any single array property will do.
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
    ? (Object.values(payload).find(Array.isArray) as any[] | undefined) ?? null
    : null;
  if (!list || list.length === 0) return null;

  const first = list[0];
  if (!first || typeof first !== "object") return null;

  for (const key of ["id", "_id", "uuid", "slug"]) {
    const v = (first as any)[key];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

const joinUrl = (base: string, path: string) => `${base.replace(/\/+$/, "")}${path}`;

// Stopping a verification that is under way. The files are already written by
// this point and stay written — what stops is the waiting and the requests, which
// is the part that can take twenty seconds. A server ReqFlow started for the run
// keeps running and stays visible with its own Stop, rather than being killed
// from under a change that is now in the project.
router.post("/cancel/:runId", (req: Request, res: Response) => {
  const cancelled = cancelRun(String(req.params.runId));
  res.json({
    cancelled,
    detail: cancelled ? "cancelling" : "that run had already finished",
  });
});

// Run the endpoint that was just written, then read it back. The point is that
// nobody does these two by hand to find out whether the generation was any
// good, and that the answer comes from the real server rather than from a model
// saying it looks right.
router.post("/verify", async (req: Request, res: Response) => {
  const { baseUrl, method, path, headers, body, verify, serverWasUp, projectPath, pathParams, runId, fallbackAuth } =
    req.body;

  if (!baseUrl) return res.status(400).json({ error: "baseUrl is required" });
  if (!path) return res.status(400).json({ error: "path is required" });

  const base = String(baseUrl).replace(/\/+$/, "");
  const plan: VerifyPlan | null = verify && typeof verify === "object" ? verify : null;

  // Where the time goes, measured rather than guessed. Pressing Apply took the
  // better part of a minute in a real run and nobody could say which part of it
  // was slow — reloading, waiting, or the requests. Optimising before knowing
  // that is how the wrong thing gets faster.
  const phases: { phase: string; ms: number }[] = [];
  const timed = async <T>(phase: string, work: () => Promise<T>): Promise<T> => {
    const at = Date.now();
    try {
      return await work();
    } finally {
      phases.push({ phase, ms: Date.now() - at });
    }
  };

  const signal = beginRun(runId);

  const stopped = () => ({
    ready: false,
    cancelled: true,
    waitedMs: 0,
    phases,
    message:
      "Stopped. The change is in your files — nothing was undone — but it was not checked.",
  });

  try {
    // Reload the project first, so what answers is the code that was just
    // written. Without this the whole flow rests on the developer happening to
    // run a watcher: under plain `node server.js` the endpoint 404s against a
    // process from before the change, and they have to notice and restart it
    // themselves — which is the work this is here to remove.
    let reload = "";
    let ownership: Ownership = "existing";

    if (projectPath) {
      await timed("reload", async () => {
        if (isOurs(String(projectPath))) {
          const restarted = await restartProject(String(projectPath), base, signal);
          ownership = restarted.ownership;
          reload = restarted.started
            ? `${restarted.detail}. `
            : `could not restart it: ${restarted.detail}. `;
        } else if (!(await waitForServer(base, 1200, signal)).up) {
          // nothing is listening, so there is nothing of anyone's to disturb
          const started = await startProject(String(projectPath), base, signal);
          ownership = started.ownership;
          reload = started.started
            ? `${started.detail}. `
            : `could not start it: ${started.detail}. `;
        }
        // something is listening that ReqFlow did not start: it is the
        // developer's, and a watcher will pick the change up. If it does not,
        // the 404 below says so rather than this killing their process.
      });
    }

    if (signal?.aborted) return res.json(stopped());

    const readiness = await timed("wait for ready", () => waitForServer(base, undefined, signal));
    if (signal?.aborted) return res.json(stopped());
    if (!readiness.up) {
      // A server that was answering before the write and is not answering after
      // it did not choose that moment to stop. Saying only "nothing answered"
      // sends the developer to look at their server; saying what changed sends
      // them to the diff they just approved, which is where the fault is. This
      // is the failure that matters most, because generated code that does not
      // load takes the whole project down with it, not just its own endpoint.
      const weBrokeIt = serverWasUp === true;
      return res.json({
        ready: false,
        waitedMs: readiness.waitedMs,
        brokeServer: weBrokeIt,
        phases,
        ownership,
        message: weBrokeIt
          ? `${reload}${base} was answering before the write and stopped after it, so the code just added is the likely cause — read your server's output. Undo it with git, or from the .reqflow.bak copy if the project is not a repository.`
          : `${reload}Nothing answered on ${base} after ${(readiness.waitedMs / 1000).toFixed(
              1
            )}s.`,
      });
    }

    let createPath = fillNamedParams(String(path), pathParams);

    // the headers the endpoint is actually called with. it starts as what the
    // generated request carried and can gain the workspace's credential below,
    // when the server itself says one is needed.
    let callHeaders: Record<string, string> =
      headers && typeof headers === "object" ? { ...headers } : {};

    // No value was given for the path parameter, so one is looked up rather than
    // invented: the endpoint's own collection is fetched from the server that is
    // already running, and the first record's id is used. This is the difference
    // between "we could not check this" and a real answer, for every endpoint
    // that acts on one record — which is most of the ones worth generating.
    let discoveredId: string | null = null;
    let candidates: string[] = [];
    // why the lookup came back empty, kept apart from the fact that it did.
    // "returned no record to use" about a list that answered 401 describes the
    // symptom and hides the cause, and the cause is the part with a way out.
    let lookupBlockedBy: number | null = null;
    if (PATH_PARAM.test(createPath)) {
      const collection = collectionOf(createPath);
      if (collection) {
        // the same headers the request itself carries: on a real API the
        // collection is behind the same token as the endpoint being checked, so
        // looking it up unauthenticated would find nothing on exactly the
        // projects where this matters most
        let listed = await timed("find a record to act on", () =>
          forwardRequest({ method: "GET", url: joinUrl(base, collection), headers: callHeaders })
        );

        // A 401 is not a guess about anything — it is the server saying, in so
        // many words, that this needs a credential. The generated request did
        // not carry one, but the developer is already using one in this
        // workspace, so it is offered once rather than reporting "no record to
        // use" about a list that is simply behind a login.
        if ((listed.status === 401 || listed.status === 403) && fallbackAuth) {
          listed = await timed("find a record to act on, signed in", () =>
            forwardRequest({
              method: "GET",
              url: joinUrl(base, collection),
              headers: { ...callHeaders, Authorization: String(fallbackAuth) },
            })
          );
          // if that is what got us in, the endpoint itself needs it too
          if (listed.status >= 200 && listed.status < 300) {
            callHeaders = { ...callHeaders, Authorization: String(fallbackAuth) };
          }
        }

        if (listed.status >= 200 && listed.status < 300) {
          candidates = idsIn(listed.data);
          discoveredId = candidates[0] ?? null;
          if (discoveredId) createPath = fillPathParam(createPath, discoveredId);
        } else {
          lookupBlockedBy = listed.status;
        }
      }
    }

    // Sending the literal ":id" would 404 against a route that is perfectly
    // fine, and be reported as the endpoint not working. Saying what is missing
    // is the honest answer, and it is a different one.
    if (PATH_PARAM.test(createPath)) {
      return res.json({
        ready: true,
        waitedMs: readiness.waitedMs,
        pickedUp: true,
        phases,
        ownership,
        message: `${reload}${String(method || "POST")} ${path} needs a value in its path, and ${describeLookup(
          collectionOf(String(path)),
          lookupBlockedBy
        )}`,
      });
    }

    // Body ids the model made up, swapped for records that exist. Done before
    // the call rather than after a 400, so the endpoint is judged on a request
    // its own project could have produced.
    let sentBody = body;
    const bodyIds = idFieldsIn(parseBody(body));
    if (bodyIds.length > 0) {
      const parsed = parseBody(body);
      let changed = false;
      for (const { field, value } of bodyIds) {
        if (value === discoveredId) continue;
        for (const collection of collectionForField(field)) {
          const listed = await timed(`find a real ${field}`, () =>
            forwardRequest({ method: "GET", url: joinUrl(base, collection), headers: callHeaders })
          );
          if (listed.status < 200 || listed.status >= 300) continue;
          const real = firstIdIn(listed.data);
          if (!real) continue;
          parsed[field] = real;
          changed = true;
          break;
        }
      }
      if (changed) sentBody = JSON.stringify(parsed);
    }

    let createUrl = joinUrl(base, createPath);
    let create = await timed("run the endpoint", () =>
      forwardRequest({
        method: String(method || "POST"),
        url: createUrl,
        headers: callHeaders,
        body: sentBody ?? undefined,
      })
    );

    // A 409 says the endpoint refused this record's state — an incident already
    // resolved, an order already shipped. That is the endpoint working, on the
    // wrong record. So the next record is tried rather than reporting code that
    // behaved correctly as broken. Only a conflict is retried: a 400 or a 500
    // would say the same thing about every record, and spending real requests to
    // hear it again helps nobody.
    if (create.status === 409 && candidates.length > 1) {
      for (const id of candidates.slice(1, 5)) {
        const retryPath = fillPathParam(fillNamedParams(String(path), pathParams), id);
        const retry = await timed("try another record", () =>
          forwardRequest({
            method: String(method || "POST"),
            url: joinUrl(base, retryPath),
            headers: callHeaders,
            body: sentBody ?? undefined,
          })
        );
        if (retry.status !== 409) {
          create = retry;
          createUrl = joinUrl(base, retryPath);
          discoveredId = id;
          break;
        }
      }
    }

    // A server that never restarted answers the readiness poll instantly and
    // then has no idea about the route we just wrote. That is a stale process,
    // not a broken endpoint, and calling it the latter sends the developer to
    // read code that is fine.
    if (create.status === 404) {
      return res.json({
        ready: true,
        waitedMs: readiness.waitedMs,
        pickedUp: false,
        phases,
        ownership,
        create: { method: String(method || "POST"), url: createUrl, response: create },
        message: `${reload}${base} answered, but ${String(
          method || "POST"
        )} ${path} came back 404. It is running code from before the write — ReqFlow can only reload a server it started, so restart yours and try again.`,
      });
    }

    const result: any = {
      ready: true,
      waitedMs: readiness.waitedMs,
      pickedUp: true,
      phases,
      ownership,
      create: { method: String(method || "POST"), url: createUrl, response: create },
      // named, because "it worked" about a record the developer did not choose
      // is a claim they cannot check without being told which record it was
      usedRecordId: discoveredId,
      // what to do about this particular status, rather than the same sentence
      // about reading server output for every outcome
      nextStep: nextStepFor(create.status, String(method || "POST"), String(path)),
    };

    if (!plan?.get) {
      const ran = discoveredId
        ? `The endpoint ran against ${discoveredId}, taken from your own data.`
        : "The endpoint ran.";
      result.message = result.nextStep
        ? `${ran} ${result.nextStep}`
        : `${ran} No read-back route was named, so nothing followed it.`;
      return res.json(result);
    }

    const id = readId(create.data, plan.idFrom ?? null);
    let readPath = fillPathParam(String(plan.get.path), id);

    // The read-back must only ever name a record this run knows about: the one
    // the create response returned, or the one ReqFlow found to act on. Anything
    // else in that slot is the model's invention, and sending it spends a real
    // request to learn that a made-up id does not exist.
    if (hasInventedId(readPath, [id, discoveredId])) {
      if (discoveredId) {
        readPath = useKnownId(readPath, discoveredId);
      } else {
        result.message = [
          `${String(method || "POST")} ${path} answered ${create.status}.`,
          `The read-back route named a record this run never saw, so it was not sent —`,
          `checking it would only have proved that an invented id does not exist.`,
        ].join(" ");
        return res.json(result);
      }
    }

    // a path still holding :id would be sent literally and 404 on a route that
    // is fine, so it is reported as the create response not carrying the id
    if (PATH_PARAM.test(readPath)) {
      result.message = [
        `${plan.idFrom || "the id"} was not in the response, so ${plan.get.path} could not be filled in.`,
        `The endpoint itself answered ${create.status}.`,
        result.nextStep,
      ]
        .filter(Boolean)
        .join(" ");
      return res.json(result);
    }

    // captured before the closure: inside it, TypeScript can no longer see that
    // plan.get was checked above
    const readMethod = String(plan.get.method || "GET");
    const readUrl = joinUrl(base, readPath);
    const read = await timed("read it back", () =>
      forwardRequest({
        method: readMethod,
        url: readUrl,
        headers: callHeaders,
      })
    );

    result.read = { method: readMethod, url: readUrl, response: read };
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    endRun(runId);
  }
});

export default router;
