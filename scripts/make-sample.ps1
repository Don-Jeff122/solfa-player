Add-Type -AssemblyName System.Drawing

$out = "C:\Users\USER\solfa-player\scripts\sample-solfa.png"

$bmp = New-Object System.Drawing.Bitmap 1100, 620
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$font = New-Object System.Drawing.Font("Arial", 46, [System.Drawing.FontStyle]::Regular)
$small = New-Object System.Drawing.Font("Arial", 34, [System.Drawing.FontStyle]::Regular)
$dark = [System.Drawing.Color]::FromArgb(20, 20, 20)

$g.DrawString("Key: G", $font, (New-Object System.Drawing.SolidBrush($dark)), 60, 40)
$g.DrawString("Do Re Mi Fa So La Ti", $font, (New-Object System.Drawing.SolidBrush($dark)), 60, 150)
$g.DrawString("Do So Mi Re Fa", $font, (New-Object System.Drawing.SolidBrush($dark)), 60, 260)
$g.DrawString("Bass", $small, (New-Object System.Drawing.SolidBrush($dark)), 60, 380)
$g.DrawString("Do So Mi", $font, (New-Object System.Drawing.SolidBrush($dark)), 60, 460)

$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "wrote $out"
