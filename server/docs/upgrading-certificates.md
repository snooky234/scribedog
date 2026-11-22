# Upgrading the certificate

Before version 0.27.0 the server used Caddy's own certificate authority
(`SCRIBEDOG_TLS=internal`). That CA can vouch for any website, and its key
stays on the server for years, so whoever got hold of the server could
impersonate any site on every device that trusts it. Newer versions create a
CA for your installation alone instead, whose key is deleted right away
(see [The certificate](certificates.md)). The old mode is gone: until you
switch, `docker compose up` stops with a message that points here.

Only installations on a home network are affected. With Let's Encrypt
(`SCRIBEDOG_TLS` set to your e-mail address) there is nothing to do.

## On the server

1. **Get the new files.** A clone of the repository: `git pull`. Otherwise,
   download `docker-compose.yml` and `caddy/Caddyfile` again as in
   [Getting started](getting-started.md#install) (keep your `.env`), and set
   `SCRIBEDOG_IMAGE` to the new version. Updating only `SCRIBEDOG_IMAGE` is
   not enough: half of the change is in those two files.
2. **Edit `.env`:** change `SCRIBEDOG_TLS=internal` to `SCRIBEDOG_TLS=`
   (empty).
3. **Create the certificate and start:**

   ```bash
   docker compose run --rm certificates
   docker compose up -d
   ```

   Note the fingerprint the first command prints.
4. **Delete Caddy's old CA**, so its key is gone from the server too:

   ```bash
   docker compose exec caddy rm -rf /data/caddy/pki
   docker compose restart caddy
   ```

## On every device

1. **Remove the old certificate.** It is called "Caddy Local Authority",
   followed by a year. Where to find it: the same place you installed it
   ([Installing it on your devices](certificates.md#installing-it-on-your-devices)
   lists them); on Android under Trusted credentials, User; on an iPhone
   under VPN & Device Management; on Windows in `certmgr.msc`, Trusted Root
   Certification Authorities, Certificates.
2. **Install the new one** and compare the fingerprint, as described in
   [The certificate](certificates.md#installing-it-on-your-devices).

Until a device has the new certificate, its browser warns about the server
and the desktop app on it cannot connect.
