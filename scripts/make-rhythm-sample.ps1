# Renders a realistic sheet (five-line staff, noteheads, stems, printed solfa)
# so the OCR + staff rhythm pipeline can be checked against a real PNG.
param(
  [string]$OutPng = (Join-Path $PSScriptRoot "rhythm-sample.png"),
  [string]$OutRgba = (Join-Path $PSScriptRoot "rhythm-sample.rgba")
)

Add-Type -AssemblyName System.Drawing

$width = 900
$height = 340
$spacing = 20
$left = 40
$right = 860

$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None

$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 2)
$font = New-Object System.Drawing.Font("Arial", 15, [System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.Brushes]::Black

function DrawStaffLines($top) {
  for ($i = 0; $i -lt 5; $i++) {
    $y = $top + $i * $spacing
    $g.DrawLine($pen, $left, $y, $right, $y)
  }
}

function MidY($top, [int]$step) { return $top + $step * ($spacing / 2) }

function DrawFilled($x, $y) { $g.FillEllipse($brush, $x - 10, $y - 7, 20, 14) }
function DrawHollow($x, $y) { $g.DrawEllipse($pen, $x - 10, $y - 7, 20, 14) }

# --- Bass staff: crotchet, minim, dotted crotchet ---
$bassTop = 60
DrawStaffLines $bassTop
DrawFilled 100 (MidY $bassTop 2)
DrawHollow 200 (MidY $bassTop 2)
DrawFilled 300 (MidY $bassTop 2)
foreach ($x in 110, 210, 310) { $g.DrawLine($pen, $x, (MidY $bassTop 2), $x, (MidY $bassTop 2) + 70) }
$g.FillEllipse($brush, 325, (MidY $bassTop 2) - 3, 6, 6)

# --- Soprano staff: two beamed quavers, then a semibreve ---
$sopTop = 230
DrawStaffLines $sopTop
DrawFilled 140 (MidY $sopTop 0)
DrawFilled 200 (MidY $sopTop 0)
foreach ($x in 130, 190) { $g.DrawLine($pen, $x, (MidY $sopTop 0) - 70, $x, (MidY $sopTop 0)) }
$g.FillRectangle($brush, 130, (MidY $sopTop 0) - 73, 63, 4)
DrawHollow 280 (MidY $sopTop 0)

$bassY = $bassTop + 4 * $spacing + 14
$g.DrawString("Bass", $font, $brush, 6, $bassY)
$g.DrawString("Do", $font, $brush, 88, $bassY)
$g.DrawString("Re", $font, $brush, 188, $bassY)
$g.DrawString("Mi", $font, $brush, 292, $bassY)

$sopY = $sopTop + 4 * $spacing + 6
$g.DrawString("Soprano", $font, $brush, 6, $sopY)
$g.DrawString("So", $font, $brush, 128, $sopY)
$g.DrawString("La", $font, $brush, 188, $sopY)
$g.DrawString("Do", $font, $brush, 268, $sopY)

$dir = Split-Path -Parent $OutPng
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

$bmp.Save($OutPng, [System.Drawing.Imaging.ImageFormat]::Png)

# Raw pixel dump, so the node check can run the same detection without a canvas.
$rect = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$bytes = New-Object byte[] ($data.Stride * $height)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$bmp.UnlockBits($data)
[System.IO.File]::WriteAllBytes($OutRgba, $bytes)

$g.Dispose(); $bmp.Dispose()

Write-Output "wrote $OutPng and $OutRgba ($width x $height)"
