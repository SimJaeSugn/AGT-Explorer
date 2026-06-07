/**
 * BUG-001 실증 전용 electron 스텁(헤드리스).
 *
 * OperationManager / fileClipboard 가 import 하는 electron 표면 중,
 * copy/move 경로에서 실제로 닿는 것만 최소 구현한다:
 *  - clipboard.writeText: 노옵(텍스트 클립보드 부가 동작).
 *  - shell.trashItem: copy/move 검증에는 미사용(존재만).
 * WebContents 는 본 검증에서 직접 만든 fake 객체를 OperationManager.start 에
 * 넘기므로 여기서 제공할 필요 없다.
 */
export const clipboard = {
  writeText(_text: string): void {
    /* no-op (헤드리스) */
  }
}

export const shell = {
  async trashItem(_path: string): Promise<void> {
    /* copy/move 검증 미사용 */
  }
}
