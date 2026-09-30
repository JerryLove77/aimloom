; Aimloom installer hooks. Tauri's template (windows/installer.nsi) includes this file near its
; top and inserts NSIS_HOOK_PREINSTALL at the start of the Install section (right after it has
; created and entered the install folder). The template guards every hook with !ifmacrodef, so
; no other hook is defined. The Setup looks for no other program and starts none; it removes only an empty folder it made.
; Spec: docs/superpowers/specs/2026-09-19-aimloom-setup-design.md §3.1.
;
; Only defines and functions live at the top level: the template declares its own variables
; and loads its languages after this include. So the texts are plain defines picked at run time
; by $LANGUAGE, not LangStrings.

; Refusal shown when the chosen folder is the data folder (see AimloomInsideDataDir below).
!define AIMLOOM_DATADIR_ZH "不能安装到 Aimloom 的数据文件夹：备份和 Profile 保存在那里。请重新运行安装程序，换一个文件夹。"
!define AIMLOOM_DATADIR_EN "Aimloom cannot be installed into its own data folder, where backups and Profiles are kept. Run the installer again and choose another folder."

; Copies the Chinese text into OUT when the installer runs in Simplified Chinese (2052), and
; the English text otherwise.
!macro AIMLOOM_TEXT OUT NAME
  ${If} $LANGUAGE == 2052
    StrCpy ${OUT} "${AIMLOOM_${NAME}_ZH}"
  ${Else}
    StrCpy ${OUT} "${AIMLOOM_${NAME}_EN}"
  ${EndIf}
!macroend

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
