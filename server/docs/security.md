# Security

What protects the instance, what it protects against, and what it does not.
Short version: one password, sessions in the browser, access keys for the
desktop app, everything else is your host's business.

## The password

One password protects the instance; there is no user name. Three things are
worth knowing about it.

**Changing it** is in Settings → Account in the browser. It takes effect
everywhere at once: every other signed-in browser is signed out, every desktop
app loses its access key and asks for the new password the next time it
talks to the server, and the browser you changed it on stays signed in.
Stored API keys survive the change, re-encrypted under the new password.

**Wrong guesses are slowed down.** After five failures from one address the
next attempt is refused for a minute, after the next five for five minutes,
then fifteen, which is the ceiling. A correct password clears the count. The
numbers are configurable (see [Configuration](configuration.md)); behind a
reverse proxy the count follows `X-Forwarded-For`, so one attacker does not
lock out the household. The lock applies to every route that takes the
password: the login, the password change and the desktop app's key request.

**Forgotten it?** Delete `.scribedog/server/auth.json` in the data folder,
set `SCRIBEDOG_INIT_PASSWORD` again and restart. Your notes are untouched,
but the stored API keys are not: they are encrypted with a key derived from
the old password and cannot be recovered. The app says so once and asks you
to enter them again. Desktop apps need to be signed in again as well.

## Browser sessions

Signing in sets a cookie that is valid for 60 days of use (each request
extends it) and is sent only to this instance (`Secure`, `HttpOnly`, scoped
to the path prefix). Sessions survive server restarts and updates. Signing
out ends this browser's session; changing the password ends all of them.

## Access keys for the desktop app

The desktop app has no cookie jar. When you add a server to it, it sends the
password once and receives an **access key** in return; the password is not
kept. The key is stored in the operating system's credential store on that
computer, and every request the app makes carries it.

What the server keeps is a fingerprint of the key (a hash), never the key
itself, together with the device name and when the key was created and last
used. That is what the **Signed-in devices** list shows, in the browser under
Settings → Account and in the desktop app under the vault menu → Manage
vaults… → Edit on the server. Someone
who copies the data folder therefore cannot use the keys in it.

Access keys do not expire. They end when:

- you **revoke** one from the device list (the desktop app notices right
  away, also while idle, and asks for the password);
- the desktop app **disconnects** from the server, which revokes its own key;
- the **password changes**, which ends every key and every browser session
  together.

**What a key can do.** Everything the password can with the notes: read,
write, rename and delete any file in the vault. It cannot change the
password, and it cannot read the API keys stored on the server (those need
the browser session's second cookie). Treat a computer with an access key
like a computer that is signed in.

**Lost a laptop?** Revoke its key from another device. That ends its access
without changing the password, so nothing else is signed out.

## Requests from other sites

Requests that change something must come from this instance: the session
cookie is `SameSite=Lax`, and the server additionally rejects a request whose
`Origin` or `Referer` names another site. A request with neither header (curl,
a script) is accepted, since it cannot be a browser carrying someone else's
cookie. A request that proves itself with an access key and carries no cookie
skips the check, because a browser cannot attach that header on behalf of a
foreign page.

## API keys of the AI providers

They are stored encrypted in `.scribedog/server/secrets.json`, under a key
derived from your login password, and only ever leave the server on their
way to the provider you chose. The browser sees a placeholder. See [AI](ai.md).

## TLS

Never expose the server without TLS beyond `localhost`: the password and the
access keys would travel in clear text. The bundled Caddy provides HTTPS; see
[Configuration](configuration.md) for the local CA and for public domains.

## What is not protected

The notes are plain Markdown files in a folder on the host, on purpose:
readable with any editor, greppable, free of lock-in. Consequences:

- **Whoever can read the folder can read the notes**, whether ScribeDog is
  running or not. Folder permissions keep other users of the host out; full
  disk encryption keeps out whoever takes the disk. See
  [Your data and backups](data-and-backups.md).
- **Root on the host can read everything.** No file permission stops that,
  and the server edition does not try to: that would take encrypting the
  notes in the browser, which would break search and the agent's file tools.
  The host's administrator is someone you trust, or yourself.
- **The password hash is readable** in `.scribedog/server/auth.json`. That is
  what a hash is for; it is scrypt with a random salt, and a stolen hash does
  not sign anyone in.
