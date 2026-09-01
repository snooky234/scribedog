ScribeDog - portable build
==========================

This is the same application as the installer version, but it does not install
anything: run ScribeDog.exe and you are done. No administrator rights, no
Start menu entry, no uninstaller, nothing written to the registry.

Where to put it
---------------

Unpack the ZIP into a folder you own: somewhere under Documents, your Downloads
folder, a folder of its own on your drive, or a USB stick. Any of those work.

Avoid the Windows system locations - C:\Program Files, C:\ProgramData,
C:\Windows. Two things go wrong there. Some of them you cannot write to, which
means portable mode cannot start and ScribeDog falls back to your user profile
(it tells you so in Settings). And a program that appears in a system folder
without an installer is a shape antivirus software is suspicious of, so you may
get a scan or a warning on every single launch.

Where your data goes
--------------------

Everything ScribeDog owns is kept in the ".scribedog" folder next to
ScribeDog.exe: your settings, the AI configuration, keyboard shortcuts, the
chat history and - once you download it - the ~460 MB voice recognition model.
Copy the whole folder to another machine or a USB stick and your setup travels
with it.

Your notes are not in here. They live in whatever vault folder you open, the
same as in the installed version.

The file ".scribedog/portable" is what switches portable mode on. Delete it and
ScribeDog behaves like the installed version, storing its settings in your
Windows user profile instead.

API keys are the exception
--------------------------

Keys for cloud AI providers are stored in the Windows Credential Manager, not
in the folder - that is what keeps them out of a plain text file on a stick
that can be lost. They are tied to the Windows account you entered them on, so
on a different machine you enter the key once more.

Two things to know
------------------

- If you put ScribeDog somewhere you cannot write to (C:\Program Files, a
  read-only medium), portable mode cannot start. ScribeDog then falls back to
  your user profile and says so in Settings.
- The portable build does not update itself. It still tells you when a new
  version is out; download the new ZIP and replace ScribeDog.exe.

Windows may warn about an unknown publisher on first launch - the build is not
code-signed. Choose "More info" and then "Run anyway".

Antivirus software may go a step further and scan ScribeDog.exe on every launch,
or quarantine it outright - usually reported as a generic heuristic detection
rather than a named piece of malware. A free-standing unsigned executable that
starts a browser engine of its own is a shape those heuristics dislike, and a
system folder or a temporary directory makes it more suspicious still, which is
why the section above suggests a folder in your user profile. If your scanner
still objects, every release is built in public from source by GitHub Actions -
the workflow and the code it builds are at the link below.

https://github.com/snooky234/scribedog
