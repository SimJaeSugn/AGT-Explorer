<#
.SYNOPSIS
    Explorer 설치 파일(NSIS 인스톨러)을 한 번에 빌드한다.

.DESCRIPTION
    의존성 점검 → 타입체크 + electron-vite 빌드 → electron-builder 패키징을
    순서대로 실행하고, 생성된 인스톨러(.exe) 경로를 출력한다.
    내부적으로 `npm run package`(= prebuild clean → typecheck → build → electron-builder)를
    호출하므로 별도의 사전 정리는 필요 없다.

.PARAMETER Install
    node_modules 존재 여부와 무관하게 `npm install`을 강제로 다시 실행한다.

.PARAMETER OpenFolder
    빌드 성공 후 산출물(dist) 폴더를 탐색기로 연다.

.EXAMPLE
    .\build-installer.ps1
    기본 빌드. node_modules가 없으면 자동으로 설치한 뒤 패키징한다.

.EXAMPLE
    .\build-installer.ps1 -Install -OpenFolder
    의존성을 새로 설치하고 빌드한 뒤 dist 폴더를 연다.
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$OpenFolder
)

$ErrorActionPreference = 'Stop'
$sw = [System.Diagnostics.Stopwatch]::StartNew()

# 스크립트 위치를 프로젝트 루트로 사용(어디서 실행해도 동일하게 동작).
$root = $PSScriptRoot
Set-Location $root

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "`n[실패] $msg" -ForegroundColor Red; exit 1 }

Write-Step "프로젝트 루트: $root"

# 1) npm 실행 파일 해석.
#    PowerShell에서 npm.ps1 셔임은 인자를 잘못 전달하는 경우가 있어
#    (예: `npm run package` → npm이 'pm'을 명령으로 인식) npm.cmd 를 우선 사용한다.
$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCmd) { $npmCmd = (Get-Command npm -ErrorAction SilentlyContinue).Source }
if (-not $npmCmd) {
    Fail "npm을 찾을 수 없습니다. Node.js(20 또는 22 LTS 권장)를 설치한 뒤 다시 실행하세요."
}

# 2) Node 버전 안내(빌드를 막지는 않음).
#    Node 24 Windows의 동기 fs.rmSync(recursive) 버그는 prebuild clean으로 우회되지만,
#    Electron 31과 동일한 Node 20 LTS 사용을 권장한다(package.json engines).
$nodeVer = (& node --version)
Write-Step "Node 버전: $nodeVer"
if ($nodeVer -match '^v(\d+)\.') {
    $major = [int]$Matches[1]
    if ($major -lt 20 -or $major -gt 22) {
        Write-Host "  경고: Node $nodeVer 는 권장 범위(20~22 LTS) 밖입니다. 빌드는 시도되지만 문제가 생기면 Node 20/22로 전환하세요." -ForegroundColor Yellow
    }
}

# 3) 의존성 설치(없거나 -Install 지정 시).
if ($Install -or -not (Test-Path (Join-Path $root 'node_modules'))) {
    if (Test-Path (Join-Path $root 'package-lock.json')) {
        Write-Step "의존성 설치: npm ci"
        & $npmCmd ci
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  npm ci 실패 — npm install로 폴백합니다." -ForegroundColor Yellow
            & $npmCmd install
            if ($LASTEXITCODE -ne 0) { Fail "의존성 설치 실패(npm install)." }
        }
    }
    else {
        Write-Step "의존성 설치: npm install"
        & $npmCmd install
        if ($LASTEXITCODE -ne 0) { Fail "의존성 설치 실패(npm install)." }
    }
}
else {
    Write-Step "의존성: node_modules 존재 — 설치 건너뜀 (-Install 로 강제 재설치 가능)"
}

# 4) 빌드 + 패키징(한 번에). package = prebuild clean → typecheck → electron-vite build → electron-builder.
Write-Step "빌드 + 패키징: npm run package"
& $npmCmd run package
if ($LASTEXITCODE -ne 0) { Fail "빌드/패키징 실패. 위 로그를 확인하세요." }

# 5) 산출물(인스톨러) 탐색 및 안내.
$distDir = Join-Path $root 'dist'
$installer = Get-ChildItem -Path $distDir -Filter '*.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike '*Uninstall*' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

$sw.Stop()
$elapsed = '{0:mm}분 {0:ss}초' -f $sw.Elapsed

if ($installer) {
    $sizeMB = [math]::Round($installer.Length / 1MB, 1)
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host " 빌드 완료 ($elapsed)" -ForegroundColor Green
    Write-Host " 인스톨러 : $($installer.FullName)" -ForegroundColor Green
    Write-Host " 크기      : $sizeMB MB" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green

    if ($OpenFolder) {
        Start-Process explorer.exe "/select,`"$($installer.FullName)`""
    }
}
else {
    Fail "패키징은 끝났지만 dist 폴더에서 인스톨러(.exe)를 찾지 못했습니다: $distDir"
}
