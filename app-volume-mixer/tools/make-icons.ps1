# Generates the static icons of the plugin (SVG for actions/category, PNG for the plugin icon).
# Usage: powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot "..\dev.appmixer.volume.sdPlugin\imgs"
$utf8 = New-Object Text.UTF8Encoding $false

function Write-Svg($rel, $body, $size, $viewBox) {
    $path = Join-Path $root "$rel.svg"
    New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
    if (-not $viewBox) { $viewBox = "0 0 $size $size" }
    $svg = "<svg xmlns=`"http://www.w3.org/2000/svg`" width=`"$size`" height=`"$size`" viewBox=`"$viewBox`">$body</svg>"
    [IO.File]::WriteAllText($path, $svg, $utf8)
}

$bg = '<rect width="144" height="144" fill="#141414"/>'
$stroke = 'stroke="#e6e6e6" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"'

# Mixer: three vertical sliders (monochrome, for the action list and the category)
$mixer20 = '<g fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"><path d="M4 3v14M10 3v14M16 3v14"/></g><g fill="#fff"><rect x="2" y="10" width="4" height="3" rx="1"/><rect x="8" y="5" width="4" height="3" rx="1"/><rect x="14" y="12" width="4" height="3" rx="1"/></g>'
Write-Svg "plugin/category-icon" $mixer20 20
Write-Svg "actions/app/icon" $mixer20 20

# Default key images (144x144), replaced at runtime by the plugin
$speaker = '<g fill="#9aa4b2"><path d="M36 58h18l24-21v70L54 86H36z"/></g><g fill="none" stroke="#9aa4b2" stroke-width="7" stroke-linecap="round"><path d="M90 52c9 9 9 31 0 40"/><path d="M101 41c16 16 16 46 0 62"/></g>'
Write-Svg "actions/app/key" ($bg + $speaker) 144

# Volume slider
Write-Svg "actions/slider/icon" '<rect x="6" y="2" width="8" height="16" rx="3" fill="none" stroke="#fff" stroke-width="1.6"/><rect x="6" y="10" width="8" height="8" rx="3" fill="#fff"/>' 20
Write-Svg "actions/slider/key" ($bg + '<rect x="44" y="10" width="56" height="124" rx="14" fill="#2a2a2a"/><rect x="44" y="72" width="56" height="62" rx="14" fill="#2f9bff"/>') 144

# Auto: two circular arrows around a speaker
$arcs = '<path d="M32.5 43.6A42 42 0 0 1 93 21.6" stroke="#2f9bff" stroke-width="9" stroke-linecap="round" fill="none"/><polygon points="102,27 97,13 88,29" fill="#2f9bff"/>'
$arcsWhite = $arcs.Replace('#2f9bff', '#ffffff').Replace('stroke-width="9"', 'stroke-width="11"')
$speakerAuto = '<path d="M59 50h9l11-10v36l-11-10h-9z" fill="#ffffff"/>'
Write-Svg "actions/auto/key" ($bg + $arcs + '<g transform="rotate(180 72 58)">' + $arcs + '</g>' + $speakerAuto + '<path d="M85 49c4 5 4 14 0 19" stroke="#ffffff" stroke-width="5" stroke-linecap="round" fill="none"/><text x="72" y="132" font-family="Segoe UI, Arial" font-weight="bold" font-size="26" text-anchor="middle" fill="#ffffff">AUTO</text>') 144
Write-Svg "actions/auto/icon" ($arcsWhite + '<g transform="rotate(180 72 58)">' + $arcsWhite + '</g>' + $speakerAuto) 20 "22 8 100 100"

# Navigation keys of the Auto profile
$back = 'M96 36 H58 a22 22 0 0 0 0 44 H84 M72 24 L96 36 L72 48'
Write-Svg "actions/back/key" ($bg + "<path d=`"$back`" $stroke/><text x=`"72`" y=`"128`" font-family=`"Segoe UI, Arial`" font-size=`"20`" text-anchor=`"middle`" fill=`"#9aa4b2`">Back</text>") 144
Write-Svg "actions/back/icon" '<path d="M15 6H6.5a3.5 3.5 0 0 0 0 7H12M9 3L6 6l3 3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' 20
Write-Svg "actions/next/key" ($bg + "<path d=`"M54 26 L90 62 L54 98`" $stroke/>") 144
Write-Svg "actions/next/icon" '<path d="M7 4l6 6-6 6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' 20
Write-Svg "actions/prev/key" ($bg + "<path d=`"M90 26 L54 62 L90 98`" $stroke/>") 144
Write-Svg "actions/prev/icon" '<path d="M13 4l-6 6 6 6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' 20

# Plugin icon (PNG 256 and 512): blue rounded square with three sliders
Add-Type -AssemblyName System.Drawing
function Write-PluginPng($rel, $size) {
    $path = Join-Path $root "$rel.png"
    New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
    $bmp = New-Object Drawing.Bitmap $size, $size
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = "AntiAlias"
    $g.Clear([Drawing.Color]::Transparent)
    $k = $size / 256.0
    $r = 48 * $k
    $gp = New-Object Drawing.Drawing2D.GraphicsPath
    $gp.AddArc(0, 0, 2*$r, 2*$r, 180, 90); $gp.AddArc($size-2*$r, 0, 2*$r, 2*$r, 270, 90)
    $gp.AddArc($size-2*$r, $size-2*$r, 2*$r, 2*$r, 0, 90); $gp.AddArc(0, $size-2*$r, 2*$r, 2*$r, 90, 90); $gp.CloseFigure()
    $bgBrush = New-Object Drawing.Drawing2D.LinearGradientBrush((New-Object Drawing.Point 0,0), (New-Object Drawing.Point 0,$size), [Drawing.Color]::FromArgb(255,47,155,255), [Drawing.Color]::FromArgb(255,20,90,200))
    $g.FillPath($bgBrush, $gp)
    $pen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(220,255,255,255)), (14*$k)
    $pen.StartCap = "Round"; $pen.EndCap = "Round"
    $knob = New-Object Drawing.SolidBrush ([Drawing.Color]::White)
    $xs = 72, 128, 184; $ys = 150, 90, 170
    for ($i = 0; $i -lt 3; $i++) {
        $x = $xs[$i] * $k
        $g.DrawLine($pen, $x, 52*$k, $x, 204*$k)
        $g.FillEllipse($knob, $x - 22*$k, $ys[$i]*$k - 22*$k, 44*$k, 44*$k)
    }
    $g.Dispose()
    $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
Write-PluginPng "plugin/marketplace" 256
Write-PluginPng "plugin/marketplace@2x" 512
Write-Host "Icons generated in $root"
