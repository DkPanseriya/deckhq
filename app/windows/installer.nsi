; DeckHQ for Windows: the installer.
;
;   makensis /DVERSION=1.7.1 /DAPP_SRC=<dist\app\DeckHQ> /DBUILD_DIR=<dist\app\_build> installer.nsi
;
; It is the portable folder `build.mjs` assembled, plus shortcuts and an entry
; in "Installed apps". Three rules it is held to (test/unit/app-windows.test.mjs):
;
;   * Per-user, and never elevated. It installs under %LOCALAPPDATA%\Programs
;     and writes only HKCU, so Windows has no reason to ask for an
;     administrator and this script never gives it one.
;   * The uninstaller removes what the installer wrote, by name. The two file
;     lists are generated from the folder as it was built; there is no
;     `RMDir /r $INSTDIR` here to take a stranger's files with it.
;   * ~\.deckhq is the user's data. It is never touched without a question
;     whose default answer is to keep it.

Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!ifndef VERSION
  !error "pass /DVERSION=x.y.z"
!endif
!ifndef APP_SRC
  !error "pass /DAPP_SRC=<the assembled dist\app\DeckHQ folder>"
!endif
!ifndef BUILD_DIR
  !error "pass /DBUILD_DIR=<dist\app\_build, where build.mjs wrote the file lists>"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "DeckHQ-Setup-${VERSION}.exe"
!endif

!define APP_NAME "DeckHQ"
!define PUBLISHER "Darshak Panseriya"
!define HOMEPAGE "https://deckhq.dev"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeckHQ"
; The name DeckHQ.exe holds while it is open (shell\Paths.cs, InstanceName).
!define RUNNING_MUTEX "DeckHQ.Shell"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\DeckHQ"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
BrandingText "DeckHQ ${VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "DeckHQ Setup"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "LegalCopyright" "MIT License. Copyright (c) ${PUBLISHER}"

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define MUI_ICON "${BUILD_DIR}\DeckHQ.ico"
!define MUI_UNICON "${BUILD_DIR}\DeckHQ.ico"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_NODESC
!define MUI_FINISHPAGE_RUN "$INSTDIR\DeckHQ.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start DeckHQ"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; Files in use cannot be replaced or removed, so neither half runs while a
; DeckHQ window is open. $0 is the mutex handle, zero when there is none.
!macro RefuseWhileRunning
  System::Call 'kernel32::OpenMutexW(i 0x00100000, i 0, w "${RUNNING_MUTEX}") p .r0'
  StrCmp $0 0 notRunning
  System::Call 'kernel32::CloseHandle(p r0)'
  MessageBox MB_OK|MB_ICONEXCLAMATION "DeckHQ is open. Close its window, then run this again." /SD IDOK
  Abort
  notRunning:
!macroend

Function .onInit
  !insertmacro RefuseWhileRunning
FunctionEnd

Function un.onInit
  !insertmacro RefuseWhileRunning
FunctionEnd

Section "DeckHQ" SecApp
  SectionIn RO

  ; An older DeckHQ here is removed by its own uninstaller first, silently, so
  ; a file this version no longer ships does not stay behind unlisted. Silent
  ; means it keeps the user's data and the window's own cache (see below).
  IfFileExists "$INSTDIR\Uninstall.exe" 0 fresh
    ExecWait '"$INSTDIR\Uninstall.exe" /S _?=$INSTDIR'
  fresh:

  !include "${BUILD_DIR}\install-files.nsh"

  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\DeckHQ.lnk" "$INSTDIR\DeckHQ.exe"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\DeckHQ.exe,0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "${HOMEPAGE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"
SectionEnd

; Asked, on the components page. Ticked to begin with; untick it and no
; Desktop icon is written.
Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\DeckHQ.lnk" "$INSTDIR\DeckHQ.exe"
SectionEnd

Section "Uninstall"
  ; What the installer wrote, file by file, then each folder if it is empty.
  !include "${BUILD_DIR}\uninstall-files.nsh"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\DeckHQ.lnk"
  Delete "$DESKTOP\DeckHQ.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"

  ; A silent run (an upgrade, or a package manager) stops here: the program is
  ; gone and everything DeckHQ wrote while it ran is exactly where it was.
  IfSilent done

  ; The window's own cache: the WebView2 profile, the remembered window size
  ; and the shell's log. Written by DeckHQ.exe, nothing the user made.
  RMDir /r "$LOCALAPPDATA\DeckHQ"

  ; The user's data: every acknowledgement, name and setting, and the ledger.
  ; Kept unless they say otherwise; the default button is No.
  IfFileExists "$PROFILE\.deckhq\*.*" 0 done
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "DeckHQ has been removed.$\r$\n$\r$\nYour DeckHQ data is still in $PROFILE\.deckhq: what you acknowledged, the names you gave, your settings and the ledger. Delete it as well?$\r$\n$\r$\nChoose No to keep it for the next time you install DeckHQ." \
    /SD IDNO IDNO done
  RMDir /r "$PROFILE\.deckhq"
  done:
SectionEnd
