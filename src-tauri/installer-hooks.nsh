!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\Directory\shell\OpenInScribeDog" "" "Open with ScribeDog"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\OpenInScribeDog" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\OpenInScribeDog\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\OpenInScribeDog"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\OpenInScribeDog"
!macroend
