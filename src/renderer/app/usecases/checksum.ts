/**
 * 체크섬 검증 유스케이스 (app/usecases/checksum) — 복사 후 무결성 검증 (§R4·US-17.4·F25).
 *
 * 설정(verifyOnCopy)이 켜져 있으면 **복사 op 완료(op:done) 후** 원본↔사본 쌍을
 * 백엔드 `hash:verify:start`(공용 해시 엔진·SHA-256)로 검증한다. 불일치가 있으면
 * 경고 토스트, 전부 일치면 간단 안내(무음에 가깝게). 신규 채널 0 — hash:verify 재사용.
 *
 * 트리거 책임: operationsBridge.onDone 이 성공한 copy op(undoMeta.kind==='copy')에서
 * verifyAfterCopy(undoMeta) 를 호출한다. 결과 수신은 initChecksumBridge 전역 구독.
 *
 * 한계(정직): 복사 비원자 — 복사 직후 사본이 외부에서 바뀌면 검증 시점 값으로 판정한다
 * (검증은 "복사 완료~검증 시점" 동일성 보장). 충돌 rename(EEXIST)·부분 실패 시 사본 경로가
 * destDir+basename 과 다를 수 있어 op:done 실패 0(failedItems===0) 인 경우만 검증한다.
 *
 * 경계: app → infra/api(hashApi·subscribeHashVerifyStream) 직접 호출(.eslintrc 허용).
 * 결과 판정·요약은 domain/rules/checksumVerdict 순수 함수에 위임.
 */
import { hashApi, subscribeHashVerifyStream } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { baseName, joinPath } from '@renderer/domain/paths'
import { summarizeVerify, verifyMessage } from '@renderer/domain/rules/checksumVerdict'
import type { OperationUndoMeta } from '@renderer/app/stores/operationsSlice'

/** 진행 중 검증 잡 식별(결과 상관). 단발 — 새 잡 시작 시 직전 것은 무시. */
let activeJobId: string | null = null

/**
 * 복사 완료 후 검증 트리거. 설정(verifyOnCopy) off 이거나 copy 아님·소스 0 이면 무동작
 * (복사 동작 무변경 — 비파괴). 사본 경로는 destDir + 원본 basename 으로 산출한다
 * (충돌 rename 가능성 때문에 호출측이 실패 0 일 때만 호출 — operationsBridge 가 게이트).
 */
export async function verifyAfterCopy(undoMeta: OperationUndoMeta): Promise<void> {
  const s = store.getState()
  if (!s.verifyOnCopy) return
  if (undoMeta.kind !== 'copy') return
  const pairs = undoMeta.sources.map((src) => ({ src, dst: joinPath(undoMeta.destDir, baseName(src)) }))
  if (pairs.length === 0) return

  const res = await hashApi.verifyStart({ pairs })
  if (!res.ok) {
    s.pushToast('error', `체크섬 검증을 시작하지 못했습니다: ${res.error.message}`)
    return
  }
  activeJobId = res.value.jobId
}

let disposer: (() => void) | null = null

/**
 * hash:verify:* 전역 구독 시작(중복 호출 무시). 현재 활성 잡과 일치하는 done/error 만
 * 처리(상관 필터 — 교체/취소된 잡의 잔여 이벤트 격리·dedupBridge 동형).
 * progress 는 1차에서 별도 UI 없이 무시(복사 후 백그라운드 검증·정직 한계).
 */
export function initChecksumBridge(): void {
  if (disposer) return
  disposer = subscribeHashVerifyStream({
    onProgress: () => {
      // 1차: 복사 후 백그라운드 검증 — 별도 진행률 UI 없음(후속·비차단).
    },
    onDone: (evt) => {
      if (evt.jobId !== activeJobId) return
      activeJobId = null
      const s = store.getState()
      const verdict = summarizeVerify(evt.mismatches, evt.verified)
      if (verdict.kind === 'mismatch') {
        s.pushToast('error', verifyMessage(verdict))
      } else if (verdict.total > 0) {
        s.pushToast('info', verifyMessage(verdict))
      }
    },
    onError: (evt) => {
      if (evt.jobId !== activeJobId) return
      activeJobId = null
      store
        .getState()
        .pushToast('error', `체크섬 검증 중 오류: ${evt.error.message ?? '알 수 없는 오류'}`)
    }
  })
}

/** 구독 해제(테스트·HMR). */
export function disposeChecksumBridge(): void {
  if (disposer) {
    disposer()
    disposer = null
  }
  activeJobId = null
}
