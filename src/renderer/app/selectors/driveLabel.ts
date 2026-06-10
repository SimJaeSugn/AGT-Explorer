/**
 * 드라이브 표기 공용 해석기 — 디렉토리가 노출되는 모든 곳에서 드라이브 문자 단독
 * 표기("C:\\")를 볼륨 라벨 포함 표기("Windows (C:)")로 일치시킨다.
 *
 * 단일 출처: 사이드바 트리 드라이브 노드의 label(드라이브 열거 시 fs:drives 가
 * "볼륨명 (C:)" 형식으로 채움 — FileSystemService#formatDriveLabel). 이 label 을
 * 재사용하므로 신규 IPC/상태 없이 브레드크럼·탭·즐겨찾기·최근이 동일 표기를 공유한다.
 *
 * 드라이브 루트가 아니거나(일반 폴더·UNC·원격) 트리 미로드면 fallback 을 그대로
 * 반환한다(예: baseName(path) 또는 기존 세그먼트 라벨).
 */
import type { TreeNode } from '@renderer/domain/entities'
import { isDriveRoot, normalizeDisplay } from '@renderer/domain/paths'

export function resolveDriveLabel(
  path: string,
  tree: Record<string, TreeNode>,
  fallback: string
): string {
  if (!isDriveRoot(path)) return fallback
  // 트리 키는 "C:\\" 정규형 — normalizeDisplay 가 "C:" → "C:\\" 보정.
  return tree[normalizeDisplay(path)]?.label ?? fallback
}
