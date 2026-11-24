# Generates the static icons of the plugin (SVG for actions/category, PNG for the plugin icon).
# Usage: powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot "..\dev.sdmonitor.sdPlugin\imgs"
$utf8 = New-Object Text.UTF8Encoding $false

function Write-Svg($rel, $body, $size, $viewBox) {
    $path = Join-Path $root "$rel.svg"
    New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
    if (-not $viewBox) { $viewBox = "0 0 $size $size" }
    $svg = "<svg xmlns=`"http://www.w3.org/2000/svg`" width=`"$size`" height=`"$size`" viewBox=`"$viewBox`">$body</svg>"
    [IO.File]::WriteAllText($path, $svg, $utf8)
}

$bg = '<rect width="144" height="144" fill="#101114"/>'
$stroke = 'stroke="#e6e6e6" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"'

# Monochrome pulse/graph glyph (20x20) for the action list and the category
$pulse20 = '<path d="M2 11h3.5l2-6 3.5 11 2.5-8 1.5 3H18" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
Write-Svg "plugin/category-icon" $pulse20 20
Write-Svg "actions/metric/icon" $pulse20 20

# Default key image of the Metric action (replaced at runtime)
$spark = '<polygon points="12,132 12,108 30,100 48,112 66,92 84,104 102,84 120,96 132,88 132,132" fill="#4aa3ff" opacity="0.3"/><polyline points="12,108 30,100 48,112 66,92 84,104 102,84 120,96 132,88" fill="none" stroke="#4aa3ff" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>'
Write-Svg "actions/metric/key" ($bg + '<text x="72" y="30" font-family="Segoe UI, Arial" font-size="20" font-weight="600" fill="#9aa4b2" text-anchor="middle">CPU</text><text x="72" y="82" font-family="Segoe UI, Arial" font-size="46" font-weight="700" fill="#4aa3ff" text-anchor="middle">42%</text>' + $spark) 144

# Dashboard: 3x2 grid of tiles
$tiles = '<rect x="2" y="3" width="7" height="6" rx="1.2" fill="#fff"/><rect x="11" y="3" width="7" height="6" rx="1.2" fill="#fff"/><rect x="2" y="11" width="7" height="6" rx="1.2" fill="#fff"/><rect x="11" y="11" width="7" height="6" rx="1.2" fill="#fff" opacity=".55"/>'
Write-Svg "actions/dashboard/icon" $tiles 20
$big = '<rect x="18" y="20" width="48" height="40" rx="7" fill="#4aa3ff"/><rect x="78" y="20" width="48" height="40" rx="7" fill="#3fd17f"/><rect x="18" y="68" width="48" height="40" rx="7" fill="#b07cff"/><rect x="78" y="68" width="48" height="40" rx="7" fill="#ffb347"/>'
Write-Svg "actions/dashboard/key" ($bg + $big + '<text x="72" y="134" font-family="Segoe UI, Arial" font-size="19" font-weight="600" fill="#9aa4b2" text-anchor="middle">Monitor</text>') 144

# Back
$back = 'M96 36 H58 a22 22 0 0 0 0 44 H84 M72 24 L96 36 L72 48'
Write-Svg "actions/back/key" ($bg + "<path d=`"$back`" $stroke/><text x=`"72`" y=`"128`" font-family=`"Segoe UI, Arial`" font-size=`"20`" text-anchor=`"middle`" fill=`"#9aa4b2`">Back</text>") 144
Write-Svg "actions/back/icon" '<path d="M15 6H6.5a3.5 3.5 0 0 0 0 7H12M9 3L6 6l3 3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' 20

# Plugin icon (PNG 256 and 512): dark rounded square with a green pulse line
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
    $bgBrush = New-Object Drawing.Drawing2D.LinearGradientBrush((New-Object Drawing.Point 0,0), (New-Object Drawing.Point 0,$size), [Drawing.Color]::FromArgb(255,34,40,52), [Drawing.Color]::FromArgb(255,16,18,24))
    $g.FillPath($bgBrush, $gp)
    $pen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(255,63,209,127)), (16*$k)
    $pen.StartCap = "Round"; $pen.EndCap = "Round"; $pen.LineJoin = "Round"
    $pts = @(@(28,150), @(82,150), @(106,72), @(138,196), @(166,112), @(182,150), @(228,150))
    $arr = New-Object 'Drawing.PointF[]' $pts.Count
    for ($i = 0; $i -lt $pts.Count; $i++) { $arr[$i] = New-Object Drawing.PointF ([single]($pts[$i][0]*$k)), ([single]($pts[$i][1]*$k)) }
    $g.DrawLines($pen, $arr)
    $g.Dispose()
    $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
Write-PluginPng "plugin/marketplace" 256
Write-PluginPng "plugin/marketplace@2x" 512
Write-Host "Icons generated in $root"
