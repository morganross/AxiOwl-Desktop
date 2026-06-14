!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\Open in AxiOwl"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Open in AxiOwl"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Open in AxiOwl"
!macroend
