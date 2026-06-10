/**
 * infra/icon — OS 파일 아이콘 키 단위 캐시 + in-flight 디듀프 (H6, 계획서 §3.4).
 *
 * store 밖 전역 모듈(패널 슬라이스 미오염, SA §5.2 셀렉터 격리). 행 컴포넌트는
 * app/usecases/icons 를 경유해(ui→infra 직접 import 금지) 이 모듈을 구독한다.
 *
 * 캐시 키(iconKeyFor)는 backend cacheKeyFor 와 동일 규칙으로 환원한다:
 *   - 폴더 → '__dir__', 드라이브 루트 → '__drive__'
 *   - per-file 고유 아이콘 확장자(exe/lnk/ico/cur/ani/msc/scr) → 'path:<path>'
 *   - 그 외 일반 파일 → 'ext:<소문자 확장자>'
 * 같은 키는 IPC 1회만(가상 스크롤 1만개에서 같은 확장자는 1회). 실패는 캐시 안 함.
 *
 * Map 상한 불요: 키가 확장자/두 합성키로 환원되므로 엔트리는 세션 등장 확장자
 * 종류 수(수십~수백)로 자연 상한. per-file(path:<path>)만 항목당이나 소수.
 * main 프로세스 상한은 backend LRU(512)가 담당.
 */
import type { FileEntryDTO } from '@shared/dto'
import type { ShellIconReq } from '@shared/ipc/contracts'
import { isDriveRoot } from '@renderer/domain/paths'
import { shellApi } from '@renderer/infra/api'

/** per-file 고유 아이콘 확장자(소문자, 선행 '.' 제외) — backend PER_FILE_EXT 와 동일. */
const PER_FILE_EXT = new Set(['exe', 'lnk', 'ico', 'cur', 'ani', 'msc', 'scr'])

/** 성공 dataUrl 캐시(key → dataUrl). 실패는 저장하지 않는다. */
const cache = new Map<string, string>()
/** in-flight Promise(key → Promise) — 동일 키 동시요청 디듀프. */
const inflight = new Map<string, Promise<void>>()
/** 캐시 변경 구독자(useSyncExternalStore). */
const subscribers = new Set<() => void>()

function notify(): void {
  for (const cb of subscribers) cb()
}

/**
 * 항목의 캐시 키 환원(backend cacheKeyFor 와 동일 규칙).
 * 폴더='__dir__', 드라이브 루트='__drive__', per-file='path:<path>', 그 외='ext:<ext>'.
 */
export function iconKeyFor(entry: FileEntryDTO): string {
  if (entry.isDir) {
    return isDriveRoot(entry.path) ? '__drive__' : '__dir__'
  }
  const ext = entry.ext.toLowerCase()
  if (PER_FILE_EXT.has(ext)) return `path:${entry.path}`
  return `ext:${ext}`
}

/**
 * 링크(정션/심볼릭) 폴더 여부 — 드라이브 루트 제외. 링크 폴더는 **표준 폴더 아이콘 위에
 * 바로가기 화살표를 덧그려** 표시한다(경로별 OS 아이콘은 정션 환경에서 디스크/엉뚱한
 * 아이콘을 줘 들쭉날쭉했음 → 공유 '__dir__' 표준 폴더 아이콘 + 화살표 오버레이로 통일).
 */
export function isLinkFolder(entry: FileEntryDTO): boolean {
  return entry.isDir && entry.attrs.symlink && !isDriveRoot(entry.path)
}

/** 드라이브 루트 폴더 여부(내 PC 의 드라이브 항목) — 디스크 아이콘 대상. */
export function isDriveFolder(entry: FileEntryDTO): boolean {
  return entry.isDir && isDriveRoot(entry.path)
}

/**
 * shell:icon 요청 빌더 — 항상 실존 경로를 담는다(키 분기와 짝, §3.1).
 * 폴더 { path, ext:'__dir__' }, 드라이브 { path, ext:'__drive__' }, 그 외 { path }.
 */
export function iconRequestFor(entry: FileEntryDTO): ShellIconReq {
  if (entry.isDir) {
    return isDriveRoot(entry.path)
      ? { path: entry.path, ext: '__drive__' }
      : { path: entry.path, ext: '__dir__' }
  }
  return { path: entry.path }
}

/** 캐시된 dataUrl 조회(없으면 undefined). */
export function getCachedIcon(key: string): string | undefined {
  return cache.get(key)
}

/**
 * 아이콘 로드 트리거. 이미 캐시되었거나 in-flight 면 기존 Promise 를 공유(디듀프).
 * 성공 시 캐시 후 구독자 통지. 실패(빈 dataUrl·에러)는 캐시하지 않음 →
 * 같은 키의 다음 가시 항목 경로로 재시도 가능(영구 폴백 방지).
 */
export function requestIcon(entry: FileEntryDTO): Promise<void> {
  // 링크 폴더는 자기(정션) 경로로 공유 '__dir__' 아이콘을 오염시키지 않도록 요청하지 않는다.
  // 표준 폴더 아이콘은 일반 폴더가 채우고, 링크는 그 위에 화살표 오버레이로 표시(OSIcon).
  if (isLinkFolder(entry)) return Promise.resolve()
  const key = iconKeyFor(entry)
  if (cache.has(key)) return Promise.resolve()
  const existing = inflight.get(key)
  if (existing) return existing

  const p = (async (): Promise<void> => {
    try {
      const res = await shellApi.icon(iconRequestFor(entry))
      if (res.ok && res.value.dataUrl) {
        cache.set(key, res.value.dataUrl)
        notify()
      }
      // 실패·빈 dataUrl 은 캐시하지 않음(폴백 유지, 다음 경로로 재시도).
    } catch {
      // 무음 — 폴백 아이콘 유지(토스트 폭주 방지).
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, p)
  return p
}

/** 캐시 변경 구독(useSyncExternalStore용). 해제 함수 반환. */
export function subscribeIcon(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}
