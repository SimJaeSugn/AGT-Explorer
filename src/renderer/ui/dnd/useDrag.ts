/**
 * useDrag — 패널 간 D&D 포인터 제어 훅 (US-1.3, SA §8).
 *
 * - useDragSource: 파일 행에서 드래그를 시작한다(선택 항목 묶음).
 * - useDropTarget: 패널 빈영역/폴더 항목을 드롭 대상으로 등록한다.
 * - DragController(window 리스너): 드래그 중 pointermove/up·keydown/up 으로
 *   커서·수정키(Ctrl/Shift)를 실시간 추적해 의도(복사/이동)를 즉시 갱신한다.
 *
 * 의도 판정은 domain(decideDrop), 실행은 app(performDrop)에 위임한다.
 * ui → app/domain 경유(.eslintrc: ui 는 infra 직접 import 금지).
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { decideDrop, type DragModifiers } from '@renderer/domain/rules/dragIntent'
import { performDrop } from '@renderer/app/usecases/fileOps'
import { startExternalDrag } from '@renderer/app/usecases/externalDrag'
import { locationKindOf } from '@renderer/domain/rules/remoteLocation'
import { baseName } from '@renderer/domain/paths'
import {
  beginDrag,
  endDrag,
  getDragState,
  setDragState,
  subscribeDrag,
  type DragState,
  type DropTarget
} from './dragState'

/** 드래그 시작 임계 이동량(px) — 클릭과 구분. */
const DRAG_THRESHOLD = 5

/**
 * 커스텀 HTML5 드래그 고스트 생성 — native 기본 행 스냅샷 대신 사용.
 * 다중 선택이면 **2줄 카드**("N개 항목" + "대표명 외 M개")에 뒤로 겹친 카드 2장을 더해
 * "여러 장 쌓인" 느낌을 준다. 단일이면 한 줄("📄 이름"). 화면 밖(off-screen)에 잠깐 붙였다가
 * setDragImage 동기 스냅샷 직후 제거한다. 반환 요소는 호출부가 setTimeout 으로 제거.
 */
function buildDragGhost(sources: string[]): HTMLElement {
  const count = sources.length
  const multi = count > 1
  const rep = sources[0] ? baseName(sources[0]) : ''
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:fixed;top:-1000px;left:-1000px;pointer-events:none;'

  const cardCss =
    'border-radius:6px;background:#475569;box-shadow:0 4px 14px rgba(0,0,0,.28);'
  if (multi) {
    const b1 = document.createElement('div')
    b1.style.cssText = cardCss + 'position:absolute;left:6px;top:8px;right:-6px;bottom:-8px;opacity:.35;'
    const b2 = document.createElement('div')
    b2.style.cssText = cardCss + 'position:absolute;left:3px;top:4px;right:-3px;bottom:-4px;opacity:.6;'
    wrap.appendChild(b1)
    wrap.appendChild(b2)
  }
  const card = document.createElement('div')
  card.style.cssText =
    cardCss +
    'position:relative;min-width:120px;max-width:260px;padding:5px 10px;color:#fff;font:12px/1.35 system-ui,sans-serif;'
  if (multi) {
    const l1 = document.createElement('div')
    l1.style.cssText = 'font-weight:600;white-space:nowrap;'
    l1.textContent = `🗐 ${count}개 항목`
    const l2 = document.createElement('div')
    l2.style.cssText = 'margin-top:2px;opacity:.92;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    l2.textContent = `${rep} 외 ${count - 1}개`
    card.appendChild(l1)
    card.appendChild(l2)
  } else {
    const l1 = document.createElement('div')
    l1.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    l1.textContent = `📄 ${rep}`
    card.appendChild(l1)
  }
  wrap.appendChild(card)
  return wrap
}

/** 전체 드래그 상태 구독(컴포넌트용). */
export function useDragState(): DragState {
  return useSyncExternalStore(subscribeDrag, getDragState, getDragState)
}

function modsFromEvent(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): DragModifiers {
  return { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }
}

/** 현재 target/mods 로 의도·허용 여부 재계산해 상태에 반영. */
function recompute(): void {
  const s = getDragState()
  if (!s.active) return
  if (!s.target) {
    setDragState({ intent: s.mods.ctrl ? 'copy' : s.mods.shift ? 'move' : 'move', allowed: false, hint: '' })
    return
  }
  const d = decideDrop(s.sources, s.sourceDir, s.target.destDir, s.mods)
  setDragState({ intent: d.intent, allowed: d.allowed, hint: d.message })
}

/**
 * 드래그 소스 훅 — 파일 행의 onPointerDown 에 연결.
 * @param getDragSources 드래그할 경로 묶음을 만드는 콜백(현재 선택 + 클릭 항목).
 */
export function useDragSource(
  panelId: string,
  sourceDir: string,
  getDragSources: () => string[]
): { onPointerDown: (e: React.PointerEvent) => void } {
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // 좌클릭만. 우클릭/보조키는 선택/컨텍스트 메뉴로.
      if (e.button !== 0) return
      const startX = e.clientX
      const startY = e.clientY
      let started = false

      function onMove(ev: PointerEvent): void {
        if (!started) {
          if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return
          const sources = getDragSources()
          if (sources.length === 0) {
            cleanup()
            return
          }
          started = true
          beginDrag(sources, panelId, sourceDir, modsFromEvent(ev), {
            x: ev.clientX,
            y: ev.clientY
          })
        } else {
          setDragState({ cursor: { x: ev.clientX, y: ev.clientY }, mods: modsFromEvent(ev) })
          recompute()
        }
      }

      function onUp(ev: PointerEvent): void {
        cleanup()
        if (!started) return
        const s = getDragState()
        const target = s.target
        if (target && s.allowed) {
          // 내부 패널 드롭(§A3) — 기존 경로 유지.
          void performDrop({
            sources: s.sources,
            sourcePanelId: s.sourcePanelId,
            sourceDir: s.sourceDir,
            destDir: target.destDir,
            mods: modsFromEvent(ev)
          })
        }
        // 외부(OS/타 앱)로의 드롭은 더 이상 pointerup 에서 시작하지 않는다(§M M1).
        // webContents.startDrag 는 native dragstart(버튼 눌린 상태)에서만 OS 드래그로
        // 인계되므로, 외부 드래그는 useExternalDragSource 의 onDragStart 가 담당한다.
        // pointerup 시점 호출은 항상 OS 드래그를 시작하지 못해(무동작) 제거함.
        endDrag()
      }

      function cleanup(): void {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [panelId, sourceDir, getDragSources]
  )

  return { onPointerDown }
}

/**
 * 외부 OS 드래그로 핸드오프할 대기 컨텍스트(모듈 전역). 드래그가 **창을 벗어날 때**만
 * useDragController 의 document dragleave 핸들러가 startExternalDrag 로 OS 드래그를
 * 시작한다. allLocal 이 아니면 null(원격은 외부 드롭 불가).
 */
let pendingExternal: { sources: string[]; anyFolder: boolean } | null = null
let externalHandedOff = false

/**
 * 드래그 소스 훅 — 파일 행에 native HTML5 draggable 로 연결.
 *
 * **내부 D&D(§A3): native HTML5 드래그를 그대로 진행**시킨다(preventDefault 안 함).
 * 그래야 앱 내부 드롭 타겟에서 dragover/drop 이 정상 발화해 onDrop(useHtml5DropTarget)이
 * **마우스를 놓는 즉시** performDrop 한다(클릭 불필요). dragState 컨텍스트(소스·출발
 * 패널/폴더)는 여기서 등록해 onDrop 이 읽는다.
 *
 * **외부(OS/타앱) 드롭(§M M1):** onDragStart 에서 webContents.startDrag 를 부르면(과거 방식)
 * OS 드래그가 포인터/HTML5 이벤트를 점유해 자기 창으로의 self-drop 이 전달되지 않아 내부
 * 드롭이 깨졌다(드롭해도 안 옮겨지고 클릭해야 옮겨짐). 그래서 OS 인계는 **커서가 창을 벗어날
 * 때**(dragleave) 로 지연한다(아래 pendingExternal + useDragController). 창 안에서 드롭하면
 * native onDrop 이, 창 밖으로 나가면 OS 드래그가 담당한다.
 *
 * @param getDragSources 드래그할 경로 묶음을 만드는 콜백(현재 선택 + 클릭 항목).
 */
export function useExternalDragSource(
  panelId: string,
  sourceDir: string,
  getDragSources: () => string[]
): {
  draggable: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
} {
  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      const sources = getDragSources()
      if (sources.length === 0) return
      // 드래그 컨텍스트 등록(onDrop 이 읽는다). native 드래그는 유지(preventDefault 안 함).
      beginDrag(sources, panelId, sourceDir, modsFromEvent(e), { x: e.clientX, y: e.clientY })
      try {
        // native 드래그가 유효하도록 데이터/효과 지정(없으면 Chromium 이 드래그를 취소할 수 있음).
        e.dataTransfer.effectAllowed = 'copyMove'
        e.dataTransfer.setData('text/plain', sources.join('\n'))
        // 커서를 따라다니는 native 고스트를 커스텀 2줄 이미지로 교체(다중 시 스택 카드).
        // 기본 행 스냅샷 대신 "N개 항목 / 대표명 외 M개"를 보여준다.
        const ghost = buildDragGhost(sources)
        document.body.appendChild(ghost)
        e.dataTransfer.setDragImage(ghost, 16, 12)
        // setDragImage 는 동기 스냅샷 — 다음 틱에 제거(잔여 DOM 누수 방지).
        setTimeout(() => ghost.remove(), 0)
      } catch {
        /* dataTransfer 접근 불가 환경 — 무시(내부 드롭은 dragState 로 동작). */
      }
      // 외부 드롭 대비: 모두 로컬이면 창 이탈 시 OS 드래그로 핸드오프(useDragController).
      const allLocal = sources.every((p) => locationKindOf(p) === 'local')
      pendingExternal = allLocal
        ? { sources: [...sources], anyFolder: sources.some((p) => !/\.[^\\/.]+$/.test(p)) }
        : null
      externalHandedOff = false
    },
    [panelId, sourceDir, getDragSources]
  )

  // 드래그 종료(native dragend) 시 상태 정리. 드롭이 onDrop 에서 처리됐으면 idempotent.
  const onDragEnd = useCallback(() => {
    pendingExternal = null
    externalHandedOff = false
    endDrag()
  }, [])

  return { draggable: true, onDragEnd, onDragStart }
}

/**
 * HTML5 드롭 대상 훅 — 패널 빈영역/폴더 항목에 연결(§A3 내부 D&D 즉시 드롭).
 *
 * §M M1 이후 행 드래그는 native HTML5 드래그(allLocal 은 webContents.startDrag 로 OS 인계)
 * 로 시작된다. OS 드래그가 포인터 이벤트를 점유하므로 기존 pointer 기반 드롭(pointerup)이
 * 발화하지 않아 "클릭해야 이동"·말풍선 잔존 문제가 있었다. 이를 해소하기 위해 드롭 타겟에서
 * HTML5 dragover/drop 을 직접 받아 **드롭 즉시** performDrop 한다(OS 드래그를 앱 내부로
 * 다시 드롭하면 dragover/drop 이 정상 발화한다).
 *
 * - onDragOver: preventDefault(드롭 허용) + dropEffect 표시 + 하이라이트용 target 갱신.
 * - onDrop: 컨텍스트(dragState)로 decideDrop → 허용 시 performDrop, 그리고 endDrag.
 * - onDragLeave: 이 대상이 현재 대상이면 해제(하이라이트 제거).
 * 중첩(폴더 행 ⊂ 패널 빈영역) 이중 처리 방지를 위해 stopPropagation 한다.
 */
export function useHtml5DropTarget(target: DropTarget): {
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
} {
  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      const s = getDragState()
      // 우리(앱 내부) 드래그가 아니면(외부 파일 등 sources 없음) 무시 → 기본 동작.
      if (s.sources.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      const mods = modsFromEvent(e)
      const d = decideDrop(s.sources, s.sourceDir, target.destDir, mods)
      e.dataTransfer.dropEffect = d.allowed ? (d.intent === 'copy' ? 'copy' : 'move') : 'none'
      if (
        s.target?.panelId !== target.panelId ||
        s.target?.overEntryPath !== target.overEntryPath ||
        s.allowed !== d.allowed
      ) {
        setDragState({ target, intent: d.intent, allowed: d.allowed, hint: d.message })
      }
    },
    [target]
  )

  const onDragLeave = useCallback(() => {
    const s = getDragState()
    if (
      s.target &&
      s.target.panelId === target.panelId &&
      s.target.overEntryPath === target.overEntryPath
    ) {
      setDragState({ target: null })
    }
  }, [target])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const s = getDragState()
      if (s.sources.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      const mods = modsFromEvent(e)
      const d = decideDrop(s.sources, s.sourceDir, target.destDir, mods)
      if (d.allowed) {
        void performDrop({
          sources: s.sources,
          sourcePanelId: s.sourcePanelId,
          sourceDir: s.sourceDir,
          destDir: target.destDir,
          mods
        })
      }
      endDrag()
    },
    [target]
  )

  return { onDragOver, onDragLeave, onDrop }
}

/**
 * 드롭 대상 훅 — 패널 빈영역/폴더 항목에 연결.
 * onPointerEnter 시 대상 등록, onPointerLeave 시 해제(이 대상이 현재 대상이면).
 */
export function useDropTarget(target: DropTarget): {
  onPointerEnter: () => void
  onPointerLeave: () => void
} {
  const onPointerEnter = useCallback(() => {
    if (!getDragState().active) return
    setDragState({ target })
    recompute()
  }, [target])

  const onPointerLeave = useCallback(() => {
    const s = getDragState()
    if (!s.active) return
    if (
      s.target &&
      s.target.panelId === target.panelId &&
      s.target.overEntryPath === target.overEntryPath
    ) {
      setDragState({ target: null })
      recompute()
    }
  }, [target])

  return { onPointerEnter, onPointerLeave }
}

/**
 * DragController — 드래그 중 수정키 실시간 추적 + Esc 취소.
 * App 에 1회 마운트. keydown/keyup 으로 Ctrl/Shift 변화를 즉시 반영(US-1.3:
 * 수정키 변경 즉시 의도 갱신).
 */
export function useDragController(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const s = getDragState()
      if (!s.active) return
      if (e.key === 'Escape') {
        endDrag()
        return
      }
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Meta') {
        setDragState({ mods: modsFromEvent(e) })
        recompute()
      }
    }
    // 드래그가 창(뷰포트)을 벗어나면 OS 드래그로 핸드오프(외부 앱/탐색기 드롭, §M M1).
    // 창 안에서는 native onDrop 이 처리하므로 호출하지 않는다(내부 즉시 드롭 보존).
    function onDocDragLeave(e: DragEvent): void {
      if (!pendingExternal || externalHandedOff) return
      // relatedTarget 없음 + 좌표가 뷰포트 밖 = 실제로 창을 벗어남(자식 간 이동 제외).
      const leftWindow =
        e.relatedTarget === null &&
        (e.clientX <= 0 ||
          e.clientY <= 0 ||
          e.clientX >= window.innerWidth ||
          e.clientY >= window.innerHeight)
      if (!leftWindow) return
      externalHandedOff = true
      const ctx = pendingExternal
      pendingExternal = null
      void startExternalDrag(ctx.sources, ctx.anyFolder)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    document.addEventListener('dragleave', onDocDragLeave)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      document.removeEventListener('dragleave', onDocDragLeave)
    }
  }, [])
}
