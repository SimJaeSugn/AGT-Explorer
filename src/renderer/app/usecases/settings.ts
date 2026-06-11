/**
 * settings 유스케이스 (P5, features E6 / F장) — 설정 로드·영속·즉시 반영.
 *
 * - loadSettings(): 부팅 시 settings:get → uiSlice 반영 + 테마 적용.
 * - 각 set* 액션: 슬라이스 즉시 반영(낙관적) → settings:set 으로 영속.
 *   숨김 토글은 모든 패널 재스캔(refreshAll), 테마는 applyTheme 로 즉시 적용,
 *   확장자/시작위치/최근개수는 표기·후속에 자동 반영.
 * - 텔레메트리 옵트인은 별도 채널(telemetry:set-opt-in).
 *
 * app → infra/api 직접 호출(.eslintrc 허용). 영속 실패는 토스트 안내(비차단).
 */
import type { ThemeMode } from '@shared/dto'
import { settingsApi, telemetryApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { applyTheme, resolveTheme, systemPrefersDark } from '@renderer/ui/theme/applyTheme'

/** 부팅 시 1회: 저장된 설정을 로드해 슬라이스·테마에 반영. */
export async function loadSettings(): Promise<void> {
  const res = await settingsApi.get()
  if (res.ok) {
    // 텔레메트리 옵트인은 SettingsSnapshot 와 분리 채널(telemetry:get-opt-in)로
    // 디스크 실제 값을 조회해 부팅 재수화한다(R-D1 수정 — 기존엔 슬라이스 기본
    // false 를 넘겨 telemetry.json 저장값을 무시했음). 조회 실패 시 기존 폴백.
    const optInRes = await telemetryApi.getOptIn()
    const telemetry = optInRes.ok ? optInRes.value.optIn : store.getState().telemetryOptIn
    store.getState().applySettings(res.value, telemetry)
    applyTheme(res.value.theme)
  } else {
    // 손상/미연결: 기본값 + 시스템 테마로 안전 적용(크래시 프리).
    applyTheme(store.getState().theme)
  }
}

/** 테마 변경: 즉시 적용 + 영속. */
export async function changeTheme(theme: ThemeMode): Promise<void> {
  store.getState().setTheme(theme)
  applyTheme(theme)
  await persist({ theme })
}

/**
 * theme.toggle(H-1): 현재 화면에 보이는 실제 테마(resolved) 기준 light↔dark
 * 2-state 토글. system 상태에서 토글하면 현재 resolved 의 반대 명시값으로 고정된다
 * (system 진입 안 함). 즉시 적용·영속은 changeTheme 에 위임(중복 로직 0).
 */
export async function toggleThemeMode(): Promise<void> {
  const cur = store.getState().theme
  const resolved = resolveTheme(cur, systemPrefersDark())
  await changeTheme(resolved === 'dark' ? 'light' : 'dark')
}

/** 숨김 파일 표시 토글: 슬라이스 반영 → 모든 패널 재스캔 → 영속. */
export async function changeShowHidden(v: boolean): Promise<void> {
  store.getState().setShowHidden(v)
  store.getState().refreshAll()
  await persist({ showHidden: v })
}

/** 확장자 표시 토글: 즉시 표기 반영 + 영속. */
export async function changeShowExtensions(v: boolean): Promise<void> {
  store.getState().setShowExtensions(v)
  await persist({ showExtensions: v })
}

/** 기본 시작 위치 변경: 영속(다음 새 탭/재시작에 반영). */
export async function changeStartLocation(path: string): Promise<void> {
  store.getState().setStartLocation(path)
  await persist({ startLocation: path })
}

/** 최근 목록 개수 변경: 슬라이스 반영 + 기존 최근 목록 즉시 잘림 + 영속. */
export async function changeRecentLimit(n: number): Promise<void> {
  store.getState().setRecentLimit(n)
  // 새 한도로 즉시 잘라 적용.
  const limit = store.getState().recentLimit
  const recent = store.getState().recent
  store.getState().hydrateSidebar({
    favorites: store.getState().favorites,
    recent: recent.slice(0, limit),
    width: store.getState().sidebarWidth,
    collapsed: store.getState().sidebarCollapsed
  })
  await persist({ recentLimit: limit })
}

/** 시작 시 대시보드 표시 토글: 슬라이스 반영 + 영속(I장 §4.4·§5). */
export async function changeShowDashboardOnStartup(v: boolean): Promise<void> {
  store.getState().setShowDashboardOnStartup(v)
  await persist({ showDashboardOnStartup: v })
}

/** 복사 후 체크섬 검증 토글: 슬라이스 반영 + 영속(§R4·US-17.4, 기본 off). */
export async function changeVerifyOnCopy(v: boolean): Promise<void> {
  store.getState().setVerifyOnCopy(v)
  await persist({ verifyOnCopy: v })
}

/**
 * 단축아이콘 표시/숨김 토글: 슬라이스 반영 + 영속(settings:set). 숨김 집합에
 * 있으면 제거(표시), 없으면 추가(숨김). 신규 채널 0(settings:set 재사용).
 */
export async function toggleIconBarItem(commandId: string): Promise<void> {
  const cur = store.getState().iconBarHidden
  const next = cur.includes(commandId)
    ? cur.filter((id) => id !== commandId)
    : [...cur, commandId]
  store.getState().setIconBarHidden(next)
  await persist({ iconBarHidden: next })
}

/** 아이콘바 표시 순서 변경(드래그 재배열 결과): 슬라이스 반영 + 영속. */
export async function reorderIconBar(order: readonly string[]): Promise<void> {
  store.getState().setIconBarOrder([...order])
  await persist({ iconBarOrder: [...order] })
}

/** 단축아이콘 설정 초기화: 숨김·순서 모두 기본(전부 표시·정의 순서)으로 되돌리고 영속. */
export async function resetIconBar(): Promise<void> {
  store.getState().setIconBarHidden([])
  store.getState().setIconBarOrder([])
  await persist({ iconBarHidden: [], iconBarOrder: [] })
}

/** 텔레메트리 옵트인 변경: 별도 채널로 영속(기본 false, D5). */
export async function changeTelemetryOptIn(v: boolean): Promise<void> {
  store.getState().setTelemetryOptIn(v)
  const res = await telemetryApi.setOptIn(v)
  if (!res.ok) {
    store.getState().pushToast('error', '텔레메트리 설정 저장에 실패했습니다.')
  }
}

/** settings:set 부분 패치 영속(실패는 토스트). */
async function persist(patch: Parameters<typeof settingsApi.set>[0]): Promise<void> {
  const res = await settingsApi.set(patch)
  if (!res.ok) {
    store.getState().pushToast('error', '설정 저장에 실패했습니다.')
  }
}
