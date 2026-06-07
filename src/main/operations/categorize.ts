/**
 * 확장자 → 파일 카테고리 분류 (K3 유형별 비중 · Main 전용).
 *
 * scanEngine 의 1패스 byCategory 집계가 호출하는 **순수 함수**(추가 I/O 0 — 이름만
 * 분류). 카테고리 키(FileCategory, 7종)는 shared/dto 에서 공유한다(대시보드 라벨 공용).
 *
 * 미등록/빈 확장자 → 'other'. 입력은 소문자·선행 '.' 제외 가정이나, 방어적으로
 * 내부에서 정규화한다(선행 '.' 제거·소문자화).
 */
import type { FileCategory } from '@shared/dto'

/**
 * 확장자(소문자, 선행 '.' 제외) → 카테고리. 7카테고리 맵.
 * 키는 정규화된 확장자, 값은 카테고리. EXT_MAP 미등록 → 'other'.
 */
const EXT_MAP: Readonly<Record<string, FileCategory>> = {
  // image
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  svg: 'image',
  ico: 'image',
  tiff: 'image',
  tif: 'image',
  heic: 'image',
  // video
  mp4: 'video',
  mkv: 'video',
  avi: 'video',
  mov: 'video',
  webm: 'video',
  wmv: 'video',
  flv: 'video',
  m4v: 'video',
  // audio
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  aac: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  wma: 'audio',
  // document
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  ppt: 'document',
  pptx: 'document',
  txt: 'document',
  md: 'document',
  hwp: 'document',
  odt: 'document',
  csv: 'document',
  rtf: 'document',
  // code
  js: 'code',
  ts: 'code',
  jsx: 'code',
  tsx: 'code',
  py: 'code',
  java: 'code',
  c: 'code',
  cpp: 'code',
  cc: 'code',
  h: 'code',
  hpp: 'code',
  cs: 'code',
  go: 'code',
  rs: 'code',
  rb: 'code',
  php: 'code',
  swift: 'code',
  kt: 'code',
  json: 'code',
  html: 'code',
  htm: 'code',
  css: 'code',
  scss: 'code',
  xml: 'code',
  yml: 'code',
  yaml: 'code',
  sh: 'code',
  bat: 'code',
  ps1: 'code',
  sql: 'code',
  // archive
  zip: 'archive',
  '7z': 'archive',
  rar: 'archive',
  tar: 'archive',
  gz: 'archive',
  bz2: 'archive',
  xz: 'archive'
}

/**
 * 소문자 확장자(선행 '.' 제외) → 카테고리. 미등록/빈 확장자 → 'other'.
 * 방어적 정규화(선행 '.' 제거·소문자) 후 조회.
 */
export function categorizeExt(ext: string): FileCategory {
  if (typeof ext !== 'string' || ext.length === 0) return 'other'
  let e = ext
  while (e.startsWith('.')) e = e.slice(1)
  if (e.length === 0) return 'other'
  return EXT_MAP[e.toLowerCase()] ?? 'other'
}
