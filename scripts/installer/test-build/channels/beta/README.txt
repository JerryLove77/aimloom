Aimloom Beta {{VERSION}}

KovaaK setup manager: background, sounds, crosshair, enemy look, and training Profiles. This is
a beta build, opted into from Settings; it can be rough, so please report anything that breaks.

[Before you start]
- Windows 10 or 11 (64-bit)
- WebView2: built into Windows 11; on Windows 10, if the window does not open,
  install the Microsoft Edge WebView2 Runtime

[How to open]
1. Put this whole folder anywhere, not inside the game folder. Keep Aimloom.exe
   together with VERSION.txt, which you need when you report a problem.
2. Double-click Aimloom.exe.
3. If a blue "Windows protected your PC" screen appears: choose More info, then Run anyway.
   Aimloom has no code-signing certificate, so Windows does not recognize it.

[Before you use it]
- The Profile format changed: Profiles saved by 0.1.5 (the old format) are not read by this
  version, so recreate them; Profiles made in this beta cannot be opened by 0.1.5.
- Close KovaaK before writing to the game files.
- Every write is backed up first; open Quick import from the Explore page ("Open Quick import") to undo it.
- Backups and Profiles are kept in %LOCALAPPDATA%\Aimloom, shared with the stable App.
- Which crosshair you use is chosen in the game.
- The language follows Windows; change it in Settings at the bottom left.

[Please report problems]
Open Settings at the bottom left and choose "Send a report...". Include:
1. a screenshot
2. VERSION.txt from this folder
3. the log file worker.log: paste %LOCALAPPDATA%\Aimloom\logs into the
   File Explorer address bar and press Enter to open that folder

[Going back to stable]
Install the stable Setup from https://aimloom.dev over this build, then in Settings turn off
"Join the beta" so you are not offered another beta.
