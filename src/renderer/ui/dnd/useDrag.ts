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
 * 외부 OS 드래그 소스 훅 — 파일 행에 native HTML5 draggable 로 연결(§M M1).
 *
 * 외부(바탕화면/탐색기/타 앱)로의 드래그-드롭은 OS 가 인계해야 하며,
 * Electron 의 webContents.startDrag 는 **native dragstart**(마우스 버튼이 눌린
 * 드래그 제스처 진행 중)에서 호출해야만 OS 드래그로 넘어간다. 따라서 행에
 * draggable=true 를 주고 onDragStart 에서 즉시 startExternalDrag 를 호출한다.
 *
 * - 드래그 소스(현재 선택 + 클릭 항목)가 **모두 로컬**일 때만 위임(원격 포함 시
 *   브라우저 기본 드래그를 막지 않고 그대로 둠 — externalDrag 도 2중 방어).
 * - e.preventDefault() 로 브라우저 기본 드래그(텍스트/이미지 ghost)를 막아
 *   main 의 startDrag 가 OS 드래그를 단독 인계하게 한다.
 * - 내부 패널 간 D&D(§A3)·박스 선택(J1)은 기존 pointer 경로가 계속 담당한다.
 *   native dragstart 는 외부 인계 전용이므로 내부 경로와 충돌하지 않는다.
 *
 * @param getDragSources 드래그할 경로 묶음을 만드는 콜백(useDragSource 와 동일 소스).
 */
export function useExternalDragSource(getDragSources: () => string[]): {
  draggable: boolean
  onDragStart: (e: React.DragEvent) => void
} {
  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      const sources = getDragSources()
      if (sources.length === 0) return
      // 모두 로컬일 때만 OS 드래그 인계. 원격 항목이 섞이면 외부 드래그 비활성(기본 동작 유지).
      const allLocal = sources.every((p) => locationKindOf(p) === 'local')
      if (!allLocal) return
      // 브라우저 기본 드래그를 막고 webContents.startDrag(native dragstart 중)로 인계.
      e.preventDefault()
      const anyFolder = sources.some((p) => !/\.[^\\/.]+$/.test(p))
      void startExternalDrag([...sources], anyFolder)
    },
    [getDragSources]
  )

  return { draggable: true, onDragStart }
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
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])
}
