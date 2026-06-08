/**
 * RemoteDialog — 원격(FTP/SFTP) 연결 다이얼로그 (§M M3).
 *
 * 모달 패턴(TrashDialog 동형: overlay 클릭 닫기·stopPropagation·role=dialog·
 * aria-modal·Esc·useFocusTrap). 좌측 저장 프로필 목록(재접속·편집·삭제), 우측
 * 연결 폼(프로토콜·host·port·user·인증방식·비밀 입력·"저장" 체크).
 *
 * ⚠ 비밀(password/passphrase/privateKey)은 **컴포넌트 로컬 state** 에서만 다루고
 *   연결/저장 요청 본문으로 즉시 전달한 뒤 폼 닫힘과 함께 사라진다. 전역 store 에
 *   절대 넣지 않는다(ADR-007 ③⑥). type=password 입력 + autoComplete=off.
 *
 * 셀렉터 격리: 이 컴포넌트만 remoteSlice(프로필·연결상태)를 구독. IPC 는 usecases/remote 경유.
 */
import { useEffect, useRef, useState } from 'react'
import type { RemoteAuthMethod, RemoteProfileDTO, RemoteProtocol } from '@shared/dto'
import type { RemoteSecretInput } from '@renderer/domain/entities'
import { useRootStore } from '@renderer/app/stores/rootStore'
import {
  connectRemote,
  deleteProfile,
  loadProfiles,
  upsertProfile
} from '@renderer/app/usecases/remote'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { btn, overlayStyle, panelStyle, titleStyle } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'

/** 프로토콜 기본 포트 제안. */
function defaultPort(protocol: RemoteProtocol): number {
  return protocol === 'sftp' ? 22 : 21
}

/** 안정 id 생성(신규 프로필). 기존 프로필 편집은 그 id 유지. */
function makeProfileId(): string {
  return `remote-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: tokens.color.textMuted,
  marginBottom: 2,
  marginTop: 8
}
const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 28,
  boxSizing: 'border-box',
  padding: '0 8px',
  border: `1px solid ${tokens.color.border}`,
  borderRadius: 6,
  background: tokens.color.bg,
  color: tokens.color.text,
  fontSize: 13
}

export function RemoteDialog(): JSX.Element | null {
  const open = useRootStore((s) => s.remoteDialogOpen)
  const profiles = useRootStore((s) => s.remoteProfiles)
  const status = useRootStore((s) => s.remoteConnectStatus)
  const connectError = useRootStore((s) => s.remoteConnectError)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const firstFieldRef = useRef<HTMLSelectElement | null>(null)

  // 폼 상태(비밀 포함 — 로컬 state 한정, 닫힐 때 폐기).
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState<RemoteProtocol>('sftp')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(22)
  const [username, setUsername] = useState('')
  const [authMethod, setAuthMethod] = useState<RemoteAuthMethod>('password')
  const [secret, setSecret] = useState('') // ⚠ 비밀 — 로컬 state 한정.
  const [saveCred, setSaveCred] = useState(false)

  useFocusTrap(open, panelRef, { initialFocus: firstFieldRef })

  useEffect(() => {
    if (open) void loadProfiles()
  }, [open])

  // 비밀 초기화(닫힐 때마다 메모리에서 제거 — 영구 보관 금지).
  useEffect(() => {
    if (!open) {
      setSecret('')
      setSaveCred(false)
    }
  }, [open])

  // Esc 닫기(모달 패턴).
  useEffect(() => {
    if (!open) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        useRootStore.getState().closeRemoteDialog()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!open) return null

  function close(): void {
    setSecret('') // 닫기 직전 비밀 제거.
    useRootStore.getState().closeRemoteDialog()
  }

  function loadIntoForm(p: RemoteProfileDTO): void {
    setEditId(p.id)
    setName(p.name)
    setProtocol(p.protocol)
    setHost(p.host)
    setPort(p.port)
    setUsername(p.username)
    setAuthMethod(p.authMethod)
    setSecret('') // 비밀은 다시 입력(불러오지 않음).
    setSaveCred(false)
  }

  function resetForm(): void {
    setEditId(null)
    setName('')
    setProtocol('sftp')
    setHost('')
    setPort(22)
    setUsername('')
    setAuthMethod('password')
    setSecret('')
    setSaveCred(false)
  }

  function currentProfile(): RemoteProfileDTO {
    return {
      id: editId ?? makeProfileId(),
      name: name.trim() || host.trim(),
      protocol,
      host: host.trim(),
      port,
      username: username.trim(),
      authMethod
    }
  }

  function secretBody(): RemoteSecretInput | undefined {
    if (secret === '') return undefined
    const kind = authMethod === 'privateKey' ? 'privateKey' : 'password'
    return { kind, value: secret }
  }

  async function onConnect(): Promise<void> {
    if (host.trim() === '') {
      useRootStore.getState().pushToast('info', '호스트를 입력하세요.')
      return
    }
    const profile = currentProfile()
    const body = secretBody()
    // "저장" 체크 시 프로필+자격증명 영속(비밀은 요청 본문 전용).
    if (saveCred && body) {
      await upsertProfile(profile, body)
    } else if (editId === null && name.trim() !== '') {
      // 이름이 있으면 프로필만 저장(비밀 미저장).
      await upsertProfile(profile)
    }
    await connectRemote(profile, body)
    setSecret('') // 연결 요청 후 즉시 비밀 폐기.
  }

  const connecting = status === 'connecting'

  return (
    <div style={overlayStyle} onClick={close} role="dialog" aria-modal="true" aria-label="원격 연결">
      <div
        ref={panelRef}
        style={{ ...panelStyle, width: 720, maxWidth: '94vw', display: 'flex', gap: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 좌: 저장 프로필 목록 */}
        <div style={{ width: 220, flex: '0 0 220px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...titleStyle, marginBottom: 8 }}>저장된 연결</div>
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              border: `1px solid ${tokens.color.border}`,
              borderRadius: 6,
              minHeight: 160
            }}
            aria-label="프로필 목록"
          >
            {profiles.length === 0 && (
              <div style={{ padding: 10, fontSize: 12, color: tokens.color.textMuted }}>
                저장된 연결이 없습니다.
              </div>
            )}
            {profiles.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 8px',
                  borderBottom: `1px solid ${tokens.color.border}`,
                  background: editId === p.id ? tokens.color.bgSelected : 'transparent'
                }}
              >
                <button
                  onClick={() => loadIntoForm(p)}
                  title={`${p.protocol}://${p.username}@${p.host}:${p.port}`}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: tokens.color.text,
                    fontSize: 12,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {p.name || p.host}
                </button>
                <button
                  onClick={() => void deleteProfile(p.id)}
                  aria-label={`${p.name || p.host} 삭제`}
                  title="삭제"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: tokens.color.textMuted,
                    fontSize: 13
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button style={{ ...btn('default'), marginTop: 8 }} onClick={resetForm}>
            + 새 연결
          </button>
        </div>

        {/* 우: 연결 폼 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <h2 style={{ ...titleStyle, margin: 0 }}>원격 연결</h2>
            <button
              onClick={close}
              aria-label="닫기"
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 18,
                color: tokens.color.text
              }}
            >
              ✕
            </button>
          </div>

          <label style={labelStyle} htmlFor="rm-protocol">
            프로토콜
          </label>
          <select
            id="rm-protocol"
            ref={firstFieldRef}
            style={inputStyle}
            value={protocol}
            onChange={(e) => {
              const next = e.target.value as RemoteProtocol
              setProtocol(next)
              setPort(defaultPort(next))
              if (next !== 'sftp' && authMethod === 'privateKey') setAuthMethod('password')
            }}
          >
            <option value="sftp">SFTP (SSH)</option>
            <option value="ftps">FTPS (TLS)</option>
            <option value="ftp">FTP (평문·비암호화)</option>
          </select>
          {protocol === 'ftp' && (
            <div style={{ color: tokens.color.danger, fontSize: 11, marginTop: 4 }} role="alert">
              평문 FTP 는 자격증명·데이터가 암호화되지 않습니다.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle} htmlFor="rm-host">
                호스트
              </label>
              <input
                id="rm-host"
                style={inputStyle}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="example.com"
                autoComplete="off"
              />
            </div>
            <div style={{ width: 90, flex: '0 0 90px' }}>
              <label style={labelStyle} htmlFor="rm-port">
                포트
              </label>
              <input
                id="rm-port"
                type="number"
                style={inputStyle}
                value={port}
                min={1}
                max={65535}
                onChange={(e) => setPort(Number(e.target.value) || defaultPort(protocol))}
              />
            </div>
          </div>

          <label style={labelStyle} htmlFor="rm-user">
            사용자명
          </label>
          <input
            id="rm-user"
            style={inputStyle}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
          />

          {protocol === 'sftp' && (
            <>
              <label style={labelStyle} htmlFor="rm-auth">
                인증 방식
              </label>
              <select
                id="rm-auth"
                style={inputStyle}
                value={authMethod}
                onChange={(e) => setAuthMethod(e.target.value as RemoteAuthMethod)}
              >
                <option value="password">비밀번호</option>
                <option value="privateKey">개인 키</option>
              </select>
            </>
          )}

          <label style={labelStyle} htmlFor="rm-secret">
            {authMethod === 'privateKey' ? '개인 키(PEM)' : '비밀번호'}
          </label>
          {authMethod === 'privateKey' ? (
            <textarea
              id="rm-secret"
              style={{ ...inputStyle, height: 72, padding: 8, fontFamily: 'monospace', fontSize: 11 }}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              autoComplete="off"
              spellCheck={false}
            />
          ) : (
            <input
              id="rm-secret"
              type="password"
              style={inputStyle}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
            />
          )}

          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={saveCred} onChange={(e) => setSaveCred(e.target.checked)} />
            이 연결과 자격증명을 저장(안전하게 암호화)
          </label>

          <label style={labelStyle} htmlFor="rm-name">
            표시 이름(선택)
          </label>
          <input
            id="rm-name"
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={host || '예: 회사 서버'}
            autoComplete="off"
          />

          {status === 'error' && connectError && (
            <div style={{ color: tokens.color.danger, fontSize: 12, marginTop: 8 }} role="alert">
              {connectError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={btn('default')} onClick={close} disabled={connecting}>
              취소
            </button>
            <button style={btn('primary')} onClick={() => void onConnect()} disabled={connecting}>
              {connecting ? '연결 중…' : '연결'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
