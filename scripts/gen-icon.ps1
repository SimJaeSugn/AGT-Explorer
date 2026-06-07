# gen-icon.ps1 - Generate the Explorer app icon (overlapping multi-folders, warm tone).
# Renders 16/32/48/64/128/256 px natively with System.Drawing and packs them into
# a single multi-size .ico (PNG-encoded entries). Output: resources/icon.ico
#
# Re-run this whenever the icon design changes. ASCII-only on purpose (no BOM needed).

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'resources'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$icoPath = Join-Path $outDir 'icon.ico'
$pngPath = Join-Path $outDir 'icon.png'

function New-RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $d = $r * 2
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($d -le 0) { $p.AddRectangle((New-Object System.Drawing.RectangleF($x, $y, $w, $h))); return $p }
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function Draw-Folder([System.Drawing.Graphics]$g, [single]$x, [single]$y, [single]$w, [single]$h,
    [System.Drawing.Color]$cTop, [System.Drawing.Color]$cBot, [System.Drawing.Color]$cTab,
    [System.Drawing.Color]$outline, [single]$penW) {
    $r = $h * 0.11
    $tabW = $w * 0.42
    $tabH = $h * 0.22
    # Back tab
    $tab = New-RoundRect $x $y $tabW ($tabH + $r * 2) ($r * 0.8)
    $bTab = New-Object System.Drawing.SolidBrush $cTab
    $g.FillPath($bTab, $tab)
    # Body with vertical gradient
    $bodyRect = New-Object System.Drawing.RectangleF($x, ($y + $tabH), $w, ($h - $tabH))
    $body = New-RoundRect $x ($y + $tabH) $w ($h - $tabH) $r
    $lg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bodyRect, $cTop, $cBot, 90)
    $g.FillPath($lg, $body)
    if ($penW -gt 0) {
        $pen = New-Object System.Drawing.Pen($outline, $penW)
        $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
        $g.DrawPath($pen, $body)
        $pen.Dispose()
    }
    $bTab.Dispose(); $tab.Dispose(); $lg.Dispose(); $body.Dispose()
}

function Render-Icon([int]$S) {
    $bmp = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $f = [single]$S

    # Soft shadow under the front folder (skip on tiny sizes to avoid mush).
    if ($S -ge 48) {
        $shadow = New-RoundRect ($f * 0.30) ($f * 0.37) ($f * 0.60) ($f * 0.52) ($f * 0.06)
        $sb = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(55, 0, 0, 0))
        $g.FillPath($sb, $shadow); $sb.Dispose(); $shadow.Dispose()
    }

    # Back folder (up-left, darker amber)
    Draw-Folder $g ($f * 0.09) ($f * 0.13) ($f * 0.58) ($f * 0.49) `
    ([System.Drawing.Color]::FromArgb(255, 240, 163, 48)) `
    ([System.Drawing.Color]::FromArgb(255, 224, 138, 28)) `
    ([System.Drawing.Color]::FromArgb(255, 215, 122, 18)) `
    ([System.Drawing.Color]::FromArgb(0, 0, 0, 0)) 0

    # Front folder (down-right, lighter amber, white outline for separation)
    $pen = if ($S -ge 32) { [single]([math]::Max(1.0, $S * 0.018)) } else { 0 }
    Draw-Folder $g ($f * 0.30) ($f * 0.33) ($f * 0.60) ($f * 0.52) `
    ([System.Drawing.Color]::FromArgb(255, 255, 210, 122)) `
    ([System.Drawing.Color]::FromArgb(255, 255, 178, 62)) `
    ([System.Drawing.Color]::FromArgb(255, 255, 200, 105)) `
    ([System.Drawing.Color]::FromArgb(235, 255, 255, 255)) $pen

    $g.Dispose()
    return $bmp
}

function Get-PngBytes([System.Drawing.Bitmap]$bmp) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return , $bytes
}

$sizes = @(256, 128, 64, 48, 32, 16)
$pngs = @{}
foreach ($s in $sizes) {
    $bmp = Render-Icon $s
    if ($s -eq 256) { $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png) }
    $pngs[$s] = Get-PngBytes $bmp
    $bmp.Dispose()
}

# Assemble multi-size ICO (PNG-encoded entries; Windows Vista+ supports this).
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0)            # reserved
$bw.Write([uint16]1)            # type: icon
$bw.Write([uint16]$sizes.Count) # image count
$offset = 6 + 16 * $sizes.Count
foreach ($s in $sizes) {
    $len = $pngs[$s].Length
    $dim = if ($s -ge 256) { 0 } else { $s }   # 0 means 256 in ICO spec
    $bw.Write([byte]$dim)        # width
    $bw.Write([byte]$dim)        # height
    $bw.Write([byte]0)           # palette colors
    $bw.Write([byte]0)           # reserved
    $bw.Write([uint16]1)         # color planes
    $bw.Write([uint16]32)        # bits per pixel
    $bw.Write([uint32]$len)      # bytes of image data
    $bw.Write([uint32]$offset)   # offset of image data
    $offset += $len
}
foreach ($s in $sizes) { $bw.Write($pngs[$s]) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()

$icoKB = [math]::Round((Get-Item $icoPath).Length / 1KB, 1)
Write-Host "OK: $icoPath ($icoKB KB, sizes: $($sizes -join '/')) + icon.png"
