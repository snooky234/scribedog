# Getting started

## What you need

- A machine that runs [Docker](https://docs.docker.com/engine/install/) with
  the [Compose plugin](https://docs.docker.com/compose/install/linux/): a home
  server, a Raspberry Pi (64-bit), a NAS with Docker, a small cloud VM.
- A folder for your notes. Docker creates it if it does not exist.
- Five minutes.

## One person or several?

Everything below sets up a single instance for one person. If more than one
person will use this host, each needs their own instance, password and vault
behind one shared Caddy, which is a different compose file — see
[Multiple users on one host](multiuser.md) instead, whether you are starting
fresh, moving an existing single instance to multi-user, or adding another
person to a multi-user setup you already have.

## Install

Two ways to get it running.

**Option 1: published image from GHCR** (recommended, especially on a
Raspberry Pi or other modest hardware, no build step). Get the three files
the compose stack needs:

```bash
mkdir -p scribedog-server/caddy && cd scribedog-server
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/snooky234/scribedog/main/server/docker-compose.yml
curl -fsSL -o caddy/Caddyfile https://raw.githubusercontent.com/snooky234/scribedog/main/server/caddy/Caddyfile
curl -fsSL -o .env https://raw.githubusercontent.com/snooky234/scribedog/main/server/.env.example
```

Open `.env` and set three things:

- `SCRIBEDOG_INIT_PASSWORD`: the password for the first start, eight
  characters or more. It is only used until a password exists in the data
  folder; after that the server ignores it (and says so in the log), so you
  can remove it from the file later.
- `PUID` and `PGID`: the user and group your notes should belong to on the
  host, usually your own (`id -u` and `id -g`). The container hands the data
  folder to these ids, so the files stay yours.
- `SCRIBEDOG_SITE_ADDRESS`: leave it as `localhost` only if you will open the
  app on this same machine. Opening it from a phone, another computer, or
  anywhere else on the network (the usual case for a Pi or home server) needs
  the box's LAN IP or host name here instead, e.g. `192.168.1.50`, or Caddy
  will not answer that request at all. The certificate is made for this
  address, so give the box a fixed one in your router.

`SCRIBEDOG_IMAGE` is already set to the current version, so there is nothing
to change there for the latest release. Two reasons you might still touch it:
you would rather pull from Docker Hub than GHCR (same image, set it to
`snooky234/scribedog-server:0.27.0`, no registry host needed in the name), or
you want an older version on purpose (pin that tag instead).

Then create this installation's certificate (see
[The certificate](#the-certificate) below) and start it:

```bash
docker compose pull
docker compose run --rm certificates
docker compose up -d
```

**Option 2: build from source** instead, cloning the whole repository:

```bash
git clone https://github.com/snooky234/scribedog.git
cd scribedog/server
cp .env.example .env
```

Open `.env` and set four things: `SCRIBEDOG_INIT_PASSWORD`, `PUID`/`PGID` and
`SCRIBEDOG_SITE_ADDRESS` as in option 1, plus `SCRIBEDOG_IMAGE`: empty it (it
comes pre-filled from `.env.example`) so Compose builds instead of pulling.

Then create the certificate (the first run builds the image) and start it:

```bash
docker compose run --rm certificates
docker compose up -d --build
```

This compiles the whole frontend and server on that machine, which is a few
minutes on a normal PC and considerably longer, sometimes tight on RAM, on a
Pi.

Either way, this creates `./scribedog-data` if it is not there and starts two
containers: the ScribeDog server and Caddy, which provides HTTPS.

## Only on this machine, without HTTPS

If you will only ever open ScribeDog on the computer that runs Docker, you
can skip Caddy and the certificate entirely. Get one more file next to
`docker-compose.yml` (option 2 already has it):

```bash
curl -fsSL -o docker-compose.local.yml https://raw.githubusercontent.com/snooky234/scribedog/main/server/docker-compose.local.yml
```

Then remove the `#` in front of this line in `.env`:

```env
COMPOSE_FILE=docker-compose.local.yml
```

and start it with `docker compose up -d --remove-orphans` (the flag stops a
Caddy container from an earlier HTTPS start). The app is at
<http://localhost:8080/>; `SCRIBEDOG_LOCAL_PORT` in `.env` changes the port.
`SCRIBEDOG_INIT_PASSWORD`, `PUID`/`PGID` and `SCRIBEDOG_IMAGE` work as above,
the Caddy settings (site address, TLS, ports 80 and 443) no longer matter.

> **Only this machine.** The port is opened on `127.0.0.1` alone, so phones
> and other computers cannot connect at all. That is deliberate: without
> HTTPS the password would cross the network in clear text. To use the app
> from other devices later, put the `#` back and run
> `docker compose up -d --remove-orphans` again; your notes stay where they
> are.

## Troubleshooting

If `docker compose up` fails with `port is already allocated`, something else
on that machine already uses port 80 or 443 (Pi-hole, another reverse proxy,
a NAS admin UI). Run `docker compose down` first, then set
`SCRIBEDOG_HTTP_PORT` and `SCRIBEDOG_HTTPS_PORT` in `.env` to a free pair,
e.g. `8080` and `8443`, and start it again; see
[Configuration](configuration.md) for both variables.

If it stops with `service "certificate-check" didn't complete successfully`,
`docker compose logs certificate-check` says why: usually there is no
certificate yet (`docker compose run --rm certificates`), or `.env` still
has `SCRIBEDOG_TLS=internal` from an older version (see
[Upgrading the certificate](upgrading-certificates.md)).

## First sign-in

Open <https://localhost/> on the machine itself, or `https://<name-or-IP>/`
from another device on your network, and sign in with the password you set.
On the very first start with an empty folder the server creates a
`Welcome.md` so there is something to open.

If the box answers under more than one name or IP, list them all in
`SCRIBEDOG_SITE_ADDRESS`, separated by commas, then run
`docker compose run --rm certificates` and `docker compose up -d` again (the
certificate has to name every address). See [Configuration](configuration.md).

## The certificate

`docker compose run --rm certificates` makes a certificate for this
installation alone, valid for 825 days. Until a device trusts it, the browser
warns on the first visit. Install it once per device: open
`http://<address>/scribedog-ca.crt` there (or, once signed in, **Settings,
Account, Download certificate**), add it to the device's trust store and
compare the fingerprint the command printed. Step by step for every system,
and how to renew it: [The certificate](certificates.md).

Its key is deleted the moment it has signed the server's certificate, so the
CA you install cannot vouch for anything else.

With a public domain and ports 80 and 443 reachable from the internet you can
skip all this: set `SCRIBEDOG_SITE_ADDRESS` to the domain and `SCRIBEDOG_TLS`
to your e-mail address, and Caddy obtains a Let's Encrypt certificate.

## On a phone

Open the same address in the phone's browser and sign in. Add the site to
the home screen (Chrome: "Add to Home screen"; Safari: share sheet, "Add to
Home Screen") and it opens without the browser chrome, like an app. You stay
signed in for 60 days of use. More in [Phones and tablets](phones-and-tablets.md).

## On your computer, in the desktop app

If you use ScribeDog on the desktop, you do not have to use the browser at
all: the desktop app can open the server's vault directly, with AI and
dictation running on your computer. See
[The desktop app as a client](desktop-app.md).

## Links to a document

Every document has its own address, for example

```
https://notes.example.com/#/doc/Projects/Roadmap.md
```

To get it, right-click the document in the file tree or in "In progress"
and choose **Copy link** (on a phone or tablet: the document's **⋮** menu).
You can bookmark the link, send it to someone who has access, or put it into
another tool. Opening it (after signing in, if needed) opens that document
instead of the one you had open last. A document in a shared vault gets an
address with the vault's id, `#/v/1a2b/doc/...`, which stays the same when
the vault is renamed.

By default the address bar is left alone while you move between documents,
because browsers record every address change in their history and it would
fill up quickly. Switch on **Settings, Show documents in the address bar and
browser history** if you want the address bar to follow the open document:
then reloading keeps it, and the browser's back and forward buttons step
through the documents you opened. ScribeDog's own back and forward arrows
next to the document's path work either way.

The address follows the path of the file. When a document is renamed,
moved or deleted, links to its old place stop working: opening one shows a
short notice and leaves the open document as it is.

The part after `#` never reaches the server, so document names do not show
up in the server's or a proxy's access log.

## What next

- [Configuration](configuration.md) if the box is reached under a name or
  IP, if you want a path prefix, or several people share one host.
- [AI](ai.md) to connect a cloud provider or a model on your own device.
- [Your data and backups](data-and-backups.md) before the notes become
  important.
