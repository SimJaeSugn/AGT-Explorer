/**
 * undoSlice — 되돌리기(Ctrl+Z) 다단계 스택 (K장 K1).
 *
 * 휘발 상태(세션/워크스페이스 스냅샷 미포함 — coerceSession 에 undo 필드 없음).
 * 앱 재시작 시 자동으로 빈 스택이다. operationsSlice 와 분리해 관심사를
 * 격리한다(고빈도 progress 와 무관, push/pop 만 발생).
 *
 * 역연산 정보는 kind 별 판별 유니온 UndoEntry 로 보관한다. 실제 역연산 실행은
 * usecases/undo.performUndo 가 담당하고, 이 슬라이스는 순수 데이터(스택)만 다룬다.
 *
 * 엔트리 생성 hook:
 *  - rename/create: fileOps 성공 분기에서 pushUndo.
 *  - move/copy/trash: operationsBridge.onDone 에서 op.undoMeta 로 pushUndo.
 * 영구삭제(delete)는 엔트리를 만들지 않는다(되돌릴 수 없음 — undo 시도 시 안내).
 */
import type { SliceCreator } from './types'

/** 스택 상한(PM 확정 — 기획 권장 20에서 상향). 초과 시 가장 오래된 엔트리 폐기. */
export const UNDO_STACK_CAP = 50

/**
 * 되돌리기 1건의 역연산 정보(kind 별 판별 유니온).
 *
 *  - rename: newPath 를 oldName 으로 되돌린다(rename↔rename).
 *  - create: 생성물을 휴지통으로 보낸다(폴더/파일).
 *  - move:   toDir 의 항목들을 fromDir 로 되돌린다(역방향 move).
 *  - copy:   생성된 사본 경로들을 휴지통으로 보낸다.
 *  - trash:  휴지통 복원(trash:restore) — originalPath 로 휴지통 항목을 매칭.
 */
export type UndoEntry =
  | {
      readonly kind: 'rename'
      /** 이름변경 후 현재 경로(되돌릴 대상). */
      readonly newPath: string
      /** 변경 전 이름(되돌릴 이름). */
      readonly oldName: string
      /** 변경 후 이름(매칭/진단용). */
      readonly newName: string
    }
  | {
      readonly kind: 'create'
      /** 새로 만든 폴더/파일의 전체 경로(역=휴지통 보내기). */
      readonly path: string
    }
  | {
      readonly kind: 'move'
      /** 이동된 항목들의 원본 전체 경로(fromDir 기준). */
      readonly sources: string[]
      /** 원래 있던 폴더(되돌릴 목적지). */
      readonly fromDir: string
      /** 이동된 목적지 폴더(현재 위치). */
      readonly toDir: string
    }
  | {
      readonly kind: 'copy'
      /** 복사로 생성된 사본의 전체 경로들(역=휴지통 보내기). */
      readonly createdPaths: string[]
    }
  | {
      readonly kind: 'trash'
      /** 휴지통으로 보낸 항목들의 원래 전체 경로(복원 매칭 키). */
      readonly originalPaths: string[]
    }

export interface UndoSlice {
  /** 되돌리기 스택. push=top(끝), pop=undo. 상한 UNDO_STACK_CAP. */
  readonly undoStack: UndoEntry[]
  /** 역연산 엔트리를 스택에 적재. 상한 초과 시 가장 오래된 것 폐기. */
  pushUndo(entry: UndoEntry): void
  /** 스택 top 을 꺼낸다(없으면 undefined). performUndo 가 호출. */
  popUndo(): UndoEntry | undefined
  /** 스택 비우기(테스트·필요시). 세션 비직렬화이므로 부팅 시 자동 빈 스택. */
  clearUndo(): void
}

export const createUndoSlice: SliceCreator<UndoSlice> = (set, get) => ({
  undoStack: [],

  pushUndo(entry) {
    set((s) => {
      s.undoStack.push(entry)
      // 상한 초과 → 가장 오래된 것(앞)부터 폐기.
      while (s.undoStack.length > UNDO_STACK_CAP) s.undoStack.shift()
    })
  },

  popUndo() {
    const stack = get().undoStack
    if (stack.length === 0) return undefined
    const top = stack[stack.length - 1]
    set((s) => {
      s.undoStack.pop()
    })
    return top
  },

  clearUndo() {
    set((s) => {
      s.undoStack = []
    })
  }
})
