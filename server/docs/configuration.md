# Configuration

Everything is set through environment variables in `server/.env`, which
`docker-compose.yml` reads. Change a value, then run `docker compose up -d`
again.

## Settings in `.env`

| Variable | Default | What it does |
| --- | --- | --- |
| `SCRIBEDOG_INIT_PASSWORD` | | Password for the first start. Only used while no password exists in the data folder; afterwards it is ignored (the server logs a note) and can be removed. |
| `SCRIBEDOG_BASE_PATH` | *(empty)* | Serve the app under a path prefix, e.g. `/anna`. See [Running under a path prefix](#running-under-a-path-prefix). |
| `SCRIBEDOG_SITE_ADDRESS` | `localhost` | Host name or IP Caddy answers on: `localhost`, the LAN name or IP of the box, or a public domain. Several, separated by commas, if the box is reached under more than one name. |
| `SCRIBEDOG_DEFAULT_SNI` | the site address | Only matters with several site addresses: which one's certificate answers a browser that names none, which is what browsers do when they open the app by IP address. Set it to that IP. |
| `SCRIBEDOG_TLS` | `internal` | `internal` uses Caddy's local CA. For a public domain set your e-mail address and Caddy obtains a Let's Encrypt certificate. |
| `SCRIBEDOG_HTTP_PORT` / `SCRIBEDOG_HTTPS_PORT` | `80` / `443` | Host ports Caddy listens on. |
| `SCRIBEDOG_IMAGE` | *(empty, build locally)* | A published image to run instead of building, e.g. `ghcr.io/snooky234/scribedog-server:0.17.0`. |
| `PUID` / `PGID` | `1000` / `1000` | User and group the server runs as. The container starts as root, hands `./scribedog-data` to these ids and drops to them, so match them to your own user (`id -u`, `id -g`) and the notes stay yours on the host. |

## Settings the server itself understands

These are set on the `scribedog` service. The bundled compose file sets the
ones that matter; you only need them if you run the server without it.

| Variable | Default | What it does |
| --- | --- | --- |
| `SCRIBEDOG_VAULT_PATH` | `/data` | Folder with the notes. |
| `SCRIBEDOG_HOST` / `SCRIBEDOG_PORT` | `0.0.0.0` / `3000` | Where the server listens. |
| `SCRIBEDOG_COOKIE_SECURE` | `true` | Session cookie carries the `Secure` flag. Set to `false` only for plain-http development on localhost. |
| `SCRIBEDOG_TRUST_PROXY` | `1` | How many reverse proxies stand in front. The bundled Caddy is one. `false` for none (the server is reached directly); a number, or a list of proxy addresses, otherwise. It decides which address a request counts as, which is what the login lock is applied to. |
| `SCRIBEDOG_SESSION_MAX_AGE_DAYS` | `60` | How long a browser session stays valid without activity (sliding, capped at 60). Access keys of the desktop app do not expire; see [Security](security.md). |
| `SCRIBEDOG_LOGIN_MAX_ATTEMPTS` | `5` | Failed password attempts from one address before it is locked out. |
| `SCRIBEDOG_LOGIN_LOCK_SECONDS` | `60` | How long the first lock lasts. Each further series of failures multiplies it by five. |
| `SCRIBEDOG_LOGIN_LOCK_MAX_SECONDS` | `900` | Upper limit for that escalation. |
| `SCRIBEDOG_ALLOWED_ORIGINS` | *(empty)* | Extra origins accepted on requests that change something, e.g. `https://notes.example.com`. Only needed if your proxy passes on a different host than the browser uses. |
| `SCRIBEDOG_LLM_ALLOWED_HOSTS` | the three cloud providers | Hosts the server may forward AI requests to. Add your own gateway here if you use one. |
| `SCRIBEDOG_LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`). |
| `SCRIBEDOG_WEB_DIST_DIR` | `../dist-web` | Directory with the built web client (see [Development](development.md)). The Docker image sets it. |

## TLS and the reverse proxy

The server speaks plain HTTP and expects a reverse proxy to terminate TLS.
The compose file ships with Caddy for that:

- **No domain (home network, IP or local host name):** keep
  `SCRIBEDOG_TLS=internal`. Caddy uses its own local CA; import
  `scribedog-ca.crt` as described in [Getting started](getting-started.md) so
  browsers and the desktop app stop warning.
- **Public domain:** set `SCRIBEDOG_SITE_ADDRESS=notes.example.com` and
  `SCRIBEDOG_TLS=you@example.com`. Ports 80 and 443 must be reachable from
  the internet for Let's Encrypt.

Do not expose the server without TLS beyond `localhost`: the password and
the access keys would travel in clear text.

**Your own proxy** (nginx, Traefik, an existing Caddy) works as well: point
it at the `scribedog` container's port 3000, forward the `Host` header and
the WebSocket upgrade (`/api/events`), and keep `SCRIBEDOG_TRUST_PROXY` at
the number of proxies in the chain. If the host name the proxy passes on
differs from the one the browser types, add the browser's origin to
`SCRIBEDOG_ALLOWED_ORIGINS`.

## Running under a path prefix

Set `SCRIBEDOG_BASE_PATH=/anna` and the app answers under
`https://<host>/anna/` only. `https://<host>/` then returns 404 on purpose.
Everything follows the prefix: the page, its assets, the API and the session
cookie's `Path`, so two instances on the same host under different prefixes
do not see each other's cookies. `https://<host>/anna` (no trailing slash)
redirects to `https://<host>/anna/`.

The reverse proxy passes the path through unchanged; it must not strip the
prefix. The bundled Caddyfile already does this. If you put your own nginx or
Traefik in front, proxy `/anna` to the container as `/anna`, not as `/`.

Changing the prefix later logs everyone out (the cookie was scoped to the old
path), and the desktop app will need the server added again under the new
address; that is all.

## Several people on one host

Each person needs their own instance, password and vault, all behind one
shared Caddy. Setting that up from scratch, moving an existing single
instance into it, and adding another person later are all covered in
[Multiple users on one host](multiuser.md), with `SCRIBEDOG_BASE_PATH` (see
above) doing the per-instance path routing.
