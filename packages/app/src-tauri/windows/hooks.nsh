; Aimloom installer hooks. Tauri's template (windows/installer.nsi) includes this file near its
; top. It inserts NSIS_HOOK_PREINSTALL at the start of the Install section (right after it
; has created and entered the install folder) and NSIS_HOOK_POSTINSTALL at its end, after every file is in place.
; Spec: docs/superpowers/specs/2026-09-19-aimloom-setup-design.md §3.1 and §3.3.
;
; Only defines, one variable and functions live at the top level: the template declares its
; own variables (PassiveMode and the rest) and loads its languages after this include. So the
; texts are plain defines picked at run time by $LANGUAGE, not LangStrings.

!define AIMLOOM_PWSH_ASK_ZH "Aimloom 需要 PowerShell 7。现在用 winget 安装吗？需要联网下载约 120 MB，网速慢时可能要几分钟。下载进度显示在弹出的窗口里，关掉那个窗口即可取消。Windows 可能会请求管理员权限。"
!define AIMLOOM_PWSH_ASK_EN "Aimloom needs PowerShell 7. Install it now with winget? It downloads about 120 MB, which can take several minutes on a slow connection. A separate window shows the progress; close it to cancel. Windows may ask for administrator permission."
; Identical to PWSH_MISSING and PWSH_MISSING_EN in packages/app/src-tauri/src/installer/worker.rs
; (a test checks both).
!define AIMLOOM_PWSH_MISSING_ZH "没有找到 PowerShell 7。请先安装，然后重新打开本程序：在「终端」中运行 winget install --id Microsoft.PowerShell，或访问 https://aka.ms/powershell 下载。"
!define AIMLOOM_PWSH_MISSING_EN "PowerShell 7 was not found. Install it, then reopen Aimloom: run winget install --id Microsoft.PowerShell in Terminal, or download it from https://aka.ms/powershell."
!define AIMLOOM_PWSH_FOUND_ZH "PowerShell 7：已找到"
!define AIMLOOM_PWSH_FOUND_EN "PowerShell 7: found"
!define AIMLOOM_PWSH_SILENT_ZH "PowerShell 7：未找到。静默安装不会自动安装它"
!define AIMLOOM_PWSH_SILENT_EN "PowerShell 7: not found. A silent install does not install it"
!define AIMLOOM_PWSH_INSTALLING_ZH "正在用 winget 安装 PowerShell 7，进度见弹出的窗口…"
!define AIMLOOM_PWSH_INSTALLING_EN "Installing PowerShell 7 with winget; its window shows the progress..."
; Tried first: the Microsoft Store's copy of PowerShell 7, an MSIX package like the GitHub
; .msixbundle the winget source picks (the tester's PC runs the Store-signed one). The Store
; serves it from Microsoft's CDN, which players in China reach without a proxy. The winget
; source hands its GitHub download to Delivery Optimization (winget's log says so), a system
; service widely reported not to use the player's proxy settings, so a download could stall
; there while the browser works.
!define AIMLOOM_WINGET_STORE_ARGS "install --id 9MZ1SNWT0N5D --exact --source msstore --accept-package-agreements --accept-source-agreements"
; Then the winget source, for a Windows without the Store (LTSC, trimmed builds).
!define AIMLOOM_WINGET_ARGS "install --id Microsoft.PowerShell --exact --source winget --accept-package-agreements --accept-source-agreements"
; Last, the browser, which does use the player's proxy. Microsoft's install page lists the
; current MSI (aka.ms/powershell-release answered 404 on 2026-09-24).
!define AIMLOOM_PWSH_PAGE_URL "https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-windows"
!define AIMLOOM_PWSH_PAGE_ZH "现在用浏览器打开 PowerShell 7 的下载页吗？"
!define AIMLOOM_PWSH_PAGE_EN "Open the PowerShell 7 download page in your browser now?"
; Refusal shown when the chosen folder is the data folder (see AimloomInsideDataDir below).
!define AIMLOOM_DATADIR_ZH "不能安装到 Aimloom 的数据文件夹：备份和 Profile 保存在那里。请重新运行安装程序，换一个文件夹。"
!define AIMLOOM_DATADIR_EN "Aimloom cannot be installed into its own data folder, where backups and Profiles are kept. Run the installer again and choose another folder."

Var AimloomPwsh ; "1" once a PowerShell 7 or newer has answered

; Copies the Chinese text into OUT when the installer runs in Simplified Chinese (2052), and
; the English text otherwise.
!macro AIMLOOM_TEXT OUT NAME
  ${If} $LANGUAGE == 2052
    StrCpy ${OUT} "${AIMLOOM_${NAME}_ZH}"
  ${Else}
    StrCpy ${OUT} "${AIMLOOM_${NAME}_EN}"
  ${EndIf}
!macroend

; A candidate pwsh.exe path on the stack. Sets $AimloomPwsh to "1" when it runs and reports a
; major version of 7 or more: the same test as validated_pwsh in worker.rs.
Function AimloomTryPwsh
  Exch $R0
  Push $R1
  Push $R2
  ${If} ${FileExists} "$R0"
    ; /OEM: a Unicode installer otherwise reads the child's byte output as UTF-16, so "7" parses as 0.
    nsExec::ExecToStack /OEM '"$R0" -NoProfile -NonInteractive -Command "$$PSVersionTable.PSVersion.Major"'
    Pop $R1
    Pop $R2
    ${If} $R1 == "0"
      IntOp $R2 $R2 + 0
      ${If} $R2 >= 7
        StrCpy $AimloomPwsh "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

; The App's order: Program Files first, then PATH. NSIS is a 32-bit process, so plain
; $PROGRAMFILES would be "Program Files (x86)".
Function AimloomFindPwsh
  StrCpy $AimloomPwsh "0"
  Push "$PROGRAMFILES64\PowerShell\7\pwsh.exe"
  Call AimloomTryPwsh
  ${If} $AimloomPwsh != "1"
    Push $R0
    SearchPath $R0 "pwsh.exe"
    ${If} $R0 != ""
      Push $R0
      Call AimloomTryPwsh
    ${EndIf}
    Pop $R0
  ${EndIf}
FunctionEnd

; One winget install in its own console window, not through nsExec: winget prints no progress
; into a pipe (checked: a piped download of the ~120 MB package writes six lines and nothing
; while it downloads), so a hidden run on a slow connection looked like a frozen installer with
; no way out. The window shows winget's own progress bar, and closing it cancels; either way the
; detection that follows decides what happens next. $R0 = winget.exe; uses $R3.
!macro AIMLOOM_WINGET_INSTALL ARGS
  ClearErrors
  ExecWait '"$R0" ${ARGS}' $R3
  ${If} ${Errors}
    StrCpy $R3 "not started"
  ${EndIf}
  DetailPrint "winget ${ARGS}: $R3"
  Call AimloomFindPwsh
!macroend

; Only in an interactive install, and only after Yes. Any UAC prompt belongs to winget and the
; package it runs; the player answers it.
Function AimloomOfferPwsh
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  !insertmacro AIMLOOM_TEXT $R1 PWSH_ASK
  ${If} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION "$R1" /SD IDNO IDYES`
    StrCpy $R0 "$LOCALAPPDATA\Microsoft\WindowsApps\winget.exe"
    ; Every App Execution Alias is a zero-byte reparse point, so FileExists is true even when
    ; App Installer is not there and the "winget.exe" behind it cannot run. Ask it for its
    ; version and believe only an exit code of 0. The player has already said yes to a
    ; winget install at this point, so this costs one hidden, harmless invocation.
    StrCpy $R2 "1"
    ${If} ${FileExists} "$R0"
      nsExec::ExecToStack /OEM '"$R0" --version'
      Pop $R2
      Pop $R3
      DetailPrint "winget --version: $R2 $R3"
    ${EndIf}
    ${If} $R2 == "0"
      !insertmacro AIMLOOM_TEXT $R1 PWSH_INSTALLING
      DetailPrint "$R1"
      !insertmacro AIMLOOM_WINGET_INSTALL "${AIMLOOM_WINGET_STORE_ARGS}"
      ${If} $AimloomPwsh != "1"
        !insertmacro AIMLOOM_WINGET_INSTALL "${AIMLOOM_WINGET_ARGS}"
      ${EndIf}
    ${EndIf}
    ${If} $AimloomPwsh != "1"
      !insertmacro AIMLOOM_TEXT $R1 PWSH_MISSING
      !insertmacro AIMLOOM_TEXT $R2 PWSH_PAGE
      ${If} ${Cmd} `MessageBox MB_YESNO|MB_ICONEXCLAMATION "$R1$\n$\n$R2" /SD IDNO IDYES`
        ExecShell "open" "${AIMLOOM_PWSH_PAGE_URL}"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

; --- The data folder is never an install folder -------------------------------------------
; %LOCALAPPDATA%\Aimloom holds backups, Profiles and logs, and the App adopts an older
; %LOCALAPPDATA%\KovaaKConfigInstaller by renaming it to that name, which only works while the
; name is free (data_root in worker.rs). The default folder is elsewhere, but the directory page
; lets a player browse anywhere and NSIS appends the product name, so choosing %LOCALAPPDATA%
; lands exactly there.

; In: $R8 = a folder. Out: $R9 = 1 when $INSTDIR is that folder or lies inside it. Uses $R6, $R7.
Function AimloomInsideDataDir
  StrCpy $R9 0
  ${If} $INSTDIR == $R8
    StrCpy $R9 1
  ${Else}
    StrLen $R7 "$R8\"
    StrCpy $R6 $INSTDIR $R7
    ${If} $R6 == "$R8\"
      StrCpy $R9 1
    ${EndIf}
  ${EndIf}
FunctionEnd

; The template has already created the install folder and made it the current directory by the
; time this macro runs. So a refusal first steps out of the folder and removes what it left: RMDir
; without /r takes a folder only when it is empty, so nothing a player owns can go.
; It steps out with the Windows API, not with NSIS's own output-path instruction: 7-Zip and
; scanners read that instruction statically, and with it in this branch they listed every packed
; file, Aimloom.exe included, under $TEMP.
!macro NSIS_HOOK_PREINSTALL
  Push $R6
  Push $R7
  Push $R8
  Push $R9
  StrCpy $R8 "$LOCALAPPDATA\Aimloom"
  Call AimloomInsideDataDir
  ${If} $R9 = 0
    StrCpy $R8 "$LOCALAPPDATA\KovaaKConfigInstaller"
    Call AimloomInsideDataDir
  ${EndIf}
  ${If} $R9 = 1
    System::Call 'kernel32::SetCurrentDirectoryW(w "$TEMP")'
    RMDir "$INSTDIR"
    RMDir "$LOCALAPPDATA\Aimloom"
    RMDir "$LOCALAPPDATA\KovaaKConfigInstaller"
    ${IfNot} ${Silent}
      !insertmacro AIMLOOM_TEXT $R8 DATADIR
      MessageBox MB_OK|MB_ICONSTOP "$R8"
    ${EndIf}
    Pop $R9
    Pop $R8
    Pop $R7
    Pop $R6
    Abort
  ${EndIf}
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; $R9 is the bundler's to lend, not ours to keep — the pre-install hook saves it and so do we.
  Push $R9
  Call AimloomFindPwsh
  ${If} $AimloomPwsh == "1"
    !insertmacro AIMLOOM_TEXT $R9 PWSH_FOUND
    DetailPrint "$R9"
  ${ElseIf} ${Silent}
  ${OrIf} $PassiveMode = 1
    !insertmacro AIMLOOM_TEXT $R9 PWSH_SILENT
    DetailPrint "$R9"
  ${Else}
    Call AimloomOfferPwsh
  ${EndIf}
  Pop $R9
!macroend
