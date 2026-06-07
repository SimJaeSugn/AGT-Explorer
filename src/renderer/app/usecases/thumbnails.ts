/**
 * thumbnails 유스케이스 — 그리드 이미지 썸네일 캐시의 app 계층 경계(feat-L1, 계획서 §4.2).
 *
 * ui→infra 직접 import 금지 규칙상, ui(FileListView 의 ThumbnailIcon)는 이 얇은 래퍼를
 * 경유해 infra/icon 의 path+size 단위 썸네일 캐시(전역 모듈 + in-flight 디듀프 + negCache)에
 * 접근한다. 캐시 자체는 패널 store 슬라이스를 오염시키지 않는 store 밖 전역(셀렉터 격리, SA §5.2).
 *
 * icons.ts(OS 아이콘 캐시 경계)와 동형 — 썸네일 전용 파일로 응집 분리한다.
 */
export {
  thumbnailKeyFor,
  getCachedThumbnail,
  requestThumbnail,
  subscribeThumbnail
} from '@renderer/infra/icon/thumbnailCache'
