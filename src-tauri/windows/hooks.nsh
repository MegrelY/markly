; Markly installer hooks: register as an "Open with" handler for Markdown files
; without forcibly taking over an existing default app.
;  - ProgID Markly.md + OpenWithProgids entries  -> Markly appears in "Open with"
;  - Applications\Markly.exe + SupportedTypes     -> listed in the Open-with picker
;  - Capabilities + RegisteredApplications        -> selectable in Settings > Default apps
;  - .md / .markdown default is set ONLY if no handler is registered at all.

!define MK_PROGID "Markly.md"
!define MK_CAPS "Software\Markly\Capabilities"

!macro MK_ADD_EXT EXT
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${MK_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" "${EXT}" ""
  WriteRegStr SHCTX "${MK_CAPS}\FileAssociations" "${EXT}" "${MK_PROGID}"
  ClearErrors
  ReadRegStr $R0 HKCR "${EXT}" ""
  ${If} $R0 == ""
    WriteRegStr SHCTX "Software\Classes\${EXT}" "" "${MK_PROGID}"
  ${EndIf}
  ReadRegStr $R0 HKCR "${EXT}" "PerceivedType"
  ${If} $R0 == ""
    WriteRegStr SHCTX "Software\Classes\${EXT}" "PerceivedType" "text"
  ${EndIf}
!macroend

!macro MK_DEL_EXT EXT
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${MK_PROGID}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\${EXT}\OpenWithProgids"
  ReadRegStr $R0 SHCTX "Software\Classes\${EXT}" ""
  ${If} $R0 == "${MK_PROGID}"
    DeleteRegValue SHCTX "Software\Classes\${EXT}" ""
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; ProgID
  WriteRegStr SHCTX "Software\Classes\${MK_PROGID}" "" "Markdown Document"
  WriteRegStr SHCTX "Software\Classes\${MK_PROGID}" "FriendlyTypeName" "Markdown Document"
  WriteRegStr SHCTX "Software\Classes\${MK_PROGID}\DefaultIcon" "" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\${MK_PROGID}\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\${MK_PROGID}\shell\open" "FriendlyAppName" "Markly"
  WriteRegStr SHCTX "Software\Classes\${MK_PROGID}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  ; Application registration (Open with list)
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "Markly"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  ; Default Programs capabilities
  WriteRegStr SHCTX "${MK_CAPS}" "ApplicationName" "Markly"
  WriteRegStr SHCTX "${MK_CAPS}" "ApplicationDescription" "A lightweight, beautiful Markdown viewer"
  WriteRegStr SHCTX "${MK_CAPS}" "ApplicationIcon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\RegisteredApplications" "Markly" "${MK_CAPS}"

  !insertmacro MK_ADD_EXT ".md"
  !insertmacro MK_ADD_EXT ".markdown"
  !insertmacro MK_ADD_EXT ".mdown"
  !insertmacro MK_ADD_EXT ".mkd"

  ; Tell Explorer that associations changed (SHCNE_ASSOCCHANGED)
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro MK_DEL_EXT ".md"
  !insertmacro MK_DEL_EXT ".markdown"
  !insertmacro MK_DEL_EXT ".mdown"
  !insertmacro MK_DEL_EXT ".mkd"
  DeleteRegKey SHCTX "Software\Classes\${MK_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Markly"
  DeleteRegKey SHCTX "${MK_CAPS}"
  DeleteRegKey /ifempty SHCTX "Software\Markly"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
