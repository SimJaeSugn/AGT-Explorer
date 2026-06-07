/**
 * icons 유스케이스 — OS 파일 아이콘 캐시의 app 계층 경계(H6, 계획서 §3.4).
 *
 * ui→infra 직접 import 금지 규칙상, ui(FileListView 의 OSIcon)는 이 얇은 래퍼를
 * 경유해 infra/icon 의 키 단위 아이콘 캐시(전역 모듈 + in-flight 디듀프)에 접근한다.
 * 캐시 자체는 패널 store 슬라이스를 오염시키지 않는 store 밖 전역(셀렉터 격리, SA §5.2).
 */
export {
  iconKeyFor,
  getCachedIcon,
  requestIcon,
  subscribeIcon
} from '@renderer/infra/icon/iconCache'
