/**
 * watchBridge 유스케이스 (J2) — 좌/우 패널 현재 디렉토리 실시간 감시 브리지.
 *
 * App 부팅 시 `subscribeWatchStream` 으로 fs:watch:event/error 를 1회 전역 구독한다.
 * 각 패널이 보는 **현재 디렉토리 1개**를 감시(non-recursive, backend)하며, 패널 경로가
 * 바뀌면 이전 watchId 를 watchStop 하고 새 경로를 watchStart 한다. onEvent(watchId→패널)
 * 수신 시 해당 패널을 softRefresh(보존 재-list — 디바운스는 backend 가 처리). onError 는
 * 해당 매핑을 해제하고 무음 격리(수동 새로고침 Ctrl+R 유지).
 *
 * J2: softRefresh 는 경로 동일 재-list 라 정렬/필터에 더해 선택/스크롤도 보존한다
 * (사라진 항목만 선택 해제·scrollTop 1회 클램프 복원). 네트워크 폴백은 backend 가
 * 동일 fs:watch:event 로 투명 처리(프론트 무변경).
 *
 * app → infra/api 직접 호출(.eslintrc 허용). operationsBridge 패턴 동형.
 */
import { fsApi, subscribeWatchStream } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { isMyPc } from '@renderer/domain/paths'

/** 패널별 감시 상태(현재 경로·watchId). */
interface PanelWatch {
  path: string
  /** watchStart 응답 전이면 null(in-flight). */
  watchId: string | null
  /** start 가 in-flight 인 동안 경로가 또 바뀌었으면 응답을 폐기하기 위한 seq. */
  seq: number
}

let initialized = false

export function initWatchBridge(): void {
  if (initialized) return
  initialized = true

  // panelId → 감시 상태.
  const watches = new Map<string, PanelWatch>()
  // watchId → panelId(이벤트 라우팅).
  const watchIdToPanel = new Map<string, string>()
  let seqCounter = 0

  /** 패널의 감시를 중지(watchId 발급된 경우 stop). */
  function stopWatch(panelId: string): void {
    const w = watches.get(panelId)
    if (!w) return
    if (w.watchId) {
      watchIdToPanel.delete(w.watchId)
      void fsApi.watchStop(w.watchId)
    }
    // in-flight start 는 seq 무효화로 응답 폐기(아래 then 가드).
    w.seq = -1
    watches.delete(panelId)
  }

  /** 패널이 새 경로를 감시하도록 갱신(이전 watch stop + 새 watch start). */
  function startWatch(panelId: string, path: string): void {
    stopWatch(panelId)
    // "내 PC"(빈 경로) 또는 드라이브 목록 가상 경로는 감시 대상 아님.
    if (path === '' || isMyPc(path)) return
    const seq = ++seqCounter
    const w: PanelWatch = { path, watchId: null, seq }
    watches.set(panelId, w)
    void fsApi
      .watchStart({ path })
      .then((res) => {
        const cur = watches.get(panelId)
        // 응답 도착 전 경로가 또 바뀌었으면(다른 seq) 이 watch 는 폐기 + 즉시 stop.
        if (!cur || cur.seq !== seq) {
          if (res.ok) void fsApi.watchStop(res.value.watchId)
          return
        }
        if (res.ok) {
          cur.watchId = res.value.watchId
          watchIdToPanel.set(res.value.watchId, panelId)
        } else {
          // start 실패 → 격리(수동 새로고침 유지). 매핑 해제.
          watches.delete(panelId)
        }
      })
      .catch(() => {
        const cur = watches.get(panelId)
        if (cur && cur.seq === seq) watches.delete(panelId)
      })
  }

  // ── 전역 스트림 구독(watchId 상관 소비측) ──────────────────────────────
  subscribeWatchStream({
    onEvent: (evt) => {
      const panelId = watchIdToPanel.get(evt.watchId)
      if (!panelId) return
      const st = store.getState()
      // 패널이 아직 그 경로를 보고 있을 때만 refresh(경로가 바뀌었으면 무시).
      const w = watches.get(panelId)
      if (!w || w.path !== evt.path) return
      // 워처발 갱신은 선택/스크롤 보존(softRefresh). 경로 동일 재-list.
      st.softRefresh(panelId)
    },
    onError: (evt) => {
      // 권한/네트워크/미지원 → 해당 watch 해제, 무음 격리(수동 새로고침 유지).
      const panelId = watchIdToPanel.get(evt.watchId)
      watchIdToPanel.delete(evt.watchId)
      if (panelId) watches.delete(panelId)
    }
  })

  // ── 패널 경로 변화 추적(store 구독) ────────────────────────────────────
  // 좌/우(및 grid-4) 모든 패널의 현재 path 를 비교해 변경된 패널만 watch 갱신.
  function syncWatches(): void {
    const panels = store.getState().panels
    const liveIds = new Set(Object.keys(panels))
    // 사라진 패널 정리.
    for (const id of [...watches.keys()]) {
      if (!liveIds.has(id)) stopWatch(id)
    }
    // 경로 변경/신규 패널 watch 갱신.
    for (const [id, p] of Object.entries(panels)) {
      const w = watches.get(id)
      if (!w || w.path !== p.path) startWatch(id, p.path)
    }
  }

  // 부팅 직후 1회 동기화 + 이후 변경 구독.
  syncWatches()
  store.subscribe(syncWatches)
}
