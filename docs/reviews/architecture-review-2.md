# 아키텍처 설계 독립 재검증 보고서 (2차) — Explorer

> 검증자: 독립 Reviewer(제3자) · 2026-06-06 · 회차: 2 (1차 FAIL 항목 재검증)
> 대상: system-architecture.md · software-architecture.md · directory-structure.md · ADR-000~006 · traceability.md
> 기준: 1차 보고서([architecture-review.md](./architecture-review.md)) High 2 / Med 5 / Low 2 반영 여부 대조

---

## 판정: **PASS**

1차에서 지적한 High 2건(R1·R7) + Med 4건(R2·R4·R5·R8) + Low 2건(R3·R6) **전 항목이 실제로 반영**되었다. 핵심 결함이던 (1) 생성/이름변경 IPC 계약 누락(유령 매핑)과 (2) 추적성 표의 D-코드 의미 충돌이 모두 해소되었고, 수정 과정에서 채널명·commandId·도메인 용어·디렉토리명의 **새 모순은 발견되지 않았다**. 설계는 1차 구현(M1 단일 패널) 착수 가능한 완결성을 갖췄다.

---

## 1차 반영 항목 처리 확인 표

| 항목 | 등급 | 처리 | 근거 (위치 / 확인 내용) |
|---|---|---|---|
| **R1** 생성/이름변경 IPC 계약 누락 (유령 매핑) | High | **처리됨** | SA §3.2에 신설 그룹 "파일 기본조작 — 단발"(라인 90~109) 추가. `fs:mkdir(parentDir,name)→Result<FileEntryDTO,FileOpError>`, `fs:create-file(parentDir,name,template?)`, `fs:rename(path,newName)` 정식 정의. 요청/응답 타입·오류처리(`EEXIST`/`EINVAL`/`EACCES`/`ENOENT` FileOpError 1급 전파, throw 아님)·처리 프로세스(Main `fs.handlers.ts`→`FileSystemService`) 모두 명시. traceability 라인 24 IPC 칸이 `op:trash/op:delete` 유령 매핑에서 **`fs:mkdir, fs:create-file, fs:rename`**으로 정정. DS 라인 44 `fs.handlers.ts` 주석에도 "생성 fs:mkdir/fs:create-file·이름변경 fs:rename" 반영. 단축키 표(traceability 라인 66) `F2`/`Ctrl+Shift+N`→`fs:rename/fs:mkdir/fs:create-file` 연결. |
| **R7** 추적성 표 D-코드 의미 충돌 | High | **처리됨** | traceability 라인 11~15에 범례 신설: `feat-Xn`=features 영역코드, `결정-Dn`=PRD 11장 결정기록, 접두어 강제 명시. 표 내 정정 확인 — 검색 `feat-D1`(라인 32), 필터 `feat-D2`(라인 33), 미리보기 `feat-D3`(라인 34), 충돌 `feat-D4`(라인 28) / 세션·워크스페이스 `결정-D3`(라인 41·43), 단축키충돌 `결정-D4`(라인 72), 보안 `결정-D5`(라인 47). 동일 코드의 두 의미 혼용 제거. SW 라인 270은 `(PRD D4)`로 결정코드임을 명기. SA 본문의 `D5`(라인 18·161·175·265)·`결정-D3`(라인 222)·`feat-D4`(라인 212)도 충돌 없는 단일 의미로 통일. |
| **R2** B6(실행/열기)·E6(설정) 추적성 행 누락 | Med | **처리됨** | traceability 라인 26 "파일 실행/열기 (B6 Must)" 행 신설(FileListView 더블클릭/Enter/컨텍스트메뉴 / open usecase / `shell:open, shell:open-with(S), shell:show-properties` / ADR-005). 라인 39 "설정 (feat-E6)" 행 신설(설정화면·uiSlice / settings usecase / `settings:get/set`). 라인 38 테마 행과 설정 행 경계 분리. |
| **R4** shell:open 경로 검증 규칙 누락 | Med | **처리됨** | SA §3.3-4(라인 169~173) "쉘 실행 계열 별도 방어" 신설: 정규화+존재·권한 확인 후 위임, 명령행 조립(인자 주입) 금지, `shell.openPath`/`openExternal`에 검증된 단일 경로만, `openExternal` 프로토콜 화이트리스트(`http`/`https`/`mailto`만, `file:`/커스텀 스킴 차단), spawn 금지. ADR-005 결정 라인 34에도 동일 규칙 요약 + SA §3.3-4 역참조(참조 번호 일치 확인). |
| **R5** 검색 200ms × 1만개 폴백 부재 | Med | **처리됨** | SW §6.3 라인 245~250에 "200ms 미충족 시 폴백(결정 가능한 단계적 대응)" 신설: ①가시영역 우선 동기 필터→전체 비동기 ②디바운스 ~80ms ③경량 Web Worker 오프로드(측정 미달 시만). ①②는 MVP 포함, ③은 조건부. SW §10-1·미해결과 연결, M1 성능 스파이크에 "1만 개 목록 입력 후 200ms 내 가시 결과" 측정 명시 항목화(SW 라인 324). traceability 비기능표 라인 83에도 폴백·측정 반영. |
| **R8** focusNext/focusDir commandId 불일치 | Med | **처리됨** | SW §7.2 표에 `Ctrl+←/→ → panel.focusDir(dir)` 행 추가(라인 279) + 구분 주석(라인 274: Tab=순환, Ctrl+←/→=방향, grid-4에서 별개). traceability 단축키표 라인 57·58에 `panel.focusNext(순환)`/`panel.focusDir(dir)(방향)` 분리 명시, 라인 73에 "SW §7.2와 통일" 주석. 명칭·commandId 문서 간 일치 확인. |
| **R3** Immer 적용 슬라이스 기준 부재 | Low | **처리됨** | ADR-002 트레이드오프 라인 31~34에 적용 기준 명시: 적용=`tabsSlice`/`panelsSlice`/`sidebarSlice`/`uiSlice`(중첩), 제외=`selectionSlice`(Set 직접 조작)/`operationsSlice`(progress 필드만 교체). 판단 규칙 한 줄("중첩 깊은 갱신=Immer, 평탄·초고빈도=수동 set"). SW §5.2 표 라인 202·203이 selection/operations를 "제외(수동 set)"로 표기하고 라인 207에 기준 1줄. ADR↔SW 일관. |
| **R6** closedHistory 엔티티 배치 모순 | Low | **처리됨** | SW §2.1 라인 22~25 `closedHistory`를 **Window 엔티티**로 이동("닫은 탭 복원 스택 — 창 단위·휘발"). SA §5.1 SessionSnapshot 라인 238·244에 "창 수준 휘발 상태 → 직렬화/복원 대상 아님" 명시. SW §5.2 라인 200·207은 `tabsSlice`(windows 보유)에 두되 세션 직렬화 제외로 정리. 엔티티 배치(Window)와 주석(창 수준) 상충 해소. |

---

## 새 모순 점검 (수정 부작용)

수정으로 인한 신규 불일치를 교차 검색(IPC 채널명·commandId·도메인 용어·디렉토리명)한 결과 **모순 없음**.

- **IPC 채널명**: `fs:mkdir`/`fs:create-file`/`fs:rename`가 SA §3.2·traceability(라인 24·66·98)·DS(라인 44) 전부 동일 표기. (1차 보고서 R1 권고의 `fs:create`가 아니라 `fs:create-file`로 통일 — 더 명확하며 문서 간 일관됨.)
- **commandId**: `panel.focusNext`/`panel.focusDir`가 SW·traceability 양쪽 동일. `file.rename`/`file.newFolder`→채널 매핑도 일치.
- **D-코드**: traceability 범례 도입 후 `feat-Dn`/`결정-Dn` 네임스페이스가 표 전체에서 일관. SA 본문 `D5`는 전부 결정-D5(보안) 단일 의미로만 등장해 충돌 없음.
- **디렉토리명**: DS 핸들러 분리(`fs/op/shell/session`.handlers)가 SA 채널 네임스페이스 그룹과 정합.
- **참조 무결성**: ADR-005 라인 34의 `§3.3-4` 역참조가 SA §3.3의 4번 항목과 정확히 대응.

---

## 남은 반영 항목

**없음.** 1차 지적 9건(High 2 / Med 5 / Low 2 — 단, Med는 R2·R4·R5·R8 4건 + 1차 본문 R2에 포함된 B6/E6 누락 통합) 전부 처리. 추가 발견 결함 없음.

---

## 확인 필요 (PM 참고, 차단 아님)

- **미해결 질문 3건**(SA §8 / SW §10)은 모두 의사결정 가능한 형태로 정리됨 — Worker 모델(M1 스파이크 후 확정), Undo 영속 범위(Should 착수 시), 썸네일 위치(Should 착수 시). 1차 구현을 막지 않음.
- **R5 연계**: M1 성능 스파이크 범위에 "1만 개 필터 200ms" 측정 항목이 명시적으로 포함됨(SW §10-1). Web Worker 폴백(③) 도입 시점은 측정 결과에 달려 있으므로 M1 종료 시 PM이 결과를 확인해 ③ 도입 여부를 확정하면 된다. 설계 차단 사유는 아님.

---

## 종합

설계의 골격(프로세스/보안·IPC 계약·성능·계층 분리)은 1차에서 이미 견고했고, 이번 수정으로 **구조적 결함(생성/이름변경 미정의·추적성 D-코드 충돌)이 메워져 추적성이 무결**해졌다. 1차 구현 착수 가능. **PASS**.
