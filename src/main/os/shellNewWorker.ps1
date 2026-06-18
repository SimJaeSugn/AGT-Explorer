# shellNewWorker.ps1 — "새로 만들기" ShellNew 워커 (§Y2 · ADR-005)
#
# 단발(one-shot) stdin/stdout JSON 프로토콜: 요청 JSON 1줄을 stdin 으로 받아 처리하고
# 응답 JSON 1줄을 stdout 으로 출력한 뒤 종료한다. 경로·확장자는 stdin 본문($req.*)으로만
# 사용한다 — 명령행/스크립트 문자열 합성 0(ADR-005 · shellVerbsWorker 선례).
#
# 지원 범위: 안전 3종만 — NullFile(빈 파일)·FileName(템플릿 복사)·Data(바이너리 기록).
#   Command 타입(바로 가기 등 임의 명령)은 제외(목록에 미노출·생성 불가).
#
# 레지스트리는 .NET [Microsoft.Win32.Registry] API 로 직접 읽는다(Get-ChildItem 의 객체
# 래핑 오버헤드 회피 — HKCR 전체 열거를 1초 미만으로 단축).
#
# 요청(list)  : { "op":"list" }
# 요청(create): { "op":"create", "dir":"<절대경로>", "id":"<.확장자>", "label":"<형식명>" }
# 응답(list)  : { "ok":true, "items":[ { "id":".txt", "ext":".txt", "label":"텍스트 문서" }, ... ] }
# 응답(create): { "ok":true, "name":"<생성된 파일명>" }  /  { "ok":false, "code":"ENOENT"|"EUNKNOWN" }

$ErrorActionPreference = 'Stop'
# 인코딩 — stdin/stdout 모두 UTF-8(PS 5.1 한글 표시명/경로 깨짐 방지).
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { [Console]::InputEncoding = [Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [Text.Encoding]::UTF8

# 한국어 리터럴은 코드포인트로 구성한다(ASCII-only 스크립트). PS 5.1 은 BOM 없는 .ps1 을
# 시스템 ANSI 코드페이지로 읽어 본문 내 한글 리터럴이 깨지므로(파일명 잘못된 문자 → 생성
# 실패), 실행에 쓰이는 한글은 비-주석에 직접 쓰지 않는다(주석의 한글은 무해).
$KO_NEW = [string][char]0xC0C8                      # "새"
$KO_FILE = [string][char]0xD30C + [string][char]0xC77C  # "파일"

function Write-Json($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 5
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

# .확장자 의 ShellNew 키를 연다: `.ext\ShellNew`(직접) 또는 `.ext\<progid>\ShellNew`
# (한 단계 아래). 없으면 $null. 호출측이 반환된 키를 Close 한다.
function Open-ShellNew($root, $ext) {
  $direct = $root.OpenSubKey("$ext\ShellNew")
  if ($direct) { return $direct }
  $extKey = $root.OpenSubKey($ext)
  if ($extKey) {
    try {
      foreach ($sub in $extKey.GetSubKeyNames()) {
        $k = $root.OpenSubKey("$ext\$sub\ShellNew")
        if ($k) { return $k }
      }
    } finally { $extKey.Close() }
  }
  return $null
}

# ShellNew 키에서 생성 방식 판정(안전 3종: FileName > Data > NullFile).
# Handler(CLSID 기반 COM 생성)·Command(임의 명령 실행)가 있으면 NullFile 등이 함께 있어도
# 제외한다 — 빈 파일로 만들면 깨지는 복잡 타입(바로 가기 .lnk·라이브러리 .library-ms 등).
function Get-MethodFromKey($snKey) {
  $vals = $snKey.GetValueNames()
  if (($vals -contains 'Handler') -or ($vals -contains 'Command')) { return $null }
  if ($vals -contains 'FileName') { return @{ method = 'filename'; value = $snKey.GetValue('FileName') } }
  if ($vals -contains 'Data')     { return @{ method = 'data';     value = $snKey.GetValue('Data') } }
  if ($vals -contains 'NullFile') { return @{ method = 'nullfile' } }
  return $null
}

# 친숙한 형식명: HKCR\.ext\(default) → progid → HKCR\progid\(default). 없으면 $null.
function Get-Label($root, $ext) {
  $extKey = $root.OpenSubKey($ext)
  if (-not $extKey) { return $null }
  $progid = $null
  try { $progid = $extKey.GetValue('') } finally { $extKey.Close() }
  if ($progid) {
    $pk = $root.OpenSubKey([string]$progid)
    if ($pk) {
      $name = $null
      try { $name = $pk.GetValue('') } finally { $pk.Close() }
      if ($name) { return [string]$name }
    }
  }
  return $null
}

function Do-List {
  $root = [Microsoft.Win32.Registry]::ClassesRoot
  $items = New-Object System.Collections.ArrayList
  foreach ($ext in $root.GetSubKeyNames()) {
    # 확장자 형식만(.alnum) — progid·비정상 키 제외.
    if ($ext.Length -lt 2 -or $ext[0] -ne '.') { continue }
    if ($ext -notmatch '^\.[A-Za-z0-9_.+-]+$') { continue }
    $snKey = Open-ShellNew $root $ext
    if (-not $snKey) { continue }
    $m = $null
    try { $m = Get-MethodFromKey $snKey } finally { $snKey.Close() }
    if (-not $m) { continue }   # 안전 3종이 아니면(Command 전용) 제외
    $label = Get-Label $root $ext
    if (-not $label) { $label = "$($ext.TrimStart('.').ToUpper()) $KO_FILE" }
    [void]$items.Add([pscustomobject]@{ id = $ext; ext = $ext; label = $label })
  }
  Write-Json @{ ok = $true; items = $items }
}

# 대상 폴더에서 충돌 없는 파일명을 만든다("<stem> (n)<ext>", 최대 50).
function Get-UniqueName($dir, $baseName) {
  if (-not (Test-Path -LiteralPath (Join-Path $dir $baseName))) { return $baseName }
  $stem = [System.IO.Path]::GetFileNameWithoutExtension($baseName)
  $ext  = [System.IO.Path]::GetExtension($baseName)
  for ($n = 2; $n -le 50; $n++) {
    $cand = "$stem ($n)$ext"
    if (-not (Test-Path -LiteralPath (Join-Path $dir $cand))) { return $cand }
  }
  return "$stem ($([guid]::NewGuid().ToString('N')))$ext"
}

function Do-Create($dir, $id, $label) {
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
    Write-Json @{ ok = $false; code = 'ENOENT' }; return
  }
  $root = [Microsoft.Win32.Registry]::ClassesRoot
  $snKey = Open-ShellNew $root $id
  if (-not $snKey) { Write-Json @{ ok = $false; code = 'EUNKNOWN' }; return }
  $m = $null
  try { $m = Get-MethodFromKey $snKey } finally { $snKey.Close() }
  if (-not $m) { Write-Json @{ ok = $false; code = 'EUNKNOWN' }; return }

  # 기본 파일명: "새 <형식명><확장자>"(파일명 금지문자 제거). 형식명이 비면 확장자만.
  $safe = ($label -replace '[\\/:*?"<>|]', '').Trim()
  $baseName = if ($safe) { "$KO_NEW $safe$id" } else { "$KO_NEW $KO_FILE$id" }
  $name = Get-UniqueName $dir $baseName
  $full = Join-Path $dir $name

  try {
    switch ($m.method) {
      'nullfile' { New-Item -ItemType File -Path $full -ErrorAction Stop | Out-Null }
      'data'     { [System.IO.File]::WriteAllBytes($full, [byte[]]$m.value) }
      'filename' {
        $tpl = [System.Environment]::ExpandEnvironmentVariables([string]$m.value)
        if (-not [System.IO.Path]::IsPathRooted($tpl)) {
          $tpl = Join-Path "$env:SystemRoot\ShellNew" $tpl
        }
        if (-not (Test-Path -LiteralPath $tpl)) { Write-Json @{ ok = $false; code = 'ENOENT' }; return }
        Copy-Item -LiteralPath $tpl -Destination $full -ErrorAction Stop
      }
      default { Write-Json @{ ok = $false; code = 'EUNKNOWN' }; return }
    }
  } catch {
    Write-Json @{ ok = $false; code = 'EUNKNOWN' }; return
  }
  Write-Json @{ ok = $true; name = $name }
}

# ── 진입: stdin 1줄 읽어 분기 → 1응답 → 종료 ─────────────────────────────
try {
  $line = [Console]::In.ReadLine()
  if ($line) {
    $req = $line | ConvertFrom-Json
    switch ($req.op) {
      'list'   { Do-List }
      'create' { Do-Create $req.dir $req.id $req.label }
      default  { Write-Json @{ ok = $false; code = 'EUNKNOWN' } }
    }
  } else {
    Write-Json @{ ok = $false; code = 'EUNKNOWN' }
  }
} catch {
  Write-Json @{ ok = $false; code = 'EUNKNOWN' }
}
