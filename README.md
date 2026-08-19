# ReqFlow

An API client that reads your project and figures out what endpoints you have,
so you are not typing URLs into Postman by hand every time.

Point it at a Node project folder. It scans the code, lists the routes it finds,
and you can send requests to any of them. There is also an agent that writes new
endpoints into the project — and then runs them, so you find out whether they
work rather than being told they were written.

Express and TypeScript on the backend, Expo and React Native on the frontend. It
runs in the browser and as a desktop app on macOS, Windows and Linux.

## The loop

```
describe the change  →  ReqFlow writes it in your project's style
                     →  you read a diff of every line it would touch
                     →  Apply
                     →  ReqFlow reloads your project
                     →  it calls the new endpoint and reads the result back
                     →  one honest verdict
```

The last two steps are the point. A generator that writes code and calls that
success has told you nothing: the file parses, the server boots, and the endpoint
answers "is not a function". So the verdict has three values and only one is
green:

| | |
| --- | --- |
| **Applied, verified** | the code is in, the server took it, the endpoint answered as it should |
| **Applied, not working** | the code is in and the endpoint did not work — with the status it returned |
| **Applied, not verified** | the code is in and there was no way to check: nothing was listening, or you stopped it |

## What it does

**Scans a project.** Walks the folder, keeps the files that define routes, and
reads the method, path and expected body out of them. The body comes from what
the code actually requires, not from a guess.

**Sends requests.** Tabs, history, variables with `{{name}}`, saved examples per
endpoint with credentials stripped before anything reaches disk, assertions, and
a timing breakdown measured on the backend rather than estimated.

**Writes endpoints.** The model answers with a structured plan, not text to
paste. Paths are snapped to the project's real files — an endpoint about
incidents is written against your incidents router, not whichever router scored
highest. Your data models are read too, so the code queries fields your schema
actually declares. Exports are merged rather than replaced, imports the file
already has are dropped, and re-applying the same endpoint updates it instead of
declaring it twice.

**Runs what it wrote.** ReqFlow starts your project if nothing is listening,
restarts the one it started, and leaves a server you started yourself alone. An
endpoint that takes an `:id` gets a real one, looked up from your own running
server — signing in first when the list needs it — so `PATCH /incidents/:id/x`
can actually be checked. Ids in the request body are looked up the same way,
because an invented one makes a correct endpoint answer 400.

**Says what happened.** The verdict panel lists what was written, which server
answered, which record was used, and every request with its status. When
something fails it says what to do about that particular status rather than
"read your server's output" for all of them.

## The agent

Ask for an endpoint and it writes one. Ask it to test the endpoints you have and
it sends real requests, opening a tab for each with its response already in it.
It logs in when a route needs auth, saves the token as `{{token}}` so your tabs
keep working, and retries the request rather than reporting a 401 it could have
avoided. Every action is listed under the reply.

It writes files only while **Can edit files** is on. With it off, only GET and
login requests go out.

## Setup

### What you need

| | check it with |
| --- | --- |
| **Node 20 or newer** | `node -v` |
| **A Gemini API key** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free tier |

### Run it

```bash
# backend
cd backend
npm install
cp .env.example .env            # put your key in GEMINI_API_KEY
npm run dev

# frontend, in a second terminal
cd frontend
npm install
npx expo start --web
```

The backend listens on **4000** and the frontend on **8081**. Both have to be
free; nothing here will pick another port for you.

Then point **Base URL** at the server you want to exercise and press **Scan
Project** at its folder.

### If npm install stops on node-llama-cpp

That is the optional local model, and it installs a native binary. Most machines
get a prebuilt one and never notice. If yours has to build it instead, the
install dies in node-gyp with an error that says nothing about ReqFlow, and you
need:

| | |
| --- | --- |
| **Python 3** | `python3 --version` |
| **macOS** | `xcode-select --install` |
| **Debian / Ubuntu** | `sudo apt install build-essential` |

If it still complains about **expat** or another missing header:

```bash
# macOS
brew install expat pkg-config

# Debian / Ubuntu
sudo apt install libexpat1-dev pkg-config
```

You can also skip it and use the hosted model:

```bash
cd backend && npm install --omit=optional
```

That is enough to run the app, but **not enough to package it** — `--omit=optional`
also drops TypeScript's platform binary, and `npm run build` needs it. Do a full
`npm install` before building the desktop app.

### As a desktop app

```bash
cd desktop && npm install && npm run build
```

Packaging installs the backend fresh with its optional dependencies included,
so a `--omit=optional` backend is not enough here — do a full `npm install` in
`backend/` first, or `tsc` fails on a missing platform binary. If the build
stops in node-gyp instead, that is `node-llama-cpp` with no prebuilt binary for
your machine: install Python and a compiler as above.

It stages the backend, exports the frontend and packages both. A few minutes the
first time. Builds a DMG for macOS; `npm run build:win` and `build:linux` for the
others. `desktop/README.md` covers packaging in more detail.

The app serves its own window on **4179** and runs the backend on **4000**.

On first launch it asks which engine to use and then for an API key, which it
stores through the OS keychain. Two things to expect on macOS, both from the app
being unsigned:

- **Gatekeeper.** Opened from a download, macOS refuses it. Right-click the app
  and choose **Open**, once.
- **A keychain prompt**, asking to allow access to ReqFlow's stored key. Every
  build is signed ad-hoc, so the system treats each one as a new app and asks
  again. Allow it.

### Running the model on your machine

Set `LLM_PROVIDER=embedded` with a `.gguf` path, or `local` with an
OpenAI-compatible runtime you already have. Nothing leaves the machine. It is an
offline option rather than a faster one — the benchmark in `OVERVIEW.md` has the
numbers.

## Tests

```bash
cd backend && npm test     # 375
cd frontend && npm test    # 134
cd desktop && npm test     # 59
```

The backend covers the proxy, the target guard, the scan and its cache, the
Server-Timing parser, the OpenAPI builder, the port detector, and the agent's
tools. Writing into a project has its own set, since that is the part that can
lose someone's work: a path that climbs out of the project folder is refused,
new code lands above the trailing export rather than after it, a non-git folder
gets a backup and a git one does not, and a file that changed between the preview
and the apply stops the write. Verification is covered end to end against a real
server, including all three ways ReqFlow can relate to it. Gemini is mocked, so
they run offline and cost nothing.

The frontend suite covers `src/lib`: variables, query and path parameters, url
normalisation, timings, what a saved example keeps, and what survives a restart.
The redaction tests are the ones worth reading — they decide whether a token
reaches disk.

The desktop suite covers what the wrapper adds: whether the server on port 4000
is ours to adopt or a stranger to warn about, restarting a backend that dies,
where the key is stored, resumable model downloads, and that the app is always
served from the same origin — a different one each launch meant an empty
workspace every time. Those bind real ports, so nothing else may be listening on
4000 or 4179 while they run.

## How it is put together

```
backend/     express + typescript. scanning, the agent, code generation,
             applying, running your project, verifying
frontend/    expo + react native web. tabs, diff review, verdicts, settings
desktop/     electron wrapper. spawns the backend, serves the frontend,
             holds the key
```

`OVERVIEW.md` has the architecture, the model benchmark, and the bugs the
benchmark found in ReqFlow itself.

## Security

Requests are proxied through the backend, which refuses anything that is not a
loopback or private address. Generated files are confined to the project folder;
a path that resolves outside it is refused. Saved examples have their
credentials removed before they are written. The API key is stored through the
OS keychain in the desktop app, and in `backend/.env` otherwise — neither is ever
committed.

## Troubleshooting

**The endpoint 404s right after applying.** Your server is running the code from
before the write. ReqFlow only reloads a server it started; restart yours.

**The server stopped right after applying.** The message says so when the server
was answering before and is not now. Undo with git, or from the `.reqflow.bak`
copy if the project is not a repository.

**"needs a login before it will list anything".** ReqFlow could not read the
collection it needed to find a record. Ask the agent to log in, then apply again.

**The model rejected the key.** Check `GEMINI_API_KEY` in `backend/.env`, or open
Settings and press Re-check, which makes a real call rather than reading the file.

## Config

| Variable | Default | What it does |
| --- | --- | --- |
| `LLM_PROVIDER` | `gemini` | `embedded` runs the model in-process, `local` uses a runtime you already have |
| `GEMINI_API_KEY` | required for `gemini` | Used by the scan and the agent |
| `GEMINI_ANALYZE_MODEL` | `gemini-3.1-flash-lite` | Model for scanning |
| `GEMINI_CHAT_MODEL` | `gemini-3.1-flash-lite` | Model for the agent |
| `GEMINI_CODEGEN_MODEL` | `gemini-3.1-flash-lite` | Model for writing endpoints |
| `LOCAL_MODEL_PATH` | set by the app | The `.gguf` loaded when `LLM_PROVIDER=embedded` |
| `LOCAL_CONTEXT_TOKENS` | `8192` | Context for the embedded model; larger costs memory |
| `LOCAL_MODEL` | see `.env.example` | Model name when `LLM_PROVIDER=local` |
| `LOCAL_MODEL_URL` | `http://localhost:11434/v1` | Where that runtime listens |

The defaults are a lite model on purpose: the free tier caps requests per day
per model, and the agent spends one per tool round.
