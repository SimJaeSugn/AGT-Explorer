# shellVerbsWorker.ps1 — 상주 셸 verb 워커 (§Y1 · ADR-013 · ADR-005)
#
# stdin/stdout JSON 라인 프로토콜(1요청 = JSON 1줄 → 1응답 = JSON 1줄).
# 경로·verbId 는 stdin JSON 본문($req.path / $req.verbId)으로만 사용한다 —
# 명령행/스크립트 문자열 합성 0(ADR-005 §3.3-4 · showProperties 선례 동치).
# 블랙리스트는 ps1 이 아니라 Main(shellVerbsBlacklist.ts)에서 적용한다(언어 사전 단일 출처).
#
# 요청: { "id":"<id>", "op":"list"|"invoke"|"ping", "path":"<절대경로>", "verbId"?:"<index>:<display>" }
# 응답(list)  : { "id", "ok":true, "verbs":[ { "index":N, "name":"<원문>", "display":"<&제거>" }, ... ] }
# 응답(invoke): { "id", "ok":true }  /  { "id", "ok":false, "code":"EVERB"|"ENOENT"|"EUNKNOWN" }
# 응답(ping)  : { "id", "ok":true }

$ErrorActionPreference = 'Stop'
# 인코딩 — 권고① 흡수: stdout/stdin 모두 UTF-8(PS 5.1 한글 표시명/경로 깨짐 방지).
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { [Console]::InputEncoding = [Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [Text.Encoding]::UTF8

# COM Shell.Application 1회 생성(상주 — 매 요청 재생성 비용 회피).
$shell = $null
try { $shell = New-Object -ComObject Shell.Application } catch { $shell = $null }

function Get-ShellItem([string]$fullPath) {
  if ($null -eq $shell) { return $null }
  # [IO.Path] 사용(Split-Path 매개변수 집합 모호성 회피·로케일 무관). 경로는 stdin 본문.
  $dir = [System.IO.Path]::GetDirectoryName($fullPath)
  $leaf = [System.IO.Path]::GetFileName($fullPath)
  if ([string]::IsNullOrEmpty($dir) -or [string]::IsNullOrEmpty($leaf)) { return $null }
  $folder = $shell.NameSpace($dir)
  if ($null -eq $folder) { return $null }
  return $folder.ParseName($leaf)
}

# JSON 1줄 출력 + 즉시 flush.
function Write-Line($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 4
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $op = $req.op

    if ($op -eq 'ping') {
      Write-Line @{ id = $id; ok = $true }
      continue
    }

    if ($op -eq 'list') {
      $item = Get-ShellItem $req.path
      if ($null -eq $item) {
        Write-Line @{ id = $id; ok = $false; code = 'ENOENT' }
        continue
      }
      $verbs = @()
      $i = 0
      foreach ($v in $item.Verbs()) {
        $name = $v.Name
        if (-not [string]::IsNullOrEmpty($name)) {
          $verbs += @{ index = $i; name = $name; display = ($name -replace '&', '') }
        }
        $i++
      }
      # @($verbs) 강제로 단일 원소도 배열 유지(ConvertTo-Json 객체화 방지).
      Write-Line @{ id = $id; ok = $true; verbs = @($verbs) }
      continue
    }

    if ($op -eq 'invoke') {
      $item = Get-ShellItem $req.path
      if ($null -eq $item) {
        Write-Line @{ id = $id; ok = $false; code = 'ENOENT' }
        continue
      }
      # verbId = "<index>:<display>" — 첫 콜론까지 index, 나머지 display.
      $verbId = [string]$req.verbId
      $colon = $verbId.IndexOf(':')
      if ($colon -lt 0) {
        Write-Line @{ id = $id; ok = $false; code = 'EVERB' }
        continue
      }
      $wantIndex = -1
      [void][int]::TryParse($verbId.Substring(0, $colon), [ref]$wantIndex)
      $wantDisplay = $verbId.Substring($colon + 1)

      # 재열거 후 교차검증(스테일 메뉴로 오실행 방지 — ADR-013 결정③).
      $list = @()
      $j = 0
      foreach ($v in $item.Verbs()) {
        $list += @{ index = $j; verb = $v; display = ($v.Name -replace '&', '') }
        $j++
      }

      $chosen = $null
      # ① index 위치의 정규화 display 가 요청 display 와 일치 → 그 verb(빠른 경로 + 교차검증).
      if ($wantIndex -ge 0 -and $wantIndex -lt $list.Count) {
        if ($list[$wantIndex].display -eq $wantDisplay) {
          $chosen = $list[$wantIndex].verb
        }
      }
      # ② 불일치 → 전체에서 정규화 display 일치 첫 verb(표시명 매칭 폴백).
      if ($null -eq $chosen) {
        foreach ($e in $list) {
          if ($e.display -eq $wantDisplay) { $chosen = $e.verb; break }
        }
      }
      # ③ 없음 → 실행하지 않고 EVERB(오실행 < 미실행).
      if ($null -eq $chosen) {
        Write-Line @{ id = $id; ok = $false; code = 'EVERB' }
        continue
      }

      $chosen.DoIt()
      Write-Line @{ id = $id; ok = $true }
      continue
    }

    # 미지의 op.
    Write-Line @{ id = $id; ok = $false; code = 'EUNKNOWN'; message = 'unknown op' }
  }
  catch {
    $msg = $_.Exception.Message
    Write-Line @{ id = $id; ok = $false; code = 'EUNKNOWN'; message = $msg }
  }
}
