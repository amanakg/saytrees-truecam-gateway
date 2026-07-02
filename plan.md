\# Scaling Truecam from 2 to 400-500 Cameras



\## Context



The client has \~400-500 cellular/4G IP cameras deployed across many remote sites, sitting

behind carrier-grade NAT (CGNAT), which they want embedded live in their own web portal.

The current system (`gateway/server.js`, `gateway/server\_cam1.js`) proves the extraction

pipeline works — P2P → headless Chrome (Puppeteer) running the vendor's WASM SDK → frame

interception → FFmpeg (`-c:v copy`, zero re-encode) → RTSP → MediaMTX → WebRTC/WHEP — but it

only works because every camera is a hand copy-pasted source file with its own dedicated

Chrome process (\~300-600MB RAM each). That does not survive 400-500x. Quality and latency

are already solved (zero-transcode copy mode); the entire problem is \*\*server-side resource

cost and zero automation\*\* at fleet scale.



Two important things surfaced during investigation that shape this plan:



1\. The camera hardware exposes a \*\*native RTMP push client\*\* (`Protocol.RTMPClinet.Enabled`,

&#x20;  confirmed in `doc/DevceSetting.md` and exercised in `publish\_helper.js`/`payload.json`),

&#x20;  which in theory could push directly to MediaMTX with \*\*zero gateway server cost per

&#x20;  camera\*\*. This looked like the obvious scaling answer.

2\. \*\*`gateway/README.md` (§5, "Debugging Journey") documents that this was already tried and

&#x20;  abandoned\*\*: MediaMTX dropped the camera's direct RTMP stream due to unannounced audio

&#x20;  packets, and the camera's own RTMP client fought the gateway for the same stream path.

&#x20;  That's why the P2P-extraction workaround exists in the first place. Native push is not a

&#x20;  clean win — it's a real historical failure mode with a known root cause. `publish\_helper.js`

&#x20;  already disables audio (`Audio.Input\[0].Enabled: false`) alongside enabling RTMP, which

&#x20;  looks like a prior attempt to work around exactly this — untested/unconfirmed if it works.



\*\*Guiding decision\*\*: default to a \*\*shared-browser worker-pool (Tier 2 / "bridge")\*\* as the

primary scaling path — it reuses the proven, working extraction logic and just removes the

one-Chrome-per-camera cost. Treat \*\*native RTMP push (Tier 1)\*\* as an opportunistic

optimization to re-test now that audio can be disabled and paths can be namespaced

distinctly, not as the default plan. This isn't blocked on Tier-1 succeeding.



Branch: `feature/multi-camera-scaling` (already created off `main`).



\---



\## Phase 0 — Verification Spike (before any refactor)



\*\*Goal\*\*: Get real numbers instead of guesses on both fronts.



1\. \*\*`gateway/tools/capability\_probe.js`\*\* — standalone script reusing `get\_devices.js`'s

&#x20;  account login + `runLoginSequence`'s P2P connect pattern from `server.js`, but calls

&#x20;  `getDeviceModal(deviceId)` (documented in `doc/H5SDK\_en.md` §4) to dump the full

&#x20;  capability set per device. `getDeviceModal` is a WASM-SDK call — it must run inside a

&#x20;  real Puppeteer page, there's no way to call it from plain Node. Goal: find whether

&#x20;  `Protocol.RTMPClinet` exposes a settable target URL/host, beyond `.Enabled`.

2\. \*\*Re-test native RTMP push directly\*\*, now with audio disabled AND pushing to a distinct

&#x20;  path (e.g. `live/native\_test\_camX`, not the path the bridge already uses) — isolates

&#x20;  whether the two documented failure causes (audio packets, path collision) are actually

&#x20;  fixed. Run 24-48h to catch reconnect/stability issues the README doesn't mention.

3\. \*\*Shared-browser load test\*\* — `gateway/tools/browser\_pool\_loadtest.js`: one

&#x20;  `puppeteer.launch()`, N `page`s each running the existing login/interceptor pipeline,

&#x20;  measure RAM/CPU per page at N=10, then N=30. This is what determines Phase 2's worker

&#x20;  sizing (how many worker processes for 400-500 cameras).



\*\*Verification\*\*: written findings — per firmware/model, is Tier-1 viable (yes/no + why);

measured MB and CPU per tab at 10 and 30 concurrent pages.



\*\*Files\*\*: new `gateway/tools/capability\_probe.js`, `gateway/tools/browser\_pool\_loadtest.js`.

No production files touched.



\---



\## Phase 1 — Device Registry / Control Plane



\*\*Goal\*\*: Replace hardcoded `CONFIG` objects with a queryable source of truth.



\*\*Storage: SQLite\*\* (`better-sqlite3`), not Postgres, not JSON/YAML. \~500 rows with modest

write frequency (health pings, tier changes) is squarely SQLite's use case — real

transactions without standing up/operating a DB server for what's currently a single-VPS

control plane (`context/deployment.md` confirms single-VPS `/opt/truecam/` deployment).

Move to Postgres only if a genuine multi-host, multi-writer control plane becomes necessary

later (same schema, trivial migration) — not needed at this scale today.



```sql

CREATE TABLE devices (

&#x20; device\_id       TEXT PRIMARY KEY,

&#x20; device\_secret   TEXT NOT NULL,

&#x20; nickname        TEXT,

&#x20; client\_id       TEXT NOT NULL,          -- tenant ownership, FK to clients

&#x20; site\_name       TEXT,

&#x20; stream\_name     TEXT NOT NULL UNIQUE,   -- -> MediaMTX path

&#x20; ingest\_tier     TEXT NOT NULL CHECK(ingest\_tier IN ('native','bridge')),

&#x20; account\_email   TEXT NOT NULL,

&#x20; account\_password\_ref TEXT NOT NULL,     -- secrets reference, NOT plaintext (Phase 7)

&#x20; worker\_id       TEXT,                   -- owning bridge worker (tier=bridge only)

&#x20; status          TEXT DEFAULT 'unknown', -- connected/reconnecting/offline/error

&#x20; last\_frame\_at   DATETIME,

&#x20; created\_at      DATETIME DEFAULT CURRENT\_TIMESTAMP,

&#x20; updated\_at      DATETIME

);



CREATE TABLE clients (

&#x20; client\_id     TEXT PRIMARY KEY,

&#x20; name          TEXT NOT NULL,

&#x20; api\_key\_hash  TEXT

);

```



\*\*Files\*\*: `gateway/registry/schema.sql`, `gateway/registry/db.js` (`getDevice`,

`listDevicesByClient`, `listDevicesByWorker`, `upsertDevice`, `updateStatus`),

`gateway/registry/seed\_from\_existing.js` (inserts the 2 current hardcoded cameras — proves

lossless cutover).



\*\*Verification\*\*: query the registry for the 2 existing cameras, confirm returned config

matches today's hardcoded `CONFIG` objects exactly.



\---



\## Phase 2 — Kill the Copy-Paste Pattern: Parameterized Worker Pool



\*\*Goal\*\*: One codebase for all Tier-2 (bridge) cameras, driven by the registry.



Reject "WASM SDK outside a browser" — `server.js:457-461`'s own comment confirms the SDK's

callback is wired via internal WASM C function pointers that only resolve inside the SDK's

own page context (`connector.js`/`play.js` expect real DOM/window globals). Reimplementing

this outside a browser means reverse-engineering the vendor's WASM ABI — high effort, fragile

to SDK updates, reject.



\*\*Design\*\*: `gateway/worker.js` replaces `server.js` + `server\_cam1.js`. It's a \*\*pool

manager\*\*: one `puppeteer.launch()` per worker process, then one `page` per assigned camera

(pulled from the registry by `worker\_id`), each page running the existing, proven

`runLoginSequence` / `runReconnectSequence` / interceptor / FFmpeg-spawn / watchdog logic —

unchanged in substance, just parameterized (`loadConfig(deviceId)` from the registry instead

of the module-level `CONFIG` constant) and scoped per-page instead of per-process. Per-camera

WS port derived deterministically from a registry-assigned index, not manually tracked.



Failure isolation: one page crashing must not kill the browser — wrap each page's lifecycle

in its own try/catch + reconnect, mirroring the existing `browser.on('disconnected')` handler

but scoped per-page.



Worker count is a Phase-0 output: if e.g. 25-40 cameras fit comfortably per browser process,

400-500 cameras needs \~12-20 worker processes, distributable across multiple VPS instances

if one box can't hold them all.



\*\*Verification\*\*: run `worker.js` against the 2 registry-seeded cameras, confirm identical

WHEP playback to today. Then load-test 10-30 sessions in one worker to validate Phase 0's

sizing holds under the real code path, not just the spike script.



\*\*Files\*\*: new `gateway/worker.js`; retire `gateway/server.js` / `gateway/server\_cam1.js`

once every camera has been migrated (Phase 4).



\---



\## Phase 3 — Onboarding/Provisioning Flow



\*\*Goal\*\*: A repeatable script to add one camera — this runs 400-500+ times.



`gateway/tools/onboard\_camera.js`:

1\. Query capability set (reuse Phase 0's `capability\_probe.js` logic) → decide tier: native

&#x20;  only if capability set confirms a settable RTMP target AND the model/firmware is on the

&#x20;  Phase-0-verified allowlist; bridge otherwise.

2\. Native path: reuse `publish\_helper.js`'s signed MQTT payload pattern to set

&#x20;  `Protocol.RTMPClinet.Enabled=true` + discovered target-URL property + `Audio.Input\[0]

&#x20;  .Enabled=false`. Parameterize `publish\_helper.js`'s `properties` array (currently

&#x20;  hardcoded, lines 46-59) instead of hardcoding values.

3\. Register the device in the registry (Phase 1's `upsertDevice`), assign a unique

&#x20;  `stream\_name` (collision-checked).

4\. Bridge path: assign to the least-loaded `worker\_id` (by current page count from registry).

5\. Verify frames flow (WHEP fetch or MediaMTX API poll) within a timeout, write

&#x20;  `status = 'connected'`/`'error'` back.



\*\*Verification\*\*: onboard one net-new test camera end-to-end, confirm it's live in the

dashboard with zero manual file editing — the acceptance test that retires the

copy-a-file pattern for good.



\*\*Files\*\*: `gateway/tools/onboard\_camera.js`, parameterized `publish\_helper.js`.



\---



\## Phase 4 — Cutover of Existing 2 Cameras + Rollout Waves



Migrate the 2 production cameras onto `worker.js`, decommission `server.js`/

`server\_cam1.js`, then onboard the rest in batches of \~20-30 via Phase 3's script —

checking worker RAM/CPU headroom after each batch (real cellular jitter/reconnect storms

behave differently than a synthetic load test, so don't fully trust Phase 0's numbers alone).



Update `context/deployment.md`: one templated systemd unit

(`truecam-worker@.service`, using `%i` for worker ID) instead of one hand-authored unit per

camera — `systemctl start truecam-worker@1 truecam-worker@2 ...`.



\*\*Verification\*\*: both original cameras streaming via the new path, WHEP playback unchanged

end-user-side; `systemctl restart` survives cleanly (worker.js preserves the existing

graceful-shutdown logic from `server.js:523-583`, per-page).



\---



\## Phase 5 — MediaMTX at Scale (in-repo edges only)



\*\*In scope\*\*: standardize `stream\_name` (Phase 1) so MediaMTX can match them with a wildcard

path rule (e.g. `paths: \~^live/.\*$`) instead of a static per-camera config block. Onboarding

(Phase 3) should call MediaMTX's runtime control API to register paths dynamically rather

than requiring manual config-file edits per camera — needs verifying against whatever

MediaMTX version is actually deployed.



\*\*Explicitly out of scope, flag separately\*\*: MediaMTX horizontal scaling/clustering at

400-500 concurrent RTSP-in + WebRTC-out streams (single-instance CPU/bandwidth/connection

limits, sharding across instances, WebRTC ICE/TURN at that viewer count). MediaMTX isn't in

this repo and isn't configured here — this needs its own investigation with visibility into

the actual server, not a guess bolted onto this plan. Same for future DVR/recording asks.



\---



\## Phase 6 — Portal Embedding: Per-Tenant API + Reusable Player



`dashboard/reader.js`'s `MediaMTXWebRTCReader` is confirmed portable as-is — zero changes.



\*\*Files\*\*:

\- `gateway/api/server.js` — small HTTP API exposing `GET /api/clients/:clientId/cameras` →

&#x20; `\[{id, name, streamName, whepUrl, status}]` from the registry, tenant-scoped server-side,

&#x20; auth via API key (`clients.api\_key\_hash`, Phase 7).

\- `dashboard/player-embed.js` — extract the ad hoc per-camera wiring already in

&#x20; `dashboard/index.html` (lines \~482-703, creating a `MediaMTXWebRTCReader` per camera,

&#x20; wiring `onTrack` to a `<video>`) into one documented function (e.g.

&#x20; `mountCameraPlayer(videoEl, whepUrl)`) so a separate portal codebase can import two files

&#x20; and call one function, instead of copying HTML.



\*\*Explicitly out of scope\*\*: building the actual portal frontend — this repo's job ends at

the API + embeddable player primitives.



\*\*Verification\*\*: a standalone throwaway HTML page outside `dashboard/` that imports

`reader.js` + `player-embed.js` and plays a stream using only the tenant-scoped API

response — proves the embedding contract works independent of `index.html`'s markup.



\---



\## Phase 7 — Security (review note, not a full spec)



Confirmed insecure today: `CONFIG.password`/`deviceSecret` are plaintext in source

(`server.js:37-40`), dashboard has zero auth, WHEP/RTSP endpoints are open, `reader.js`'s

`#authHeader()` exists but is never populated with real credentials in `index.html`.



Minimum bar before a real multi-tenant client portal goes live:

\- Secrets out of the registry as plaintext — env-injected at minimum, a real secrets

&#x20; manager if this becomes a multi-client product.

\- Tenant-scoped API keys validated server-side on every registry query — never trust a

&#x20; client-supplied `clientId` without checking it against the authenticated key's owner.

\- MediaMTX WHEP should require auth scoped per-path/tenant (native support exists), or the

&#x20; portal should proxy through the gateway API rather than expose MediaMTX's public IP

&#x20; directly to end users.



Run the `security-review` skill once Phase 6/7 code exists rather than spec'ing this in

the abstract now.



\---



\## Phase 8 — Ops/Monitoring at Fleet Scale (proportionate, not gold-plated)



The registry's `status`/`last\_frame\_at` columns (Phase 1) already give a fleet-wide health

view via one query — enough for basic alerting without standing up a full observability

stack. `gateway/tools/health\_report.js` (cron/systemd timer): query the registry, post a

summary (Slack/email) for anything not `status = 'connected'`.



Logs naturally consolidate to one file per \*\*worker\*\* (not per camera) as a byproduct of

Phase 2's refactor. Reuse the existing watchdog's proven 3.5s idle-frame threshold per-page;

only escalate to the health report after N automatic reconnect retries fail, to avoid noise

from the existing (working) transient-4G-drop auto-recovery.



\---



\## Summary



| Phase | Goal | Key new files | Blocks on |

|---|---|---|---|

| 0 | Verify Tier-1 viability + Tier-2 pool sizing | `capability\_probe.js`, `browser\_pool\_loadtest.js` | — |

| 1 | Device registry | `registry/schema.sql`, `db.js`, `seed\_from\_existing.js` | — (parallel w/ 0) |

| 2 | Parameterized worker pool | `worker.js` | Phase 1, informed by Phase 0 |

| 3 | Onboarding flow | `tools/onboard\_camera.js`, updated `publish\_helper.js` | Phase 0-2 |

| 4 | Cutover + rollout | updated `deployment.md`, systemd template | Phase 2-3 |

| 5 | MediaMTX path mgmt (in-repo edges) | `stream\_name` convention | Phase 1, infra coordination |

| 6 | Portal API + embeddable player | `api/server.js`, `player-embed.js` | Phase 1, 4 |

| 7 | Security note | (review only) | Phase 1, 6 |

| 8 | Ops/monitoring | `tools/health\_report.js` | Phase 1, 2 |



\### Critical files referenced throughout

\- `gateway/server.js` / `gateway/server\_cam1.js` — proven logic to preserve \& parameterize; the diff between them is exactly what Phase 2 eliminates

\- `gateway/README.md` (§5) — documents the prior native-RTMP failure (audio packets, path collision) that Phase 0 must specifically re-test against

\- `publish\_helper.js`, `gateway/get\_devices.js` — base patterns for Phase 0/3 scripts

\- `dashboard/reader.js` — portable as-is; `dashboard/index.html` (\~482-703, 499-512) — pattern to extract/replace in Phase 6

\- `context/deployment.md`, `doc/H5SDK\_en.md` §4, `doc/DevceSetting.md` — deployment model and SDK/MQTT reference

