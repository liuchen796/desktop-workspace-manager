Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeIcon {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool DestroyIcon(IntPtr handle);
}
"@

$buildDirectory = Join-Path $PSScriptRoot '..\build'
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null

$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$background = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(20, 122, 104))
$cell = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(240, 169, 60))

$graphics.FillRectangle($background, 18, 18, 220, 220)
$graphics.FillRectangle($cell, 59, 59, 56, 56)
$graphics.FillRectangle($cell, 141, 59, 56, 56)
$graphics.FillRectangle($cell, 59, 141, 56, 56)
$graphics.FillRectangle($accent, 141, 141, 56, 56)

$pngPath = Join-Path $buildDirectory 'icon.png'
$icoPath = Join-Path $buildDirectory 'icon.ico'
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$handle = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($handle)
$stream = [System.IO.File]::Create($icoPath)
$icon.Save($stream)
$stream.Dispose()
$icon.Dispose()
[NativeIcon]::DestroyIcon($handle) | Out-Null
$background.Dispose()
$cell.Dispose()
$accent.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
