# L-thumbnail — 그리드 보기 이미지 썸네일 (feat-L1) 구현 계획서

> 코드베이스 수준 구현 계획. **구현은 포함하지 않는다.** reviewer 검증용 세부 계획.
> 대상: 아이콘 그리드 보기(`icons-large/medium/small`, J3)에서 이미지 파일을 **실제 내용
> 축소 썸네일**로 표시하고, 미지원·손상·대용량은 **OS 아이콘(shell:icon, H6)으로 폴백**한다.
> details/list 는 기존 OS 아이콘 유지. data URL 로만 전달(CSP·보안). 가시 셀만 생성·캐시·비차단.

---

## 0. 스코프 / 비스코프

**스코프(사용자 확정)**
- `icons-large/medium/small` 그리드 셀에서만 이미지 entry → 실제 내용 축소 썸네일.
- 미지원 형식(webp/svg/tiff…)·손상·대용량·`isEmpty()` → **OSIcon 폴백**(기존 H6).
- 가시 셀(가상 스크롤 윈도 내)만 생성·요청. 백엔드/프런트 양쪽 캐시. main 비차단(concurrency 제한).
- data URL 전달(파일 바이트·blob URL 미노출, 기존 CSP `data:` 허용 선례 = readPreview/icon).

**비스코프**
- details/list 보기(16px OS 아이콘 유지 — 변경 없음).
- 비이미지 파일(폴더 포함) → 기존 OSIcon 경로 유지.
- 디스크 영속 썸네일 캐시(thumbs.db 류)·EXIF 회전·애니메이션 GIF 프레임 선택 — 비스코프(향후).
- webp/svg 전용 디코더 도입 — 비스코프(nativeImage 시도 후 실패 시 폴백).

---

## 1. 설계 결정 확정 (요약)

| # | 결정 | 근거 |
|---|------|------|
| D1 | 생성 방식 = Electron **`nativeImage`** (main): `createFromPath(path)` → `.resize({width,height,quality:'good'})` → `.toDataURL()` | 무의존성·동기 디코드. icon.ts 의 `app.getFileIcon`/`isEmpty()` 패턴과 동형 |
| D2 | 신규 채널 `preview:thumbnail`(invoke 단발) — shell:icon 과 **별도** | 썸네일은 path별 고유라 ext 캐시 공유 불가. invoke 신규는 P1 동결 무관(선례 多) |
| D3 | 백엔드 캐시 = **path+size 키 LRU**(상한 256). 실패 비캐싱. **concurrency 세마포어(4)** | icon.ts LRU·실패 비캐싱 패턴 재사용. main 블로킹 방지 |
| D4 | 프런트 캐시 = 신규 `infra/icon/thumbnailCache.ts`. path+size 키, in-flight 디듀프, store 밖 전역 + useSyncExternalStore | iconCache.ts 와 1:1 동형(셀렉터 격리 SA §5.2) |
| D5 | 이미지 판정 = 확장자 기반 공유 헬퍼(`shared/` 또는 `renderer/domain`). webp 등은 "시도 대상"이되 nativeImage 실패 시 폴백 | renderer(요청 가드)·main(이중 가드) 공유 |
| D6 | 폴백 = dataUrl `null`(또는 빈문자) → 프런트가 OSIcon 렌더. 영구 폴백 방지 위해 **실패는 캐시 안 함** | icon.ts 와 동일 정책 |

**미지원/스킵 → null 반환 조건(백엔드)**: 파일 크기 > `THUMB_MAX_BYTES`(예 30MB), `createFromPath`
빈 이미지(`isEmpty()`), 예외(권한·레이스), 그리고 (D5 판정상 이미지지만) nativeImage 디코드 실패.

---

## 2. 썸네일 채널 · DTO (계약)

### 2.1 채널 상수 — `src/shared/ipc/channels.ts`
`preview:*` 블록에 추가(요청-응답 invoke, 푸시 evt 아님 → `EVENT_CHANNELS` 무변):
```ts
// ── preview:* 미리보기 데이터 읽기 ─
PREVIEW_READ: 'preview:read',
PREVIEW_THUMBNAIL: 'preview:thumbnail', // impl: L장 (그리드 이미지 썸네일, nativeImage resize)
```
> **신규 invoke 채널이 P1 동결과 무관한 근거**: 동결은 "전 채널 shape 동결 + Phase별 핸들러
> 구현"이며, J장(fs:watch)·I장(analyze)·K장(trash)에서 신규 채널을 계속 추가해 온 선례가 있다.
> 푸시 evt 가 아니므로 `EVENT_CHANNELS` 변경 없음.

### 2.2 DTO/계약 — `src/shared/ipc/contracts.ts`
`preview:*` 블록에 요청/응답 인터페이스 추가 + `IpcRequestMap` 등록:
```ts
// ── preview:thumbnail (신규 L장 — 그리드 이미지 썸네일) ─
export interface ThumbnailReq {
  readonly path: string
  /** 정사각 목표 변(px). 프런트가 셀 아이콘 px × DPR 버킷으로 산출(예 64/96/128/192/256). */
  readonly size: number
}
export interface ThumbnailRes {
  /**
   * 성공 = data:image/png;base64 dataUrl.
   * 폴백(미지원·손상·대용량·빈 이미지) = null → 프런트가 OSIcon 으로 폴백.
   */
  readonly dataUrl: string | null
}
```
`IpcRequestMap` 의 preview 블록:
```ts
[CHANNELS.PREVIEW_READ]: { req: PreviewReadReq; res: Result<PreviewData> }
[CHANNELS.PREVIEW_THUMBNAIL]: { req: ThumbnailReq; res: Result<ThumbnailRes> }
```
> 응답은 `Result<ThumbnailRes>` 로 감싼다(가드 실패 = `err`, 정상 처리 = `ok({dataUrl})` 이며
> "썸네일 불가"는 예외가 아니라 `ok({dataUrl:null})`). shell:icon 이 `ok({dataUrl:''})` 로
> 부드럽게 폴백한 정책과 동형 — 단 null 을 명시 신호로 사용(빈문자 모호성 제거).

### 2.3 zod 스키마 — `src/main/ipc/guard.ts`
preview 블록에 추가:
```ts
// ── L장: preview:thumbnail (그리드 이미지 썸네일) ─
// size 는 화이트리스트 버킷만 허용(임의 거대 size 로 메모리 폭주·DoS 방지).
export const zThumbnailReq = z.object({
  path: zPath,
  size: z.number().int().refine((n) => THUMB_SIZE_BUCKETS.has(n), '허용되지 않은 썸네일 크기')
})
```
> `THUMB_SIZE_BUCKETS` 는 `shared/` 상수(예 `new Set([64,96,128,192,256])`)로 두고
> guard·thumbnail 서비스·프런트 버킷 산출이 **단일 출처**를 공유한다(임의 size 거부).

---

## 3. 백엔드 — 썸네일 서비스 + 핸들러

### 3.1 신규 `src/main/os/thumbnail.ts` (icon.ts / driveType.ts 패턴 모사)
책임: 검증된 실존 path + size 버킷 → dataUrl|null. LRU·실패 비캐싱·concurrency·크기상한·헤드리스 주입.

```ts
export interface ThumbnailResult { readonly dataUrl: string | null }

/** 시도 대상 확장자(소문자). nativeImage 가 디코드 가능성 있는 래스터 형식. */
// D5 공유 헬퍼(isImageExt)를 재사용 — 여기서 중복 정의 금지.

const THUMB_MAX_BYTES = 30 * 1024 * 1024     // 초과 → 폴백(생성 스킵)
const MAX_THUMB_CACHE = 256                   // path+size 키 LRU 상한(성공만 카운트)
const THUMB_CONCURRENCY = 4                   // main 동시 디코드 상한(세마포어)

/** 헤드리스 주입: 실제 nativeImage 디코드를 스텁으로 대체(verify 용). */
export interface ThumbnailServiceDeps {
  readonly statSize: (path: string) => Promise<number>          // 기본 fsp.stat().size
  readonly decodeResize: (path: string, size: number) => string | null // 기본 nativeImage 경로
}

/** 캐시 키 = `${path}::${size}` (path별 고유 — ext 공유 불가). */
export function thumbnailKeyFor(path: string, size: number): string

/**
 * 검증된 실존 path + size 버킷 → dataUrl|null. throw 금지.
 *   1) 캐시 HIT → 즉시 반환
 *   2) size > THUMB_MAX_BYTES → null (캐시 안 함)
 *   3) 세마포어 acquire → decodeResize → isEmpty/예외/빈 → null(캐시 안 함)
 *   4) 성공 dataUrl → lruSet 후 반환
 */
export async function getThumbnailDataUrl(
  req: { path: string; size: number },
  deps?: Partial<ThumbnailServiceDeps>
): Promise<string | null>

export function thumbnailCacheSize(): number // 테스트/진단(상한 검증)
```

**핵심 구현 메모(시그니처 수준 — 구현 X)**
- `decodeResize` 기본 구현:
  ```ts
  const img = nativeImage.createFromPath(path)   // 동기
  if (img.isEmpty()) return null                 // 미지원/손상 → 폴백
  const resized = img.resize({ width: size, height: size, quality: 'good' })
  const url = resized.toDataURL()
  return url || null
  ```
  `createFromPath` 는 동기이므로 **세마포어로 동시 진입을 4로 제한**(연속 대용량 디코드가
  main 이벤트루프를 길게 점유하는 것을 방지). 큐는 Promise 기반 경량 세마포어(외부 의존 0).
- LRU: icon.ts 의 `lruGet`/`lruSet`(Map 삽입순 = LRU, 상한 초과 시 첫 키 evict) **그대로 복제**.
- 실패(크기초과·isEmpty·예외·빈 url)는 **캐시 미저장** → 같은 셀 재요청 시 재시도 가능(icon.ts 동일).
- `resize` 정사각 `width/height` 동일 → nativeImage 가 종횡비 보존(한 변 기준). 셀은 contain 으로
  렌더(§5)하므로 정사각 강제 왜곡 없음. (대안: width 만 지정해 비율 보존 — 구현 시 reviewer 합의.)

### 3.2 핸들러 — `src/main/ipc/preview.handlers.ts` 확장
`registerPreviewHandlers()` 내부에 `preview:thumbnail` 핸들러 추가(기존 preview:read 핸들러 곁):
```ts
ipcMain.handle(CHANNELS.PREVIEW_THUMBNAIL, async (event, raw): Promise<Result<ThumbnailRes>> => {
  if (!isTrustedSender(event)) return err(untrustedSenderError())
  const parsed = parseArgs(zThumbnailReq, raw)
  if (!parsed.ok) return parsed as Result<ThumbnailRes>
  const g = guardPath(parsed.value.path)        // 정규화·상위이탈 차단
  if (!g.ok) return g as Result<ThumbnailRes>
  // 존재 확인은 getThumbnailDataUrl 의 statSize/디코드 예외가 null 로 흡수(icon.ts 와 동형).
  const dataUrl = await getThumbnailDataUrl({ path: g.value, size: parsed.value.size })
  return ok({ dataUrl })                        // 폴백도 ok({dataUrl:null}) — 예외 아님
})
```
> shell.handlers 의 `shell:icon` 4단계(sender→parseArgs→guardPath→추출, 실패=부드러운 폴백)와
> 동일 골격. 등록은 이미 `registerPreviewHandlers()` 가 `index.ts` 에 연결돼 있어 **추가 변경 불요**.

### 3.3 등록 — `src/main/ipc/index.ts`
변경 없음(`registerPreviewHandlers()` 이미 등록됨 — 핸들러만 그 함수 안에 추가).

---

## 4. 프런트 — 썸네일 캐시 (infra)

### 4.1 신규 `src/renderer/infra/icon/thumbnailCache.ts` (iconCache.ts 1:1 동형)
```ts
const cache = new Map<string, string>()        // key(path::size) → dataUrl. 성공만.
const inflight = new Map<string, Promise<void>>()
const subscribers = new Set<() => void>()

export function thumbnailKeyFor(path: string, size: number): string  // `${path}::${size}`
export function getCachedThumbnail(key: string): string | undefined
export function subscribeThumbnail(cb: () => void): () => void

/**
 * 썸네일 로드 트리거. 캐시/in-flight 면 공유(디듀프). 성공 dataUrl 만 캐시+notify.
 * 폴백(dataUrl===null)·빈문자·에러는 **음성 캐시**(NEG)로 잠깐 기억 → 같은 셀이
 * 매 렌더마다 재요청하는 폭주를 막되, OSIcon 폴백이 즉시 보이게 한다.
 */
export function requestThumbnail(path: string, size: number): Promise<void>
```
**iconCache 와의 차이(주의)**
- icon.ts 폴백은 "다음 가시 항목의 같은 ext 키"로 재시도되지만, 썸네일 키는 **path별 고유**라
  실패를 전혀 캐시 안 하면 **같은 이미지 셀이 매번 재요청**된다(특히 손상 파일이 화면에 머물 때).
  → **NEG 마커(예 `null` 또는 `''` 상수)를 별도 `negCache`(작은 LRU)에 저장**해 "이 path+size 는
  당분간 폴백"으로 기억한다. (영구 폐기 아님 — negCache 상한/TTL 로 재시도 여지 유지.)
  대안: 백엔드가 이미 실패 비캐싱이므로 프런트도 무캐싱하되 **컴포넌트가 1회만 요청**하도록
  `useEffect` 의존성으로 디듀프(아래 §5) — reviewer 와 둘 중 택1 합의. **권장: 프런트 negCache.**
- 호출은 `previewApi.thumbnail(path, size)`(§4.3) 경유.

### 4.2 유스케이스 경계 — `src/renderer/app/usecases/icons.ts`(또는 신규 `thumbnails.ts`)
ui→infra 직접 import 금지 규칙상 얇은 재노출 추가:
```ts
export {
  thumbnailKeyFor, getCachedThumbnail, requestThumbnail, subscribeThumbnail
} from '@renderer/infra/icon/thumbnailCache'
```
> icons.ts 에 합치거나 `usecases/thumbnails.ts` 신설(둘 다 가능 — 파일 응집상 신규 권장).

### 4.3 infra/api 어댑터 — `src/renderer/infra/api/index.ts`
`previewApi` 에 메서드 추가:
```ts
export const previewApi = {
  read: (path) => bridge().preview.read({ path }),
  /** preview:thumbnail — 그리드 이미지 셀 썸네일 dataUrl(폴백 시 null). */
  thumbnail: (path: string, size: number): Promise<Result<ThumbnailRes>> =>
    bridge().preview.thumbnail({ path, size })
}
```

### 4.4 preload — `src/preload/api.ts`
`ExplorerApi.preview` 에 시그니처 + 구현 추가:
```ts
readonly preview: {
  read(req: PreviewReadReq): Promise<Result<PreviewData>>
  thumbnail(req: ThumbnailReq): Promise<Result<ThumbnailRes>>
}
// 구현:
preview: {
  read: (req) => invoke(CHANNELS.PREVIEW_READ, req),
  thumbnail: (req) => invoke(CHANNELS.PREVIEW_THUMBNAIL, req)
}
```

---

## 5. 프런트 — 그리드 셀 썸네일 소비 (FileListView)

### 5.1 이미지 판정 공유 헬퍼 (D5)
신규 `src/shared/image.ts`(또는 `renderer/domain/image.ts`) — main·renderer 공유:
```ts
/** nativeImage 시도 대상 래스터 확장자(소문자, '.' 제외). webp 는 시도하되 실패 시 폴백. */
const THUMBNAIL_EXTS = new Set(['png','jpg','jpeg','gif','bmp','ico','webp'])
export function isThumbnailableExt(ext: string): boolean
export const THUMB_SIZE_BUCKETS = new Set([64, 96, 128, 192, 256])
```
> `shared/` 에 두면 guard.ts(zThumbnailReq)·thumbnail.ts·FileListView 가 동일 출처를 공유.
> domain 은 contracts 를 import 못하지만 순수 상수/함수라 무방. (eslint 경계: shared 는 양쪽 허용.)

### 5.2 셀 px → size 버킷 산출 (DPR 고려)
`gridCellFor(viewMode).icon` = {64, 48, 32}(large/medium/small). DPR(`window.devicePixelRatio`)
곱해 버킷에 스냅:
- large(64) × DPR2 = 128, small(32) × DPR2 = 64 …  → `THUMB_SIZE_BUCKETS` 중 ≥ 목표 최소값 선택.
- 헬퍼 `thumbSizeFor(iconPx: number, dpr: number): number`(셀러 버킷 스냅) — `ui/theme` 또는 위 shared.

### 5.3 FileListView 변경 — 신규 `ThumbnailIcon` 컴포넌트 + 그리드 분기
**변경 지점: `FileRow` 의 `if (grid) { ... }` 블록(line ~680–731)의 아이콘 `<span>` 내부.**
현재 그리드 셀은 무조건 `<OSIcon entry size={grid.icon} />`. 이를 다음으로 교체:
```tsx
// 그리드 셀이고 이미지면 썸네일 시도, 아니면(또는 폴백) OSIcon.
{!entry.isDir && isThumbnailableExt(entry.ext.toLowerCase())
  ? <ThumbnailIcon entry={entry} size={grid.icon} />
  : <OSIcon entry={entry} size={grid.icon} />}
```
신규 `ThumbnailIcon`(OSIcon 동형 — useSyncExternalStore 구독):
```tsx
function ThumbnailIcon({ entry, size }: { entry: FileEntryDTO; size: number }): JSX.Element {
  const px = thumbSizeFor(size, window.devicePixelRatio || 1)  // 버킷 size
  const key = thumbnailKeyFor(entry.path, px)
  const dataUrl = useSyncExternalStore(subscribeThumbnail, () => getCachedThumbnail(key))
  useEffect(() => {
    if (getCachedThumbnail(key) === undefined) void requestThumbnail(entry.path, px)
  }, [key, entry.path, px])
  if (dataUrl) {
    return <img src={dataUrl} width={size} height={size} alt="" draggable={false}
             style={{ objectFit: 'contain' }} />
  }
  // 미로드/폴백(null) → OSIcon (기존 H6). 로딩 중에도 OSIcon 이 자연스러운 자리표시.
  return <OSIcon entry={entry} size={size} />
}
```
**가시 셀만 요청 보장**: FileRow 는 윈도잉 루프(`for i in [startIdx,endIdx)`, line 501)에서만
생성되므로, `ThumbnailIcon` 의 `useEffect` 요청은 **가시 + 오버스캔 셀에서만** 발생한다(추가 작업
불요 — 기존 가상 스크롤이 가시성 게이트). 스크롤로 셀이 벗어나면 언마운트 → 신규 요청 중단.

> **셀렉터 격리(SA §5.2)**: thumbnailCache 는 store 밖 전역 모듈 + useSyncExternalStore 구독으로
> OSIcon/iconCache 와 동일하게 패널 store 슬라이스를 오염시키지 않는다.

### 5.4 details/list 무변
`FileRow` 의 비-grid 분기(line ~753–)는 `<OSIcon entry />`(16px) 그대로 — **변경 없음**.

---

## 6. 변경 파일 일람 (시그니처/변경지점)

| 파일 | 변경 | 핵심 |
|------|------|------|
| `src/shared/ipc/channels.ts` | +1 상수 | `PREVIEW_THUMBNAIL`(EVENT_CHANNELS 무변) |
| `src/shared/ipc/contracts.ts` | +2 iface, +1 맵 | `ThumbnailReq`/`ThumbnailRes` + IpcRequestMap |
| `src/shared/image.ts` (신규) | 신규 | `isThumbnailableExt`·`THUMBNAIL_EXTS`·`THUMB_SIZE_BUCKETS`·`thumbSizeFor` |
| `src/main/ipc/guard.ts` | +1 스키마 | `zThumbnailReq`(size 버킷 화이트리스트) |
| `src/main/os/thumbnail.ts` (신규) | 신규 | `getThumbnailDataUrl`·LRU·세마포어·크기상한·헤드리스 deps |
| `src/main/ipc/preview.handlers.ts` | +1 핸들러 | `preview:thumbnail`(shell:icon 골격) |
| `src/renderer/infra/icon/thumbnailCache.ts` (신규) | 신규 | iconCache 동형 + negCache |
| `src/renderer/app/usecases/thumbnails.ts` (신규) | 신규 | 캐시 재노출(ui→infra 금지 경계) |
| `src/renderer/infra/api/index.ts` | +1 메서드 | `previewApi.thumbnail` |
| `src/preload/api.ts` | +1 시그/구현 | `preview.thumbnail` |
| `src/renderer/ui/panel/views/FileListView.tsx` | 그리드 분기 + `ThumbnailIcon` | 그리드 셀만 이미지→썸네일, 폴백 OSIcon |

> `src/main/ipc/index.ts` 무변(registerPreviewHandlers 기존 등록).

---

## 7. DoD (완료 기준)

- [ ] `icons-large/medium/small` 에서 png/jpg/jpeg/gif/bmp/ico 가 **실제 내용 썸네일**로 표시.
- [ ] webp/svg/tiff·손상·`isEmpty()`·>30MB → **OSIcon 폴백**(빈칸·깨짐 없음).
- [ ] details/list 보기 = 기존 16px OS 아이콘(바이트 동등, 회귀 0).
- [ ] **가시 + 오버스캔 셀만** `preview:thumbnail` 요청(스크롤 전 1만개 폴더에서 IPC 폭주 없음).
- [ ] 백엔드 LRU 상한(256) 준수(`thumbnailCacheSize()` 검증), 실패 비캐싱.
- [ ] 프런트 in-flight 디듀프(같은 path+size 동시요청 IPC 1회) + negCache 로 폴백 셀 재요청 억제.
- [ ] main 비차단: 동시 디코드 ≤ 4(세마포어). 대용량 폴더 스크롤 중 UI 프리즈 없음.
- [ ] 전달은 **data URL 만**(파일 바이트/blob URL 미노출) — 기존 CSP `data:` 허용 범위 내.
- [ ] 셀렉터 격리: thumbnailCache 가 패널 store 미오염(전역 모듈 + useSyncExternalStore).
- [ ] sender·zod(size 버킷 화이트리스트)·guardPath 가드 통과(임의 size·상위이탈 거부).
- [ ] 빌드/타입체크 통과, contracts 동결 타입과 정합.

---

## 8. QA 포인트 (qa-engineer 검증)

1. **이미지=썸네일**: 각 지원 확장자 샘플 → `<img src=data:image/...>` 렌더(OSIcon 아님) 확인.
2. **폴백 매트릭스**: 비이미지/webp(디코드 실패 시)/0바이트/손상헤더/>30MB/미존재 → OSIcon.
3. **가시 셀만**: 대용량(1만) 폴더에서 스크롤 전 IPC 호출 수 = 가시+오버스캔 셀 수 이하(경계면 교차).
4. **캐시**: 같은 셀 재스크롤 시 캐시 HIT(IPC 미발생). 백엔드 LRU 상한 초과 시 evict.
5. **비차단**: 디코드 세마포어 ≤ 4(헤드리스 deps 로 동시 진입 카운트 검증).
6. **보안**: 응답 dataUrl 만, `file://`/blob URL 부재. guardPath 상위이탈(`..`)·임의 size 거부.
7. **셀렉터 격리**: 썸네일 로드가 다른 패널 리렌더를 유발하지 않음(구독 격리).
8. **회귀**: details/list·폴더·비이미지 셀 = 기존 OSIcon 바이트 동등.

---

## 9. 리스크 / 에스컬레이션

| 리스크 | 영향 | 완화 |
|--------|------|------|
| **nativeImage 형식 한계** (webp/svg/tiff `isEmpty()` 또는 디코드 실패) | 일부 이미지가 썸네일 대신 OSIcon | D5 "시도 후 폴백" + negCache. webp 는 Electron/Chromium 버전에 따라 가변 → QA 매트릭스로 실측 |
| **main 블로킹** (`createFromPath`/`resize` 동기, 대용량 연속 디코드) | UI 프리즈 | 세마포어(4) + 크기상한(30MB). 필요 시 상한/동시수 reviewer 합의로 조정 |
| **대용량 폴더 메모리** (dataUrl 누적) | RSS 증가 | 백엔드 LRU(256)·프런트 캐시 + negCache 상한. 가시 셀만 요청이라 자연 상한 |
| **DPR 다중 모니터** (이동 시 px 버킷 변동 → 재요청) | 캐시 미스 1회 | 버킷 스냅으로 변동 최소화. 과하면 DPR 고정(2)로 단순화 reviewer 합의 |
| **정사각 resize 왜곡** | 비정사각 이미지 종횡비 | `objectFit:contain` 렌더 + (대안) width-only resize. 구현 시 택1 |
| **신규 채널 동결 논쟁** | 설계 정합성 | invoke 신규 선례(I/J/K장) 명시 — reviewer 확인 |

**에스컬레이션(PM)**: (a) THUMB_MAX_BYTES/concurrency 기본값이 성능 목표 미달, (b) webp 폴백률이
높아 UX 불만 → 별도 디코더 도입 필요, (c) 정사각 vs 비율보존 UX 결정 — 이 3건은 스코프/UX 변경이라
PM→사용자 결정.

---

## 10. 분담

| 담당 | 작업 | 의존 |
|------|------|------|
| **backend-dev** | `shared/image.ts`(상수 부분) → `shared/ipc/{channels,contracts}` → `guard.ts zThumbnailReq` → `os/thumbnail.ts`(LRU·세마포어·헤드리스 deps) → `preview.handlers` 핸들러 | 계약 먼저 합의 후 서비스 |
| **frontend-dev** | `infra/icon/thumbnailCache.ts`(+negCache) → `usecases/thumbnails.ts` → `infra/api previewApi.thumbnail` → `preload preview.thumbnail` → `FileListView` `ThumbnailIcon`·그리드 분기 + `thumbSizeFor` | 2.2 계약·DTO 합의 후 병렬 |
| **공통(테크리드 중재)** | `shared/image.ts`·`THUMB_SIZE_BUCKETS`·`ThumbnailReq/Res` shape 를 **인터페이스 먼저** 합의(양측 차단 해제) | 최우선 |
| **qa-engineer** | §8 매트릭스(폴백·가시셀·캐시·세마포어·보안·셀렉터격리·회귀) | 백/프런트 통합 직후 |

**통합 순서**: ① 계약(channels/contracts/image 상수) 합의·머지 → ② 백엔드 thumbnail 서비스+핸들러,
프런트 캐시+api 병렬 → ③ FileListView 소비 통합(경계면: ThumbnailRes shape·size 버킷 일치 검증)
→ ④ qa 점진 검증.
