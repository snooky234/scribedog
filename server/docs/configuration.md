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
| `SCRIBEDOG_TLS` | *(empty)* | Empty uses the certificate in `./certs` that `docker compose run --rm certificates` creates, see [The certificate](certificates.md). For a public domain set your e-mail address and Caddy obtains a Let's Encrypt certificate. |
| `SCRIBEDOG_HTTP_PORT` / `SCRIBEDOG_HTTPS_PORT` | `80` / `443` | Host ports Caddy listens on. |
| `COMPOSE_FILE` | *(unset)* | `docker-compose.local.yml` runs ScribeDog for this one machine only: plain http on `127.0.0.1`, no Caddy, no certificate. See [Only on this machine, without HTTPS](getting-started.md#only-on-this-machine-without-https). |
| `SCRIBEDOG_LOCAL_PORT` | `8080` | Port of that local setup, at `http://localhost:<port>/`. |
| `SCRIBEDOG_TITLE_FORMAT` | `{doc} - ScribeDog` | What the browser tab says. See [Tab title and icon](#tab-title-and-icon). |
| `SCRIBEDOG_FAVICON` | *(empty)* | Your own tab icon instead of the dog, as a path inside the container. See [Tab title and icon](#tab-title-and-icon). |
| `SCRIBEDOG_IMAGE` | *(empty, build locally)* | A published image to run instead of building, e.g. `ghcr.io/snooky234/scribedog-server:0.26.2`. |
| `PUID` / `PGID` | `1000` / `1000` | User and group the server runs as. The container starts as root, hands `./scribedog-data` to these ids and drops to them, so match them to your own user (`id -u`, `id -g`) and the notes stay yours on the host. |

## Settings the server itself understands

These are set on the `scribedog` service. The bundled compose file sets the
ones that matter; you only need them if you run the server without it.

| Variable | Default | What it does |
| --- | --- | --- |
| `SCRIBEDOG_VAULT_PATH` | `/data` | Folder with the notes. |
| `SCRIBEDOG_HOST` / `SCRIBEDOG_PORT` | `0.0.0.0` / `3000` | Where the server listens. |
| `SCRIBEDOG_COOKIE_SECURE` | `true` | Session cookie carries the `Secure` flag. Set to `false` only for plain HTTP on this computer: development, or a [local setup without Docker](windows-without-docker.md) with `SCRIBEDOG_HOST=127.0.0.1`. The server logs a warning when it is `false` on any other host. |
| `SCRIBEDOG_TRUST_PROXY` | `1` | How many reverse proxies stand in front. The bundled Caddy is one. `false` for none (the server is reached directly); a number, or a list of proxy addresses, otherwise. It decides which address a request counts as, which is what the login lock is applied to. |
| `SCRIBEDOG_SESSION_MAX_AGE_DAYS` | `60` | How long a browser session stays valid without activity (sliding, capped at 60). Access keys of the desktop app do not expire; see [Security](security.md). |
| `SCRIBEDOG_LOGIN_MAX_ATTEMPTS` | `5` | Failed password attempts from one address before it is locked out. |
| `SCRIBEDOG_LOGIN_LOCK_SECONDS` | `60` | How long the first lock lasts. Each further series of failures multiplies it by five. |
| `SCRIBEDOG_LOGIN_LOCK_MAX_SECONDS` | `900` | Upper limit for that escalation. |
| `SCRIBEDOG_ALLOWED_ORIGINS` | *(empty)* | Extra origins accepted on requests that change something, e.g. `https://notes.example.com`. Only needed if your proxy passes on a different host than the browser uses. |
| `SCRIBEDOG_LLM_ALLOWED_HOSTS` | `default` | Where the server may forward AI requests to. `default` is the three cloud providers; add your own gateway as a host name, or a model server in your network as `http://<address>:<port>`, e.g. `default,http://192.168.1.50:1337`. Setting it replaces the default, so keep `default,` in front to add to it. See [AI](ai.md#a-model-server-elsewhere-in-your-network). |
| `SCRIBEDOG_LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`). |
| `SCRIBEDOG_WEB_DIST_DIR` | `../dist-web` | Directory with the built web client (see [Development](development.md)). The Docker image sets it. |
| `SCRIBEDOG_USER` | *(empty)* | The name this instance's person has for the others in a [shared-vault setup](multiuser.md#shared-vaults): lowercase letters, digits, `-` and `_`, up to 32. The multi-instance example sets it from `PERSON<N>_USER`. |
| `SCRIBEDOG_SHARED_PATH` | *(empty)* | Folder with the shared vaults, mounted into every instance. Sharing is on only when this and `SCRIBEDOG_USER` are set; with the folder but no name the server starts without sharing and says so in its log. |
| `SCRIBEDOG_SHARED_GID` | *(empty)* | Group id the shared folder belongs to. Required with `SCRIBEDOG_SHARED_PATH` when the container starts as root: the start script adds the instance's user to that group and keeps the folder writable for all of them. The multi-instance example sets it from `SHARED_GID`. |

## TLS and the reverse proxy

The server speaks plain HTTP and expects a reverse proxy to terminate TLS.
The compose file ships with Caddy for that:

- **No domain (home network, IP or local host name):** leave
  `SCRIBEDOG_TLS` empty and create the installation's own certificate with
  `docker compose run --rm certificates`. Install its CA once per device, see
  [The certificate](certificates.md). The plain HTTP port hands out that CA at
  `/scribedog-ca.crt`, answers `<base path>/api/health` and redirects
  everything else to HTTPS (307).
- **Public domain:** set `SCRIBEDOG_SITE_ADDRESS=notes.example.com` and
  `SCRIBEDOG_TLS=you@example.com`. Ports 80 and 443 must be reachable from
  the internet for Let's Encrypt.

Do not expose the server without TLS beyond `localhost`: the password and
the access keys would travel in clear text. For use on the Docker host alone
there is a ready setup without TLS that keeps to that rule, see
[Only on this machine, without HTTPS](getting-started.md#only-on-this-machine-without-https).

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

## Tab title and icon

By default the browser tab shows the open note first and the app second,
e.g. `Meeting notes - ScribeDog`. `SCRIBEDOG_TITLE_FORMAT` changes that.
`{doc}` stands for the open note, or for the vault's name in a shared vault
with no note open:

| `SCRIBEDOG_TITLE_FORMAT` | Note open | Nothing open |
| --- | --- | --- |
| *(unset)* | `Meeting notes - ScribeDog` | `ScribeDog` |
| `{doc}` | `Meeting notes` | `ScribeDog` |
| `ScribeDog` | `ScribeDog` | `ScribeDog` |
| `{doc} \| Team notes` | `Meeting notes \| Team notes` | `Team notes` |

With nothing open, `{doc}` and the separator next to it (`-`, `|`, `:` and
the like) are left out; if nothing remains, the tab says `ScribeDog`. A note
with unsaved changes still gets its `●` in front. The format may be up to 200
characters, without line breaks or tabs.

`SCRIBEDOG_FAVICON` replaces the dog in the tab with an icon of your own: an
`.svg`, `.png` or `.ico` file of up to 1 MB. The server reads it once at
start, so after replacing the file restart the container. A missing or
unreadable file stops the start with a message naming the variable, rather
than leaving the dog in place without a word.

Under Docker the path is the one **inside the container**, so the file has
to be mounted there. `docker-compose.yml` has the line ready: remove the `#`
in front of

```yaml
      #- ./favicon.png:/favicon.png:ro
```

put your icon next to `docker-compose.yml` as `favicon.png` and set
`SCRIBEDOG_FAVICON=/favicon.png` in `.env`. For an `.svg` or `.ico` change
both file names in that line, since the server goes by the extension.
Then run `docker compose up -d`.

Both settings only change the browser tab. The desktop app keeps its own
window title and icon, also when it opens this server's vault. In the
[multi-instance setup](multiuser.md) add the two variables to the
`environment` of each person's service, so every person can have their own.

## Several people on one host

Each person needs their own instance, password and vault, all behind one
shared Caddy. Setting that up from scratch, moving an existing single
instance into it, and adding another person later are all covered in
[Multiple users on one host](multiuser.md), with `SCRIBEDOG_BASE_PATH` (see
above) doing the per-instance path routing. Vaults the people share with each
other are described there too, under [Shared vaults](multiuser.md#shared-vaults).
