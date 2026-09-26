# Phones and tablets

The same app, laid out for the screen it is on.

## On a phone

Below about 640 px wide:

- The file list is a sheet behind the button at the top left. It comes up by
  itself while no note is open and closes when you choose one.
- The formatting toolbar sits at the bottom, above the keyboard, and scrolls
  sideways. The chat button is in it, next to the AI buttons. The model and
  the thinking mode are behind the slider button after them, where the
  desktop has a dropdown; a dot on that button means no model is chosen yet.
- Saving is the icon button in the header: it is highlighted while there is
  something to save and greyed out once there is not.
- The image button in the toolbar opens the phone's own picker, so a photo
  can come straight from the camera or the photo library. It is stored in
  the vault's `images/` folder like a pasted one.
- Everything else the toolbar offers on the desktop (find and replace,
  details, zoom, zen mode, print, spell check, versions, back and forward)
  is in the header's menu.
- The chat and the details panel open as full-screen sheets.

## On a tablet

A touch screen up to about 1400 px wide gets the tablet layout, which covers
every iPad from the mini to the 13" Pro in both orientations. A browser
window with a mouse gets it up to about 920 px.

- The formatting toolbar sits at the bottom, above the keyboard, in one row
  that scrolls sideways, as on the phone. Find and replace, details, zoom,
  zen mode and the other view options are in the header's menu.
- In landscape the file list stays next to the note. Drag the handle between
  the two to make it wider or narrower; it takes at most about half the
  screen.
- In portrait the file list is a sheet behind the button at the top left, as
  on the phone. It comes up by itself while no note is open, closes when you
  choose one, and a swipe from the left edge brings it back.
- The chat and the details panel come in from the right.

## Touch

On a touch screen every row in the file tree has a "…" button for its menu
(a long press works on Android too), and **Move to…** in that menu does what
dragging does with a mouse.

Selecting text brings up the system's own menu, with its copy entry, as in
any other app; that copy is the one that keeps the formatting. The editor's
own selection menu behind the right mouse button stays closed on touch, since
a long press is how a word gets selected there, so the two other ways of
copying are in the header's menu instead: **Copy text as Markdown** and **Copy
text only**, both greyed out while nothing is selected. The paw button in the
toolbar is the way to the AI rewrite.

Pinching does not zoom the page on a phone or tablet: the layout is made for
the width it has. In zen mode a pinch resizes the text instead, like in a
reader app, and the size you settle on stays for zen mode only. On a desktop
Ctrl+mouse wheel (Cmd on a Mac) does the same there.

## Like an app

Add the site to the home screen (Chrome: "Add to Home screen", Safari: share
sheet, "Add to Home Screen") and it opens without the browser chrome. The
session lasts 60 days of use, so the password is asked for rarely.

Chrome and Safari on phones show a certificate warning for Caddy's local CA
just like the desktop browsers; accept the warning once, then download the
certificate from Settings, Account and install it on the device (see
[Getting started](getting-started.md)), or keep accepting the warning.

## Dictation

The desktop app's dictation runs Whisper on your computer; the server does
not transcribe, and the web app has no microphone button. Use what the device
already has, all of which type straight into the editor:

- **Windows:** press Win+H with the cursor in the note (voice typing, needs a
  one-time download of the language pack under Settings, Time & language,
  Speech).
- **macOS:** press the dictation key or Fn twice (System Settings, Keyboard,
  Dictation). Recent macOS versions transcribe on the device.
- **Phones and tablets:** the microphone key on the keyboard (Gboard, iOS).

The one thing the app could add on its own is a button on the browser's Web
Speech API, and it deliberately does not: in Chrome and Edge that API sends
the audio to Google's servers, Firefox does not support it at all, and the
system dictation above is on every device already, offline where the system
does it offline.

If you want Whisper, use the [desktop app](desktop-app.md) with the server
vault: its dictation works there as with a local folder.
