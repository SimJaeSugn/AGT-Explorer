/**
 * preview 유스케이스 (P6b, US-4.3) — 미리보기 데이터 조회 경계.
 *
 * ui(PreviewPanel)는 infra 를 직접 import 할 수 없으므로(.eslintrc) 이 usecase 를
 * 경유해 previewApi.read 를 호출한다. 로딩/에러 상태는 패널 국소 상태로 둔다.
 *
 * app → infra/api 직접 호출(.eslintrc 허용).
 */
import type { PreviewData } from '@shared/dto'
import type { Result } from '@shared/ipc/contracts'
import { previewApi } from '@renderer/infra/api'

/** 단일 경로의 미리보기 데이터(이미지/텍스트/메타/미지원)를 읽는다. */
export function readPreview(path: string): Promise<Result<PreviewData>> {
  return previewApi.read(path)
}
