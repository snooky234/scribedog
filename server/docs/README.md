# ScribeDog Server Edition: User Guide

ScribeDog Server Edition runs the ScribeDog note editor as a self-hosted web
app. Your notes live in a folder on your own server, you edit them in the
browser or in the desktop app, and one password protects the instance.

This guide goes from the first start to the details. If you only want to get
running, [Getting started](getting-started.md) is enough; the rest is here
for when you need it.

## Contents

1. [Getting started](getting-started.md): requirements, installation, first
   sign-in, the certificate warning, opening the app on a phone.
2. [Multiple users on one host](multiuser.md): fresh setup, moving a single
   instance to multi-user, adding or removing a person later.
3. [On one Windows PC, without Docker](windows-without-docker.md): a local
   web app on a computer where the desktop app is blocked and Docker or WSL
   are not available.
4. [Configuration](configuration.md): every setting, running under a path
   prefix, TLS and reverse proxies.
5. [The desktop app as a client](desktop-app.md): open the server vault in
   ScribeDog on your computer, with AI and dictation running locally.
6. [Phones and tablets](phones-and-tablets.md): how the app lays itself out
   on a small screen, and how to dictate.
7. [AI](ai.md): cloud providers through the server, a model on your own
   device, the chat agent, what stays desktop only.
8. [Security](security.md): the password, sessions, access keys for the
   desktop app, what is and is not protected.
9. [Your data and backups](data-and-backups.md): what is in the data folder,
   editing from more than one place, how to back it up.
10. [Updating](updating.md): versions, moving forward and back.
11. [API](api.md): every route, for scripts and your own tools.
12. [Development](development.md): running from source, tests.
13. [FAQ](faq.md): short answers to the questions that come up.

## In one paragraph

You run one container (plus Caddy for HTTPS) with a folder of Markdown files
mounted into it. The web app is the desktop app's own frontend, so it looks
and works the same on a desktop browser, a phone or a tablet: the file tree,
notes and folders, images, sort order, version history, live updates when a
file changes on disk, a link to every document for bookmarks, export as a download (PDF, DOCX, ODT, HTML, EPUB, or
the notes themselves as Markdown), and the AI features including the chat
agent. The desktop app can open the same folder over the network as a
"server vault", keeping its AI and dictation on your computer. Three things
stay desktop only: the knowledge base (its search index runs inside the
desktop app), built-in dictation (the web app uses what your device already
has) and importing files (the desktop app does that, also into a server
vault).
