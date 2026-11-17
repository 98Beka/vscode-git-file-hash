# Generates icon.png (128x128) for the Marketplace.
Add-Type -AssemblyName System.Drawing
$size = 128
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)

# rounded square background
$r = 26
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
$path.AddArc($size - $r * 2 - 1, 0, $r * 2, $r * 2, 270, 90)
$path.AddArc($size - $r * 2 - 1, $size - $r * 2 - 1, $r * 2, $r * 2, 0, 90)
$path.AddArc(0, $size - $r * 2 - 1, $r * 2, $r * 2, 90, 90)
$path.CloseFigure()
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $size, $size), ([System.Drawing.Color]::FromArgb(255, 37, 99, 235)), ([System.Drawing.Color]::FromArgb(255, 30, 42, 58))
$g.FillPath($bg, $path)

# "#" glyph
$font = New-Object System.Drawing.Font 'Consolas', 64, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$g.DrawString('#', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, -8, $size, $size), $fmt)

# small label
$font2 = New-Object System.Drawing.Font 'Consolas', 17, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$label = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 147, 197, 253))
$g.DrawString('a3f0c9', $font2, $label, (New-Object System.Drawing.RectangleF 0, 82, $size, 30), $fmt)

$out = Join-Path $PSScriptRoot 'icon.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "Saved $out"
