/**
 * 즐겨찾기 워터마크 판정·텍스트 소스 (renderer/domain/rules/favoriteWatermark) — 순수 함수.
 *
 * §N N1(US-13.1·F17): 현재 패널 경로가 즐겨찾기와 **정확 일치(===)** 할 때
 * 패널 배경에 즐겨찾기 이름(별칭 우선·없으면 basename)을 반투명 표시하기 위한
 * 판정/텍스트 결정을 도메인 순수 규칙으로 격리한다. 렌더(UI)는 결과만 그린다.
 *
 * - 정규화: panelPath·favorites 항목을 normalizeDisplay(domain/paths)로 정규화한 뒤
 *   정확 일치(===)만 매치. 부분/하위 경로는 1차 비매치(과표시 방지·features §N1).
 * - 비매치: "내 PC"('')·원격 경로(locationKindOf !== 'local')는 워터마크 대상 아님
 *   (기존 addFavorite 이 ''·원격을 사실상 제외하는 정책과 일치).
 * - 다중 일치(결정론): 같은 경로가 favorites 에 둘 이상이어도 **첫 일치 인덱스 1개만**
 *   반환하고 나머지는 무시한다(겹쳐 깔지 않음 — features §N1 "다중 일치 시 1개만").
 * - 텍스트: favoriteLabels[matchedPath](J7/J8 별칭)가 있고 비어있지 않으면 별칭,
 *   없으면 baseName(matchedPath). **Sidebar FavoriteRow.display 와 동일 폴백 규칙**.
 *   별칭의 원본 키는 정규화 전 favorites 항목(favoriteLabels 맵 키)을 그대로 쓴다.
 *
 * 부수효과 없음. react/zustand/infra/shared-ipc import 금지(.eslintrc).
 */
import { baseName, isMyPc, normalizeDisplay } from '@renderer/domain/paths'
import { locationKindOf } from '@renderer/domain/rules/remoteLocation'

/** 워터마크 판정 결과. 매치 시 표시 텍스트 동봉, 비매치면 match=false. */
export type FavoriteWatermark = { readonly match: true; readonly text: string } | { readonly match: false }

const NO_MATCH: FavoriteWatermark = { match: false }

/**
 * 현재 패널 경로가 즐겨찾기와 정확 일치하면 표시 텍스트를 반환한다(N1).
 *
 * @param panelPath       현재 패널 경로(로컬 Windows 경로 또는 ''(내 PC)·원격 URI).
 * @param favorites       즐겨찾기 경로 배열(sidebarSlice.favorites, 순서 보존).
 * @param favoriteLabels  즐겨찾기 별칭 맵(path → label, 빈 별칭은 basename 폴백).
 * @returns 정확 일치 시 { match:true, text }, 아니면 { match:false }.
 */
export function resolveFavoriteWatermark(
  panelPath: string,
  favorites: readonly string[],
  favoriteLabels: Readonly<Record<string, string>>
): FavoriteWatermark {
  // "내 PC"·원격 경로는 즐겨찾기 워터마크 대상이 아님(비매치).
  if (isMyPc(panelPath)) return NO_MATCH
  if (locationKindOf(panelPath) !== 'local') return NO_MATCH

  const target = normalizeDisplay(panelPath)
  if (target === '') return NO_MATCH

  // 첫 일치 인덱스 1개만 선택(다중 일치 결정론).
  for (const fav of favorites) {
    if (normalizeDisplay(fav) !== target) continue
    const label = favoriteLabels[fav]
    const text = label && label.trim() !== '' ? label : baseName(fav)
    return { match: true, text }
  }
  return NO_MATCH
}
