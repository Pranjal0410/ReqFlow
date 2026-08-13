# ReqFlow

An API client that reads your project and figures out what endpoints you have,
so you are not typing URLs into Postman by hand every time.

Point it at a Node project folder. It scans the code, lists the routes it finds,
and you can send requests to any of them. There is also an agent that runs the
requests for you and drops each one into a tab with its real response.

Built with Express and TypeScript on the backend, Expo and React Native on the
frontend. It runs in the browser today and is meant to run on a phone too.

## What it does

**Scans a project.** Walks the folder, keeps files that look like they define
routes, and asks Gemini to pull out the method, path and expected body for each
one. Everything it finds shows up in the sidebar, grouped by path. Re-scanning
the same folder is served from a cache keyed on the contents of the files, so
edited code still gets a fresh look but an unchanged project does not spend the
quota twice.

**Sends requests.** Method, URL, query parameters, headers, JSON body, bearer
token. Multiple tabs so you can keep a few requests open at once. Export any of
them as a runnable curl command, or the whole scan as an OpenAPI document.

**Shows what actually happened.** Status, response headers, syntax highlighted
JSON, and a timing breakdown. The timings are measured, not estimated: the
backend reads the response as a stream so the wait for the first byte and the
time spent reading the body are two separate numbers. If the server you are
testing sends a `Server-Timing` header, whatever it reports about itself, its
controller, its queries, shows up in the trace as well, tagged `reported`
because those numbers are its word rather than our measurement.

**Reads each response against the last ones.** A number on its own does not tell
you whether 826 ms is normal, so samples are kept per endpoint and the new run is
shown next to the median of the ones before it, broken down by phase. "Slower" is
not useful; ttfb up while download is flat, or a reported `db` span going from
8 ms to 200 ms, is. Nothing is claimed under three prior runs, and a run has to be
both proportionally and absolutely slower before it is called out, or 2 ms to
6 ms reads as a 3x regression.

**Runs assertions.** Write checks like `status equals 200` or
`data.token exists` and they run on every send. **Run all** sends every open tab
one at a time and reports how they did together.

**Keeps variables.** Anything written as `{{name}}` in a url, header or body is
resolved just before the request goes out, so a token fetched once works in every
tab instead of living in whichever one logged in. A variable whose name looks
like a credential is masked and kept out of the saved workspace.

## The agent

It acts on what you ask without checking in first, and has four tools:

| Tool | What it does |
| --- | --- |
| `send_request` | Actually calls an endpoint |
| `create_request` | Fills a tab and leaves it for you to send |
| `create_assertions` | Writes checks into the Tests panel |
| `set_variable` | Saves a value as `{{name}}` for every tab |

Only the first touches the network, so the other three still work with read-only
mode on. It works through login flows, so protected routes are fine.

Everything it sends lands in a tab with the real response already attached,
rather than being readable only in the chat column. Nothing is re-run to show you
the result, which matters for a POST. A run that touches a dozen endpoints opens
a dozen tabs, and the bar only shows about four, so clicking a request in the log
under the reply selects its tab.

Two limits, neither of which asks you anything:

- It can only reach loopback and private addresses. This is enforced in the
  proxy, not in a route handler, so the agent cannot go around it, and every
  redirect hop is checked too.
- 30 actions per conversation. Clearing the chat starts a fresh budget. A call
  that did nothing, a collapsed duplicate or a rejected field, costs none of it.

Under every reply is a list of what really happened, taken from the backend
rather than from the model, so you can check the summary against it. Sent and
drafted stay distinguishable, and a blocked attempt is still listed so you know
it was tried.

## Setup

You need Node 18 or newer and a Gemini API key from
[aistudio.google.com](https://aistudio.google.com/apikey).

```bash
# backend
cd backend
npm install
cp .env.example .env      # then paste your key into GEMINI_API_KEY
npm run dev               # http://localhost:4000

# frontend, in a second terminal
cd frontend
npm install
npm run web               # http://localhost:8081
```

Hit **Scan Project** and give it a folder path. As you type it, ReqFlow reads
the folder, tells you how many route files it found, and fills in the base url
from the port the project declares, checking `.env`, then the package scripts,
then the code, and saying which one it took it from. Confirm that and scan.

The base url is required rather than defaulted, because a scan that leaves it
at a guess points every route it just found at whatever happens to be running
on that port. It is your API, not ReqFlow: port 4000 is ReqFlow's own backend,
so pointing at it 404s everything.

On web the frontend asks whatever host served the page for the API, so changing
networks cannot break it. Running on a device is the one case that needs an
address written down, since `localhost` there is the phone: set `DEV_IP` in
`frontend/src/config.ts`.

## Tests

```bash
cd backend && npm test     # 85
cd frontend && npm test    # 45
```

The backend covers the proxy, the target guard, the analyze route and its cache,
the Server-Timing parser, the OpenAPI builder, the port detector, and the
agent's tools including the action cap. They spin up their own throwaway server instead of calling a
public API, and Gemini is mocked, so they run offline and cost nothing.

The frontend suite is limited to `src/lib`: variables, query parameters, url
normalisation and the timing comparison. Components would need a react-native renderer, which those
files do not justify yet.

## How it is put together

```
backend/
  routes/      analyze, proxy, ai-chat
  services/    fileReader, gemini, openapi, portDetector, proxy, serverTiming,
               targetGuard
frontend/
  components/  sidebar, tabs, request builder, response viewer, trace, agent
  lib/         assertions, persistence, url, variables, query params, timings
```

Requests go through the backend rather than straight from the browser, which
gets around CORS on the servers you are testing and is what lets the agent send
anything at all.

The proxy only forwards to loopback and private addresses. Without that, anyone
on your network could point it at an internal host and use your machine as a
relay. The check parses the address instead of matching a prefix, since
`192.168.evil.com` is a domain anybody can register, and it runs again on every
redirect, since a local server answering 302 with a public address would
otherwise walk straight through it.

Your workspace is saved as you go. Credentials are kept apart from it: header
values and variables that look like secrets go to sessionStorage on web and the
OS keystore on a device, so a reload keeps you signed in but closing the browser
does not leave a token on disk. Responses are not saved, because a stored one
would sit next to a request that has not been sent this session.

## Config

| Variable | Default | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY` | required | Used by the scan and the agent |
| `GEMINI_ANALYZE_MODEL` | `gemini-3.1-flash-lite` | Model for scanning |
| `GEMINI_CHAT_MODEL` | `gemini-3.1-flash-lite` | Model for the agent |

Both default to a lite model on purpose. `gemini-3.5-flash` allows 20 requests a
day on the free tier, and the agent spends one per tool round, so a single run
that tests a dozen endpoints uses it all up.
