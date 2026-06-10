/**
 * 바이너리 파일 자동 판별 — 확장자 1차 필터 + 내용 휴리스틱 (M8 — ADR-010 결정③).
 *
 * 환경 비의존: 내용 샘플(앞부분 N바이트)을 **주입**받아 NUL 바이트/비텍스트 바이트
 * 비율로 판정한다. 그래서 (a) Worker 안에서 실 파일 샘플로, (b) 검증 스크립트에서
 * 메모리 버퍼로 동일하게 돌릴 수 있다(scanEngine·hashEngine 선례와 동형).
 *
 * 2단계(ADR-010 결정③):
 *  1) **확장자 1차 필터**: categorize.ts 의 알려진 바이너리 카테고리(image/video/
 *     audio/archive) + 추가 바이너리 확장자(exe/dll/pdf 등)는 즉시 바이너리로 본다
 *     (내용 안 읽음 — 비용 절감). document 는 txt/md/csv 등 텍스트가 섞여 있어 1차
 *     필터에서 제외하지 않고 내용 휴리스틱으로 넘긴다(pdf 등은 별도 BINARY_EXTS 로 포착).
 *  2) **내용 휴리스틱**: 확장자로 불명확한 파일은 앞부분 샘플의 NUL 바이트 존재 또는
 *     비텍스트(제어문자) 바이트 비율(임계 초과)로 바이너리 판정 → 스킵.
 *
 * throw 금지 — 순수 판정 함수.
 */
import { categorizeExt } from '../operations/categorize'

/**
 * 확장자만으로 바이너리 확정인 카테고리(categorize.ts FileCategory). 이 카테고리는
 * 내용을 읽지 않고 바이너리로 단정한다(이미지/영상/음성/압축).
 */
const BINARY_CATEGORIES = new Set(['image', 'video', 'audio', 'archive'])

/**
 * categorize.ts 에 없거나 'document'/'code'/'other' 로 분류되지만 실제로는 바이너리인
 * 확장자(소문자, 선행 '.' 제외). pdf/doc 류 오피스 바이너리·실행/오브젝트·폰트·DB 등.
 */
const BINARY_EXTS = new Set([
  // 실행/오브젝트/라이브러리
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'obj', 'a', 'lib', 'class', 'pyc', 'pdb',
  'msi', 'cab', 'wasm', 'node',
  // 오피스/문서 바이너리(텍스트 아님)
  'pdf', 'doc', 'xls', 'ppt', 'hwp',
  // 폰트
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // DB/직렬화/디스크 이미지
  'db', 'sqlite', 'sqlite3', 'mdb', 'iso', 'img', 'dmg', 'vhd', 'vmdk',
  // 미디어 컨테이너(categorize 누락 보강)
  'psd', 'ai', 'sketch'
])

/** 내용 샘플 크기(앞부분 N바이트). ADR-010 결정③ ~8KB. */
export const BINARY_SNIFF_BYTES = 8192

/** 비텍스트(제어문자) 바이트 비율 임계 — 초과 시 바이너리로 판정. */
export const BINARY_NONTEXT_RATIO = 0.3

/**
 * UTF-8 BOM(EF BB BF). 존재하면 텍스트 신호(내용 휴리스틱에서 BOM 3바이트는 제외하고 판정).
 */
const BOM = [0xef, 0xbb, 0xbf] as const

/** 확장자만으로 바이너리 확정인가(소문자·선행 '.' 제외). 내용 안 읽고 스킵 판정. */
export function isBinaryByExt(ext: string): boolean {
  if (typeof ext !== 'string') return false
  let e = ext
  while (e.startsWith('.')) e = e.slice(1)
  e = e.toLowerCase()
  if (e.length === 0) return false
  if (BINARY_EXTS.has(e)) return true
  return BINARY_CATEGORIES.has(categorizeExt(e))
}

/**
 * 내용 샘플(앞부분 바이트)로 바이너리 판정한다.
 *  - NUL(0x00) 바이트가 1개라도 있으면 바이너리(텍스트엔 사실상 없음).
 *  - 그 외 제어문자(텍스트 화이트리스트 밖) 비율이 임계 초과면 바이너리.
 *
 * 텍스트 허용 제어문자: TAB(9)·LF(10)·CR(13)·FF(12)·BS(8)·ESC(27). 그 외 0x00~0x1F 는
 * 비텍스트로 카운트. 0x7F(DEL)도 비텍스트. UTF-8 멀티바이트(>=0x80)는 텍스트로 본다
 * (UTF-8/ASCII 가정 — ADR-010 결정②). 선행 UTF-8 BOM 은 스킵 후 판정.
 */
export function isBinaryBySample(sample: Uint8Array): boolean {
  let start = 0
  if (sample.length >= 3 && sample[0] === BOM[0] && sample[1] === BOM[1] && sample[2] === BOM[2]) {
    start = 3 // BOM 은 텍스트 신호 — 판정에서 제외.
  }
  const len = sample.length
  if (len - start <= 0) return false // 빈/BOM뿐 → 텍스트 취급.

  let nonText = 0
  let counted = 0
  for (let i = start; i < len; i++) {
    const b = sample[i]!
    if (b === 0) return true // NUL → 즉시 바이너리.
    counted++
    if (b < 0x20) {
      // 허용 제어문자(텍스트에 흔함)는 제외.
      if (b === 9 || b === 10 || b === 13 || b === 12 || b === 8 || b === 27) continue
      nonText++
    } else if (b === 0x7f) {
      nonText++
    }
    // >=0x80 은 UTF-8 멀티바이트(텍스트) — 카운트 안 함.
  }
  if (counted === 0) return false
  return nonText / counted > BINARY_NONTEXT_RATIO
}
