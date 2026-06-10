/**
 * libuv 스레드풀 크기 상향(프로세스 전역·부작용 모듈).
 *
 * 파일 작업 동시성(copy/move/delete)을 SSD 볼륨에서 최대 ~16 까지 올리므로(pickOpConcurrency),
 * 그 동시성이 실제로 병렬화되려면 fs 비동기 I/O 를 처리하는 libuv 스레드풀(기본 4)도 함께
 * 올려야 한다. UV_THREADPOOL_SIZE 는 **스레드풀 최초 사용 전**에 설정돼야 적용되므로, 다른
 * 모듈이 async I/O 를 시작하기 전에 평가되도록 main 엔트리(index.ts)의 **가장 첫 import** 로 둔다.
 *
 * 정직한 한계(best-effort): Electron 런타임이 이 모듈 평가 시점 이전에 이미 스레드풀을 초기화했다면
 * 이 설정이 늦어 반영되지 않을 수 있다. 사용자가 명시 지정한 값이 있으면 존중(덮어쓰지 않음).
 */

// 명시 지정이 없을 때만 16 으로 설정(존중). 16 = SSD same-volume/cross 동시성 상한(8/4)을 여유 있게 수용.
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = '16'

export {}
