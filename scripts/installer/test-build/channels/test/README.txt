Aimloom test build {{VERSION}}

[Before you start]
- Windows 10 or 11 (64-bit)
- PowerShell 7: included in the pwsh folder beside it; nothing to install
- WebView2: built into Windows 11; on Windows 10, if the window does not open,
  install the Microsoft Edge WebView2 Runtime

[How to open]
1. Put this whole folder anywhere. Do not take Aimloom.exe out on its own:
   it needs the scripts and pwsh folders beside it.
2. Double-click Aimloom.exe.
3. If a blue "Windows protected your PC" screen appears: choose More info, then Run anyway.
   A test build has no code-signing certificate, so Windows does not recognize it.

[Before you use it]
- Close KovaaK before applying a background, sounds, a crosshair or an enemy look.
- Every write to the game files is backed up first; Quick import at the bottom left
  undoes it.

[Please report problems]
Include these three things:
1. a screenshot
2. VERSION.txt from this folder
3. the log file worker.log: paste %LOCALAPPDATA%\Aimloom\logs into the
   File Explorer address bar and press Enter to open that folder
