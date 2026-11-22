# Development

The web client is the desktop app's frontend (`/src` in the repository
root) built for the browser; the server only serves that build. So there are
two packages involved:

```bash
# repository root: build the web client into dist-web/
npm install
npm run build:web

# server
cd server
npm install
SCRIBEDOG_VAULT_PATH=/path/to/notes SCRIBEDOG_INIT_PASSWORD=devpassword SCRIBEDOG_COOKIE_SECURE=false npm run dev   # http://localhost:3000
```

The server reads `index.html` once at startup, so restart it after a new
`npm run build:web`. For UI work with hot reload run `npm run dev:web` in
the repository root instead (<http://localhost:5173>, API calls are proxied
to port 3000).

Both halves have to run at the same time, otherwise the proxy answers with
`ECONNREFUSED`. There are three scripts in the repository root that take
care of that:

```bash
scripts/local-web-start.sh              # server and Vite in the background
scripts/local-web-stop.sh               # stop both again
scripts/local-web-clean.sh              # stop, then remove logs and PID files
scripts/local-web-clean.sh --with-vault # also delete the test vault
```

They default to a vault in `~/scribedog-test-vault` and the password
`devpassword`; set `SCRIBEDOG_VAULT_PATH` or `SCRIBEDOG_INIT_PASSWORD` to
change that. Logs land in `scripts/.run/`. Note that `--with-vault` removes
the whole folder `SCRIBEDOG_VAULT_PATH` points to, notes included, so only
point it at a folder you can afford to lose.

The start script binds Vite to all interfaces and prints the addresses of
the machine, so the running app can also be opened from a phone in the same
network. That means anyone in that network can reach the test vault with the
development password, which is fine on a home network and not fine anywhere
else.

## Tests

```bash
npm test          # unit and API tests (vitest), in server/
npm run typecheck
npm run test:e2e  # browser test against a running instance, see below
```

The browser tests drive a real instance, usually the compose stack. The
agent tests need the scripted model that `docker-compose.e2e.yml` adds to it
(`e2e/mock-llm`, reachable to the server as `https://llm.e2e.internal` and to
the tests on port 9081), so start the stack with both files:

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build
npx playwright install chromium
SCRIBEDOG_E2E_URL=https://localhost/ SCRIBEDOG_E2E_PASSWORD=... npm run test:e2e
# or, with a base path:
SCRIBEDOG_E2E_URL=https://localhost/anna/ SCRIBEDOG_E2E_PASSWORD=... npm run test:e2e
```

They expect a note `Projects/Roadmap.md` in the vault (override with
`SCRIBEDOG_E2E_NOTE`) and overwrite it. `SCRIBEDOG_E2E_MOCK_URL` points them
at the mock if its port differs. The e2e compose file is for tests only: it
turns certificate checks off in the server container so it accepts the
mock's certificate from Caddy's local CA. The site itself uses a certificate
from `docker compose run --rm certificates`, like a real installation; create
it before the first `up`.

## The desktop app against a development server

The desktop app accepts `http://localhost:<port>` as a server address, so a
server started with `npm run dev` as above can be added to it without TLS.
Every other address has to be HTTPS.

## The image

The Docker image is built from the repository root (`docker compose` in
`server/` already uses `..` as the build context) because it needs both
packages.

## This documentation

The pages in `server/docs/` are the user documentation of the server edition
and are part of every change to it: a new setting, route, behaviour or
limitation is not finished until the page it belongs to says so, and the
[FAQ](faq.md) has an entry if users are likely to ask.
