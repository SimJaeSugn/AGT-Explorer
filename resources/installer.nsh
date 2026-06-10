; AGT-Finder — Windows 탐색기 컨텍스트 메뉴 "AGT-Finder로 열기" 등록 (V2)
;
; perMachine:false(사용자 단위 설치)이므로 HKCU\Software\Classes 에 등록한다(관리자 권한 불요).
; 설치 시 customInstall, 제거 시 customUnInstall 매크로를 electron-builder NSIS 가 호출한다.
;
; 등록 대상 4종:
;   Directory             — 폴더 우클릭            → "%1"(폴더 경로)
;   Directory\Background   — 폴더 빈 공간 우클릭     → "%V"(현재 폴더, %1 불가)
;   Drive                  — 드라이브 우클릭        → "%1"(드라이브 루트)
;   *                      — 파일 우클릭            → "%1"(파일 경로, 앱이 상위 폴더를 엶)
;
; command 는 셸 문자열 합성 없이 검증된 exe + 인자 토큰만 등록한다. 실행된 앱은
; argv 의 경로를 normalizePath(상위이탈 차단)로 재검증한 뒤 새 탭으로 연다(ADR-005 정합).

!macro AGTRegisterMenu ROOT ARG
  WriteRegStr HKCU "Software\Classes\${ROOT}\shell\AGTFinder" "" "AGT-Finder로 열기"
  WriteRegStr HKCU "Software\Classes\${ROOT}\shell\AGTFinder" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\${ROOT}\shell\AGTFinder\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "${ARG}"'
!macroend

!macro AGTUnregisterMenu ROOT
  DeleteRegKey HKCU "Software\Classes\${ROOT}\shell\AGTFinder"
!macroend

!macro customInstall
  !insertmacro AGTRegisterMenu "Directory" "%1"
  !insertmacro AGTRegisterMenu "Directory\Background" "%V"
  !insertmacro AGTRegisterMenu "Drive" "%1"
  !insertmacro AGTRegisterMenu "*" "%1"
!macroend

!macro customUnInstall
  !insertmacro AGTUnregisterMenu "Directory"
  !insertmacro AGTUnregisterMenu "Directory\Background"
  !insertmacro AGTUnregisterMenu "Drive"
  !insertmacro AGTUnregisterMenu "*"
!macroend
