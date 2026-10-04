# Multiple users on one host

ScribeDog has one password and one vault per instance, on purpose: there are
no accounts to manage and no permissions on your own notes to get wrong. Two
or more people on one box therefore get one instance each, every one under
its own path prefix, behind a single shared Caddy. On top of that, they can
keep [shared vaults](#shared-vaults) that several of them open.
[`examples/multi-instance/`](../examples/multi-instance/) is a complete
compose file for that: two ready-made slots, `PERSON1` and `PERSON2`
(`anna`/`bob` by default), as a starting template.

Starting here right away, even for a single person, saves you the later move
described below. To rename a person, change `PERSON1_BASE_PATH` and
`PERSON1_DATA_DIR` in `.env`. `BASE_PATH` is the one place their
URL-facing name lives, driving both `docker-compose.yml` and the Caddyfile
without editing either; `DATA_DIR` only needs changing here too, to keep
the data folder's name in step. Adding or
removing a person still means copying or deleting a numbered block by hand
in `docker-compose.yml` and the Caddyfile (not a single command), but it is
copying a number, not renaming strings across three files, and the
instances you are not touching keep running throughout.

Pick the section below that matches your situation.

## Setting it up from scratch

### 1. Get the three files the compose stack needs

```bash
mkdir -p scribedog-multi && cd scribedog-multi
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/snooky234/scribedog/main/server/examples/multi-instance/docker-compose.yml
curl -fsSL -o Caddyfile https://raw.githubusercontent.com/snooky234/scribedog/main/server/examples/multi-instance/Caddyfile
curl -fsSL -o .env https://raw.githubusercontent.com/snooky234/scribedog/main/server/examples/multi-instance/.env.example
```

Starting with a different number of people than two? Do this next, before
your first `docker compose up`:

- **Just one person:** delete `PERSON2`'s parts: its five `PERSON2_*`
  lines in `.env`, its `scribedog-2` block in `docker-compose.yml` (plus its
  entry in `depends_on` and in Caddy's `environment:`), and its `handle`
  block in the Caddyfile.
- **More than two people:** copy a `PERSON<N>` slot the same way
  [Adding another person later](#adding-another-person-later) describes,
  just before your first start instead of after.

### 2. Open `.env` and set

- `PERSON1_INIT_PASSWORD` and `PERSON2_INIT_PASSWORD`: eight characters or
  more each, or that instance rejects it and keeps restarting.
- `PERSON1_BASE_PATH` and `PERSON2_BASE_PATH`: where each instance
  answers, e.g. `/anna`. Change these to rename a person.
- `PERSON1_DATA_DIR` and `PERSON2_DATA_DIR`: the data folder name,
  `anna-data` and `bob-data` by default. Set these to match `BASE_PATH` now,
  while there is nothing in the folders yet: once an instance already has
  data, changing this variable alone does not rename the folder, it starts
  the instance over with a new, empty one, so renaming it later means
  moving the folder on disk yourself first (see [Moving an existing single
  instance here](#moving-an-existing-single-instance-here) for the same
  move done on purpose).
- `SCRIBEDOG_SITE_ADDRESS`: the box's LAN IP or host name, not `localhost`,
  unless every person opens the app on this same machine (see
  [Getting started](getting-started.md#install)).
- `SCRIBEDOG_HTTP_PORT` / `SCRIBEDOG_HTTPS_PORT`: only if 80/443 are
  already used on this host (see
  [Troubleshooting](getting-started.md#troubleshooting)).

### 3. Start it

```bash
docker compose pull
docker compose up -d
```

Or clone the repository and run `docker compose up -d --build` to build from
source instead (same trade-off as [Getting started](getting-started.md#install)).

This serves `https://<host>/anna/` and `https://<host>/bob/` (or whatever you
set `PERSON1_BASE_PATH` / `PERSON2_BASE_PATH` to) from two containers with
two data folders (`anna-data`, `bob-data` by default). Each instance has its
own password and its own session cookie, scoped to its prefix, so signing in
to one says nothing about the other.

## Next steps

Sign in at each instance's own address, `https://<host>/<name>/` instead of
the bare `https://<host>/`. From there, [Getting started](getting-started.md)
applies unchanged, one instance at a time:

- `docker compose up` failed? [Troubleshooting](getting-started.md#troubleshooting)
  covers the common port conflict.
- [First sign-in](getting-started.md#first-sign-in): the first login and the
  `Welcome.md` note that instance starts with.
- [The certificate warning](getting-started.md#the-certificate-warning): why
  the browser warns, and how to trust Caddy's local CA instead of clicking
  through it every time.
- [On a phone](getting-started.md#on-a-phone) and
  [in the desktop app](getting-started.md#on-your-computer-in-the-desktop-app):
  using that instance outside the browser.
- [What next](getting-started.md#what-next): configuration, AI providers, and
  backups, per instance.

## Adding another person later

1. Open `docker-compose.yml` and:
   - Copy the last `scribedog-<N>` service block, bump the number
     (`scribedog-2` copied becomes `scribedog-3`), and point its
     `SCRIBEDOG_BASE_PATH`, `SCRIBEDOG_INIT_PASSWORD`, `PUID`, `PGID`,
     `SCRIBEDOG_USER` and data volume at the matching `PERSON3_*` variables.
     Keep the `/shared` volume and the other two `SCRIBEDOG_SHARED_*` lines
     as they are: every instance mounts the same folder.
   - Add `- scribedog-3` to the `caddy` service's `depends_on:` list.
   - Add `PERSON3_BASE_PATH: ${PERSON3_BASE_PATH:-/PERSON3_UNSET}` to the
     `caddy` service's `environment:` block, next to
     `PERSON1_BASE_PATH` / `PERSON2_BASE_PATH`.
2. Open the Caddyfile and add a matching block next to the existing ones,
   again just the next number:
   ```caddyfile
   handle {$PERSON3_BASE_PATH:/PERSON3_UNSET}* {
       reverse_proxy scribedog-3:3000
   }
   ```
3. Open `.env` and add the `PERSON3_*` group next to the other two:
   `PERSON3_INIT_PASSWORD=` (eight characters or more), `PERSON3_BASE_PATH=/carol`
   (or whatever path you want), `PERSON3_USER=carol` (their name in shared
   vaults), `PERSON3_DATA_DIR=carol-data` and
   `PERSON3_PUID`/`PERSON3_PGID` (their own Linux user, see [Keeping the
   folders apart](#keeping-the-folders-apart)). Leaving the last three out
   means the folder gets the fallback name from the copied service block and
   the ids of the person you copied it from.
4. Run `docker compose up -d`. This starts only the new container; the
   running ones are untouched. The fallback 404 (a client without a prefix)
   is deliberately generic and does not list instances, so nothing else in
   the Caddyfile needs touching for this.

## Removing a person

1. If you want to keep their notes, back up the data folder now (e.g.
   `./bob-data`); removing the service does not delete it, but do this before
   you forget.
2. Remove that `PERSON<N>` service block from `docker-compose.yml` (and drop
   it from Caddy's `depends_on` and from Caddy's `environment:` block).
3. Remove the matching `handle {$PERSON2_BASE_PATH:/bob}* { ... }` block
   from the Caddyfile.
4. Remove that person's `PERSON<N>_*` variables from `.env`.
5. Run `docker compose up -d --remove-orphans`. This stops and removes the
   now-undefined container in one step; the remaining instances keep running.
6. Delete `./bob-data` once you are sure you no longer need it, or after
   moving it elsewhere per step 1.

## Moving an existing single instance here

Your notes are not at risk: the data folder is untouched by any of this until
step 4, and even then it is a move, not a copy.

1. Stop the single instance: `docker compose down` in its folder.
2. Get the three multi-instance files into a new folder, as in step 1 of
   "Setting it up from scratch" above.
3. Move that person's data folder (`./scribedog-data` in the single-instance
   default) next to the new files, and change `PERSON1_DATA_DIR` in `.env` to
   its name (e.g. `PERSON1_DATA_DIR=scribedog-data`) so nothing needs
   renaming on disk. Set `PERSON1_BASE_PATH` to a path for that person (their
   old address if `SCRIBEDOG_BASE_PATH` was already set, otherwise pick one,
   e.g. `/anna`) and `PERSON1_PUID`/`PERSON1_PGID` to whatever the single
   instance used (its own `.env` already had these).
4. Fill in `PERSON2_*` for the second person (see step 2 of "Setting it up
   from scratch"), and match `SCRIBEDOG_SITE_ADDRESS` and the ports to what
   the existing instance already had.
5. Start it: `docker compose up -d` (or `--build` if you build from source).

If the single instance served the bare `https://<host>/` before
(`SCRIBEDOG_BASE_PATH` empty), it now answers under `PERSON1_BASE_PATH`
instead. Update any bookmarks and the desktop app's server-vault connection
to the new address.

## Caddyfile details

Two things are worth knowing if you write your own Caddyfile instead of the
bundled one:

- The instances are routed with `handle`, not `handle_path`: the prefix has
  to reach the container intact, because the app answers under it and would
  otherwise neither find its assets nor scope its cookie.
- A browser that opens the site by IP address sends no server name, and with
  more than one site Caddy needs `default_sni` to pick a certificate (see
  `SCRIBEDOG_DEFAULT_SNI` in [Configuration](configuration.md)).

## Keeping the folders apart

The data folders are plain folders on the host, so whoever can read
`anna-data` can read that person's notes. If the people sharing the box also
have shell access to it, give every instance its own Linux user and folder
permissions to match:

```bash
sudo useradd --system --no-create-home anna
sudo mkdir anna-data && sudo chown anna:anna anna-data && sudo chmod 700 anna-data
id anna                       # -> PERSON1_PUID / PERSON1_PGID in .env
```

The container starts as root, hands the folder to that user and drops to it,
so the files it writes stay that user's. This keeps ordinary users out of
each other's notes; it does not keep root out, and nothing on the host can
(see [Security](security.md)).

The start script runs the server with `umask 002` when shared vaults are set
up, so the shared folder stays writable for the group. Files in a person's
own data folder are then group-writable too, for their own group; with a
Linux user and group of their own per person, as above, that is nobody else.

## Shared vaults

Next to their own vault, the people of a multi-instance setup can keep vaults
together: "Familie" for three of them, "Haushalt" for two. Whoever creates
one picks a name and the members, and only members see it. The creator can
rename it, change the members and delete it; a member can leave on their
own. Someone taken off a vault loses access at once, open tabs included.

Each shared vault is a complete vault of its own (notes, `images/`, version
history), not a folder inside somebody's vault. Two people saving the same
note do not overwrite each other: changes at different places are merged,
and overlapping ones are asked about (see
[Editing from more than one place](data-and-backups.md#editing-from-more-than-one-place)).
Chat history and the agent's pending proposals stay personal: each person
has their own in `.scribedog/users/<name>/` inside the shared vault.

### Using them

Once sharing is set up, the vault name at the top of the sidebar becomes a
menu: **My vault**, every shared vault you are in below it, then
**New shared vault…** and **Manage vaults…**. The menu is where vaults are
opened; the dialog is where they are managed.

| Where | What it does |
| --- | --- |
| **New shared vault…** | A name and the people to share with. The new vault opens right away. |
| **Manage vaults…** | Under **Shared vaults**, every shared vault you are in, with who created it and who is in it. The creator can edit (name, members) and delete; everyone else can leave. Your deleted vaults are listed under **Trash** with the date they go for good, and can be restored until then. |
| The file tree and the note's header | A people icon on a note someone else has open right now, and their name next to the save button when it is the note you have open. It is a hint, nothing is locked. |

When a vault you have open is deleted, or you are taken off it, a message
says so and takes you back to your own vault. Members who were not there
when it was deleted see a one-time note under the vault name.

The desktop app does the same once it is connected to your instance: the
vault menu in its sidebar lists your shared vaults under the server they
belong to, next to your local folders, and creating, managing and the
presence hints all work there too. Its **Manage vaults…** covers the same
ground plus the folders on that computer and the servers it knows. It signs in as the person of that instance, so there is nothing extra
to set up.

### Setting it up

A setup created with the current example compose file already has everything;
what it needs from you is in `.env`:

| Variable | What it is |
| --- | --- |
| `PERSON<N>_USER` | The person's name for the others, e.g. `anna`. Lowercase letters, digits, `-` and `_`. Pick it once: a changed name is a different person to the shared vaults. Leave it empty to keep that instance out of sharing. |
| `SHARED_DIR` | The folder for shared vaults, next to the data folders. `shared` by default. |
| `SHARED_GID` | A group id that is free on the host (`getent group 1500` prints nothing). The shared folder belongs to this group. |

A person can be picked as a member once their instance has started at least
once with a name.

### Turning it on in a setup you already run

A compose file written before this feature existed passes none of the three
variables into the containers, so filling in `.env` alone changes nothing.
Three steps, and the running instances keep their notes, passwords and
sessions:

1. **Pick a group id that is free on the host.** Run `getent group 1500` on
   the server; it must print nothing. Try another number until it does. The
   shared folder belongs to this group, which is how the instances, each
   running as its own Linux user, can all write in it.

2. **Open `docker-compose.yml`** and give every `scribedog-<N>` service three
   more environment lines and a second volume, each with that person's own
   `PERSON<N>_USER` variable:

   ```yaml
     scribedog-1:
       environment:
         # ... the lines you already have
         SCRIBEDOG_USER: ${PERSON1_USER:-}
         SCRIBEDOG_SHARED_PATH: /shared
         SCRIBEDOG_SHARED_GID: ${SHARED_GID:-1500}
       volumes:
         # ... the data volume you already have
         - ./${SHARED_DIR:-shared}:/shared
   ```

   `SCRIBEDOG_SHARED_PATH` and `SCRIBEDOG_SHARED_GID` are the same for every
   instance: they all mount the one shared folder. Only `SCRIBEDOG_USER`
   differs.

3. **Open `.env`** and add the names and the group:

   ```dotenv
   PERSON1_USER=anna
   PERSON2_USER=bob
   SHARED_DIR=shared
   SHARED_GID=1500
   ```

Then `docker compose up -d`. The folder is created on the next start, with
the group and modes the instances need, and the vault name in the sidebar
becomes the menu described above.

An instance whose `PERSON<N>_USER` you leave empty stays out of sharing and
runs as before; with the folder mounted but no name, that instance starts
without sharing and says so in its log rather than refusing to run. The
group id is the one thing the container insists on: `SCRIBEDOG_SHARED_PATH`
without a numeric `SCRIBEDOG_SHARED_GID` stops the start with a message,
because a shared folder nobody can write to would fail later and less
clearly.

Nothing here is required by the update itself: a server updated without these
changes keeps working exactly as it did.

### Who can write where

Every instance runs as its own Linux user (see
[Keeping the folders apart](#keeping-the-folders-apart)), so the shared folder
cannot belong to any one of them. It belongs to the `SHARED_GID` group
instead, and each container adds its user to that group when it starts. All
folders inside carry the setgid bit, so whatever anyone creates there keeps
the group, and the server writes with `umask 002`, so it stays writable for
the others. The start script repairs group and modes when it finds something
off, for example after files were copied in by hand.

> **The rule is kept by the app, not by the disk.** Every instance can read
> every shared vault on disk; which person may open which vault is decided by
> the server on each request. The people in this setup can therefore not
> keep a shared vault from each other's *container*, only from each other in
> the app. Root on the host sees everything anyway (see [Security](security.md)).

### Deleting and the trash

Deleting a shared vault asks first and then moves it to `shared/.trash/`. It
stays there for 30 days; until then the creator can restore it. The other
members see a one-time note that it was deleted, and anyone who has it open
is told so instead of meeting an error. After the 30 days every instance's
daily clean-up removes it for good.

### On disk

```text
shared/
├── .scribedog/registry.json   which vaults exist, their names and members
├── .trash/                    deleted vaults, for 30 days
├── familie-7f3a/              a vault: the name at creation plus a short id
└── haushalt-0c12/
```

The folder name is made once from the name the vault was created with and
never changes, so renaming a vault touches nothing on disk. The registry is
plain JSON written by the instances; edit it only with all of them stopped.
