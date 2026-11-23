# The certificate

On a home network there is no public domain to get a certificate for, so
every ScribeDog installation makes its own: a small certificate authority
(CA) for this installation alone, and one server certificate signed by it.
You install the CA once on each device, and from then on browsers and the
desktop app trust the server without a warning.

Installing a CA on a device is a matter of trust, so this one is built to be
as harmless as possible:

- **Its key no longer exists.** The script creates the CA in memory, signs
  the one server certificate with it and discards the key; it is never
  written to disk. Nobody can use this CA to issue another certificate, not
  someone who breaks into the server, and not you.
- **It is limited to your addresses.** The CA itself states that it may only
  vouch for the addresses of this installation. This is a second line of
  defence for the unlikely case that the key leaked while the script ran.

> **Not every system checks the address limit.** The desktop app and
> Windows' own certificate check do. Android does not for a CA you install
> yourself, which the standard allows. The first point still applies there:
> without the key the CA cannot vouch for anything else. On Android, most
> apps ignore certificates you installed anyway; browsers use them.

With a public domain you do not need any of this: see
[Let's Encrypt instead](#lets-encrypt-instead).

## Creating it

In the folder with `docker-compose.yml`:

```bash
docker compose run --rm certificates
```

That makes a certificate for the address in `SCRIBEDOG_SITE_ADDRESS`. To
name the addresses yourself, add them; every address your devices use to open
ScribeDog has to be in the list:

```bash
docker compose run --rm certificates 192.168.1.50 nas.fritz.box
```

The output ends with the CA's **fingerprint**, a long row of hex pairs. Keep
it at hand, you will compare it on each device. The files land in `./certs`:

| File | What it is |
| --- | --- |
| `ca.crt` | The CA. Public; this is what goes onto your devices. |
| `server.crt` | The server's certificate. Public. |
| `server.key` | The server's private key. Readable by root only; never share it. |

Then start (or restart) the stack with `docker compose up -d`.

> **Give the server a fixed address.** The certificate is valid for exactly
> the addresses it was made for. If your router hands the box a different IP
> one day, browsers will warn again. Reserve the address for the box in your
> router's network or DHCP settings.

The certificate is valid for 825 days, the most iOS accepts.

## Installing it on your devices

On each device, open `http://<address>/scribedog-ca.crt` (plain `http`, so
there is no warning to click through first) or, once signed in, use
**Settings, Account, Download certificate**. Then:

| Device | How |
| --- | --- |
| Android | Settings, Security, Encryption & credentials, Install a certificate, CA certificate, pick the downloaded file. Firefox for Android additionally needs "Use third party CA certificates" in its secret settings. |
| iPhone, iPad | Open the address in **Safari**, allow the profile download. Settings, Profile Downloaded, Install. Then Settings, General, About, Certificate Trust Settings and switch on **full trust** for the certificate. Without this last step it does not work. |
| Windows | Double-click the file, Install Certificate, Current User, "Place all certificates in the following store", *Trusted Root Certification Authorities*. Confirm the security warning. |
| macOS | Double-click the file to add it to Keychain Access, open it there and set "When using this certificate" to *Always Trust*. |
| Linux | Debian and Ubuntu: copy it to `/usr/local/share/ca-certificates/scribedog-ca.crt` and run `sudo update-ca-certificates`. |
| Firefox (desktop) | Firefox has its own store: Settings, Privacy & Security, Certificates, View Certificates, Authorities, Import, tick "Trust this CA to identify websites". |

The desktop app uses the system store, so on Windows, macOS and Linux the
system step is enough for it.

> **Antivirus with HTTPS scanning (Avast, AVG and similar).** These programs
> open HTTPS connections themselves and check the certificate with their
> own code. Avast blocks the site with "the server certificate is invalid"
> even when the CA is installed, while Windows and the browser accept it.
> Add an exception for the server in the antivirus, for example
> `https://192.168.1.50/*` (Avast: Settings, General, Exceptions), then
> restart the browser. The exception covers the desktop app as well.

### Comparing the fingerprint

The file could have been swapped on its way to the device, so compare its
SHA-256 fingerprint with the one the script printed. They must match
exactly.

| Device | Where to see it |
| --- | --- |
| Android | Settings, Security, Encryption & credentials, Trusted credentials, User, tap the certificate. |
| iPhone, iPad | Settings, General, VPN & Device Management, the profile, More Details, the certificate. |
| Windows | PowerShell: `(Get-PfxCertificate .\scribedog-ca.crt).GetCertHashString("SHA256")` (Windows shows only SHA-1 in its own dialog). |
| macOS | Keychain Access, double-click the certificate, "SHA-256" under Fingerprints. |
| Linux | `openssl x509 -in scribedog-ca.crt -noout -fingerprint -sha256` |
| Firefox | The certificate viewer, "SHA-256" under Fingerprints. |

Windows and Linux print the pairs without colons or in a different case;
only the characters have to match.

## Renewing the certificate

ScribeDog reminds you two months ahead: a notice in the app, and the date in
**Settings, Account**. Renew also when the server's address changes.

1. **On the server**, in the folder with `docker-compose.yml`:

   ```bash
   docker compose run --rm certificates
   docker compose restart caddy
   ```

   Note the new fingerprint.

2. **On every device**, remove the old certificate and install the new one
   as described [above](#installing-it-on-your-devices). Its name contains
   the address and the date it was made, "ScribeDog CA 192.168.1.50
   2026-11-22", so old and new are easy to tell apart. Then compare the
   fingerprint.

There is no way to extend the old certificate: its CA has no key anymore,
which is exactly what makes it safe.

## Let's Encrypt instead

With a public domain whose ports 80 and 443 are reachable from the internet,
set `SCRIBEDOG_SITE_ADDRESS` to the domain and `SCRIBEDOG_TLS` to your e-mail
address in `.env`. Caddy then obtains and renews a certificate every device
already trusts, and nothing in this page applies.

## Behind your own reverse proxy

If another proxy terminates TLS instead of the bundled Caddy, you can still
create the files with `docker compose run --rm certificates` and configure
`certs/server.crt` and `certs/server.key` there. Serve `certs/ca.crt` at
`/scribedog-ca.crt` if you want **Settings, Account** to offer the download
and show the date.

## Upgrading from an older version

Before version 0.27.0 the server used Caddy's own CA. Moving to this one takes
a few minutes: see [Upgrading the certificate](upgrading-certificates.md).
