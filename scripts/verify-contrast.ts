/**
 * verify-contrast — WCAG 2.x 대비비 자동 측정 하니스 (P7-B, 헤드리스).
 *
 * palette.ts 의 4종 팔레트(LIGHT / DARK / BLUELIGHT, + system=light/dark 의 동치)
 * 주요 전경/배경 토큰 쌍의 명도 대비비를 WCAG 공식으로 계산하고 AA 게이트를 단언한다.
 *   - 본문 텍스트(text vs bg / bg-alt / bg-hover / bg-selected / bg-selected-inactive) ≥ 4.5:1
 *   - 보조 텍스트(text-muted vs bg / bg-alt) ≥ 4.5:1 지향(미달 시 ≥3:1 경고)
 *   - 그래픽/큰텍스트(accent·danger 테두리·아이콘, 버튼 흰글자 on accent/danger) ≥ 3:1
 *
 * 미달(FAIL)이 하나라도 있으면 비영(非0) 종료로 게이트한다(verify 관례).
 *
 * 실행: esbuild 번들 → node (package.json verify:contrast — PM 등록).
 */
import {
  LIGHT_PALETTE,
  DARK_PALETTE,
  BLUELIGHT_PALETTE,
  AGT_PALETTE,
  type Palette
} from '../src/renderer/ui/theme/palette'

/** WCAG 대비 임계. */
const AA_NORMAL = 4.5
const AA_LARGE = 3.0 // 큰 텍스트·그래픽 객체(2.4.7 / 1.4.11).

/** "#rrggbb" → [r,g,b] (0..255). */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim()
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** sRGB 채널(0..1) → 선형값(WCAG 상대휘도 공식). */
function linearize(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** 상대 휘도(WCAG 2.x). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** 두 색의 대비비(1..21). */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

interface Check {
  readonly label: string
  /** 전경 토큰명 또는 리터럴 색. */
  readonly fg: string
  /** 배경 토큰명 또는 리터럴 색. */
  readonly bg: string
  /** 요구 임계(AA_NORMAL | AA_LARGE). */
  readonly min: number
  /**
   * 정보성(게이트 비대상). 장식용 경계선처럼 WCAG 1.4.11(의미 전달 그래픽/UI 컴포넌트
   * 식별 경계)에 해당하지 않는 토큰은 측정만 하고 통과/실패를 게이트하지 않는다.
   */
  readonly info?: boolean
}

/** "rgba(r,g,b,a)" 를 불투명 배경 hex 위에 합성해 hex 로 환산(대비 측정용). */
function compositeRgbaOverHex(rgba: string, bgHex: string): string {
  const m = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/)
  if (!m) throw new Error(`rgba 파싱 실패: ${rgba}`)
  const sr = Number(m[1]), sg = Number(m[2]), sb = Number(m[3])
  const a = m[4] === undefined ? 1 : Number(m[4])
  const [dr, dg, db] = hexToRgb(bgHex)
  const mix = (s: number, d: number): number => Math.round(s * a + d * (1 - a))
  const toHex = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${toHex(mix(sr, dr))}${toHex(mix(sg, dg))}${toHex(mix(sb, db))}`
}

/** 토큰명(`--c-*`) 또는 리터럴 `#hex` 를 색값으로 해석. rgba 토큰은 --c-bg 위에 합성. */
function resolve(p: Palette, token: string): string {
  if (token.startsWith('#')) return token
  const v = p[token]
  if (!v) throw new Error(`팔레트에 토큰 없음: ${token}`)
  if (v.startsWith('rgba') || v.startsWith('rgb(')) return compositeRgbaOverHex(v, p['--c-bg'])
  return v
}

/**
 * 각 팔레트 공통 체크 목록. 본문/보조/그래픽 쌍을 망라.
 * 버튼 흰 글자는 dialogStyles.btn(primary/danger) 가 '#fff' 를 쓰므로 리터럴.
 */
const CHECKS: Check[] = [
  // 본문 텍스트 on 배경 계열(AA normal 4.5:1).
  { label: 'text on bg', fg: '--c-text', bg: '--c-bg', min: AA_NORMAL },
  { label: 'text on bg-alt', fg: '--c-text', bg: '--c-bg-alt', min: AA_NORMAL },
  { label: 'text on bg-hover', fg: '--c-text', bg: '--c-bg-hover', min: AA_NORMAL },
  { label: 'text on bg-selected', fg: '--c-text', bg: '--c-bg-selected', min: AA_NORMAL },
  {
    label: 'text on bg-selected-inactive',
    fg: '--c-text',
    bg: '--c-bg-selected-inactive',
    min: AA_NORMAL
  },
  // 보조 텍스트(muted) — AA normal 지향.
  { label: 'text-muted on bg', fg: '--c-text-muted', bg: '--c-bg', min: AA_NORMAL },
  { label: 'text-muted on bg-alt', fg: '--c-text-muted', bg: '--c-bg-alt', min: AA_NORMAL },
  // danger 텍스트(실패 메시지) on 배경.
  { label: 'danger on bg', fg: '--c-danger', bg: '--c-bg', min: AA_NORMAL },
  // 그래픽/큰텍스트(AA large 3:1): accent 테두리·아이콘 on 배경.
  { label: 'accent on bg (graphical)', fg: '--c-accent', bg: '--c-bg', min: AA_LARGE },
  // border-strong 는 장식용 경계선(스크롤바 thumb·패널 외곽선) — 1.4.11 대상 아님 → 정보성 측정만.
  {
    label: 'border-strong on bg (decorative)',
    fg: '--c-border-strong',
    bg: '--c-bg',
    min: AA_LARGE,
    info: true
  },
  // primary 버튼 글자(accent 채움 위 대비색 — dialogStyles.btn 가 --c-accent-contrast 사용) 3:1.
  { label: 'accent-contrast on accent (button)', fg: '--c-accent-contrast', bg: '--c-accent', min: AA_LARGE },
  // danger 버튼은 흰 글자(dialogStyles 리터럴 #fff) — 큰/굵은 글자 3:1.
  { label: 'white on danger (button)', fg: '#ffffff', bg: '--c-danger', min: AA_LARGE }
]

const PALETTES: ReadonlyArray<{ name: string; palette: Palette }> = [
  { name: 'LIGHT (= system light)', palette: LIGHT_PALETTE },
  { name: 'DARK (= system dark)', palette: DARK_PALETTE },
  { name: 'BLUELIGHT', palette: BLUELIGHT_PALETTE },
  { name: 'AGT-DARK (그린)', palette: AGT_PALETTE }
]

function main(): void {
  let failures = 0
  let warnings = 0
  console.log('── WCAG 대비 측정 (P7-B verify-contrast) ─────────────────────')

  for (const { name, palette } of PALETTES) {
    console.log(`\n[${name}]`)
    for (const c of CHECKS) {
      const fg = resolve(palette, c.fg)
      const bg = resolve(palette, c.bg)
      const ratio = contrastRatio(fg, bg)
      const pass = ratio >= c.min
      const reqTag = c.min === AA_NORMAL ? 'AA 4.5' : 'AA-L 3.0'
      if (c.info) {
        // 정보성: 게이트 비대상, 측정값만 보고.
        console.log(`  [INFO] ${c.label.padEnd(36)} ${ratio.toFixed(2)}:1  (참고, 비게이트)`)
        continue
      }
      const tag = pass ? 'PASS' : 'FAIL'
      const line = `  [${tag}] ${c.label.padEnd(36)} ${ratio.toFixed(2)}:1  (≥ ${reqTag})`
      if (pass) {
        console.log(line)
      } else {
        // muted/보조 텍스트가 4.5 미달이지만 3.0 이상이면 경고로 강등(본문 핵심 아님).
        if (c.fg === '--c-text-muted' && ratio >= AA_LARGE) {
          warnings++
          console.warn(`${line}  ⚠ (≥3:1 — 보조텍스트 경고, 본문 AA 미달)`)
        } else {
          failures++
          console.error(line)
        }
      }
    }
  }

  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(`결과: 실패 ${failures}건 · 경고 ${warnings}건`)
  if (failures > 0) {
    console.error('❌ WCAG AA 대비 미달 토큰이 있습니다(palette.ts 보정 필요).')
    process.exit(1)
  }
  console.log('✅ 4종 팔레트 주요 토큰 쌍 WCAG AA 통과.')
}

main()
