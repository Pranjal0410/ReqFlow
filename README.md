# ReqFlow

An API client that reads your project and figures out what endpoints you have,
so you are not typing URLs into Postman by hand every time.

Point it at a Node project folder. It scans the code, lists the routes it finds,
and you can send requests to any of them. There is also a chat panel that will
actually run the requests for you and report what came back.

Built with Express and TypeScript on the backend, Expo and React Native on the
frontend. It runs in the browser today and is meant to run on a phone too.

## What it does

**Scans a project.** Walks the folder, keeps files that look like they define
routes, and asks Gemini to pull out the method, path and expected body for each
one. Everything it finds shows up in the sidebar, grouped by path.

**Sends requests.** Method, URL, headers, JSON body, bearer token. Multiple tabs
so you can keep a few requests open at once. Export any of them as a runnable
curl command.

**Shows what actually happened.** Status, response headers, syntax highlighted
JSON, and a timing breakdown. The timings are measured, not estimated: the
backend reads the response as a stream so the wait for the first byte and the
time spent reading the body are two separate numbers. If the server you are
testing sends a `Server-Timing` header, whatever it reports about itself, its
controller, its queries, shows up in the trace as well, tagged `reported`
because those numbers are its word rather than our measurement.

**Runs assertions.** Write checks like `status equals 200` or
`data.token exists` and they run on every send.

**Chats.** The assistant has one tool, `send_request`, so it can genuinely test
your endpoints instead of telling you how to. It logs in first when a route
needs auth. Under every reply is a list of the requests it really sent, taken
from the backend rather than from the model, so you can check the summary
against what happened.

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

Set **Base URL** in the sidebar to whichever server you are testing, then hit
Scan Project and give it a folder path.

One thing that trips people up: Base URL is your API, not ReqFlow. If you leave
it pointing at port 4000 every route will 404, because 4000 is ReqFlow's own
backend.

## Tests

```bash
cd backend && npm test
```

39 tests over the proxy, the analyze route, the file reader, the target guard
and the Server-Timing parser. They spin up their own throwaway server instead of
calling a public API,
and Gemini is mocked, so they run offline and cost nothing.

## How it is put together

```
backend/
  routes/      analyze, proxy, ai-chat
  services/    fileReader, gemini, proxy, serverTiming, targetGuard
frontend/
  components/  sidebar, tabs, request builder, response viewer, trace, agent
  lib/         assertions, persistence
```

Requests go through the backend rather than straight from the browser, which
gets around CORS on the servers you are testing and is what lets the chat agent
send anything at all.

The proxy only forwards to loopback and private addresses. Without that, anyone
on your network could point it at an internal host and use your machine as a
relay. The check parses the address instead of matching a prefix, since
`192.168.evil.com` is a domain anybody can register.

Your workspace is saved as you go. Credentials are kept apart from it: header
values that look like secrets go to sessionStorage on web and the OS keystore on
a device, so a reload keeps you signed in but closing the browser does not leave
a token on disk.

## Config

| Variable | Default | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY` | required | Used by the scan and the chat agent |
| `GEMINI_ANALYZE_MODEL` | `gemini-3.1-flash-lite` | Model for scanning |
| `GEMINI_CHAT_MODEL` | `gemini-3.1-flash-lite` | Model for the agent |

Both default to a lite model on purpose. `gemini-3.5-flash` allows 20 requests a
day on the free tier, and the agent spends one per tool round, so a single run
that tests a dozen endpoints uses it all up.
