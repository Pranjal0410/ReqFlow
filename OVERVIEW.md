# ReqFlow — technical overview

## What it does

Turns a description of an API change into code that is generated in the
project's own style, reviewed as a diff, applied to the real files, and then
**run against the project's actual server** — returning one honest verdict about
whether it works.

The last step is the product. A generator that writes a file and calls that
success has told you nothing.

## The pipeline

```
  what you asked for
        ↓
  project context          the real files for the layers being written,
        ↓                  and your standing instructions
  the model
        ↓
  structured change plan   JSON with a schema, not free text
        ↓
  validation               paths, syntax, duplicate imports, export merge
        ↓
  diff                     every line, before anything is written
        ↓
  apply                    files written, backed up or covered by git
        ↓
  server ownership         start / restart / leave alone
        ↓
  runtime verification     call the endpoint, read the result back
        ↓
  one honest verdict
```

## Six decisions worth defending

**1. The model returns a structured plan, not text to paste.**
It answers with a schema — method, path, layers, request, verification plan —
and for a local model the sampler is constrained by a grammar so the shape cannot
be wrong. Free text into a file is how a generator becomes a liability.

**2. Paths come from the project, not from the model.**
A path that resolves outside the project folder is refused. Paths are snapped to
the project's real files: told plainly not to, models still answer
`src/routes/users.js` for a project whose router is `routes/users.js`, and code
written there lands in a file nothing requires — the endpoint 404s with its own
source sitting on disk.

**3. Applying preserves what is already there.**
Exports are *merged*, not replaced and not ignored. New code is inserted above a
file's trailing export, never after it, where it would be read by node and
registered by nobody. Repeated imports are stripped. The result is parsed before
it is written, and a file that would not load is refused.

**4. Runtime verification is the authority.**
Static checks are early warnings — there is an undefined-identifier check, and it
is deliberately not a gate, because JavaScript scope is not statically decidable
and a warning that cries wolf is one people learn to click past. What settles it
is calling the endpoint.

**5. ReqFlow only manages processes it started.**
It will start your project so that applying and verifying are one action, and
restart the server it started so what answers is the code on disk now. A server
running in your own terminal is detected and left alone — it may be mid-request
or attached to a debugger, and no verification result is worth taking it down to
get. When ReqFlow is running your server it says so, with a Stop beside it.

**6. The provider is an interface, and the default was chosen by measurement.**
Gemini is the default. Local models run through the same pipeline and stay
available for work that cannot leave the machine.

## Benchmark

`backend/bench/modelBench.ts`. Same machine (M2, 16GB), same fixture, same three
tasks, five runs each, one pipeline for every candidate — 60 generations. Each one
is applied to a fresh copy of a small Express project with a router, a service and
a validation helper, then the project is booted, the endpoint is called and the
result is read back. Nothing is scored by reading the code.

| | Gemini flash-lite | Phi-4-mini 3.8B | Qwen2.5-Coder 1.5B | Qwen2.5-Coder 3B |
| --- | --- | --- | --- | --- |
| Generation, median | **3.0s** | 30.1s | 29.2s | 24.9s |
| Endpoint actually works | **15/15** | 0/15 | 0/15 | 0/15 |

**Model selection was based on end-to-end product correctness and latency, not
model size or theoretical capability.**

## What the benchmark found in ReqFlow itself

It was built to choose a model. Most of what it caught was ours.

**Export corruption.** The generated code was right. A service told to add
`create` wrote the whole export list again; the application layer inserted it
above the file's own export, so the original ran last and won — `create` was
defined and never exported. Every file parsed, the server booted, the routes that
already worked kept working, and only the new endpoint answered
`usersService.create is not a function`. Nothing but calling it could find that.
Fixed by merging exports rather than replacing or ignoring them, with regression
tests for both directions: a block that restates a partial export must not delete
what it omits, and a block that restates none must still get its new function
exported.

**Cross-file context.** Local models wrote `usersService.nextId()` *inside the
service that is usersService* — an identifier that only exists in the router.
They were being asked for one layer at a time, so the file writing the service
had never seen the router that would call it. That was our pipeline, not their
capability: generation is now a single call in which every layer is written
having seen the others.

**A retry that could never work.** The daily quota on the model key ran out
during this work, and the app said "The model is busy right now — ask again to
carry on." It was answering from the branch that matches a 429, and a spent quota
is a 429; the branch that knows what a quota is sat below it, unreachable. So the
one failure a developer cannot fix by waiting was the one they were told to wait
out, and the retry loop had already spent three more requests against it. The
quota case is now tested and answered first, with the two things that actually
help — billing, or a local model. Settings shows the same sentence rather than
the seven hundred characters of JSON the provider sends.

**Runtime verification, proved rather than asserted.** A fault was planted that
survives every static check — the file parses, the server boots, the untouched
routes answer — and the endpoint was reported as
`Applied, not working: POST /api/users returned 500`. The happy path was never
the hard part.

Two more, worth a line each: a fence stripper that removed the backticks from
` ```javascript ` and left the word behind — still valid JavaScript, so it parsed,
was written, and took the server down with `javascript is not defined`; and a
schema loose enough to permit `"layers": []`, which one model then returned every
single time, correctly.

## Testing

| | |
| --- | --- |
| Backend | 289 tests, 18 suites |
| Frontend | 113 tests, 10 suites |
| Desktop | 56 tests, 3 suites |

The desktop suite reported 42 for a while. The missing fourteen were the ones
that bind port 4000 to test what ReqFlow decides about whoever already holds it,
and their guard asked whether the port could be bound rather than whether
anything was answering there — which a running ReqFlow passes. So they ran, found
the live app, and failed as six confusing assertions. The guard now asks the
question the tests are about, and says plainly what it found.

Unit tests cover parsing, path resolution, export merging, duplicate removal,
provider logic, model-failure wording and cancellation. Integration tests cover
all three server ownership paths end to end, each asserted against what the
server actually serves afterwards rather than against a message.

The demo is scripted and run from a clean state. Because the model's answer is
the one non-deterministic step, the half that follows it is exercised separately
with a plan captured from a real generation: reset the project, diff, apply,
reload, call the endpoint, read the result back. Fifteen consecutive runs, timed
at 3.7s from apply to verdict every time, with the last run of each batch
carrying a planted fault that the endpoint cannot avoid — a green verdict there
would mean the check is decorative.

## Known limitations

- The desktop package is unsigned; distribution needs an Apple Developer
  certificate and notarisation.
- Dark theme only, deliberately.
- The undefined-identifier check is an early warning, not a gate.
- Local models are an offline option, not a faster or better one.
- The default model runs on a free tier with a daily request cap. It is honest
  about running out — the status dot goes red before you ask for anything — but
  a day of heavy use can reach it.
