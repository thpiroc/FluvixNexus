<#
  正式アイコンの原本（resources/icon.png）から Windows 用の resources/icon.ico を作る
  （docs/RELEASE.md §5.3）。

    powershell -NoProfile -ExecutionPolicy Bypass -File tools/generate-app-icon.ps1

  Windows 標準の .NET（System.Drawing）だけで作る。画像処理のパッケージを依存に足さないため。

  - 含めるサイズ: 16 / 20 / 24 / 32 / 40 / 48 / 64 / 256
  - 256 は PNG 圧縮、それ以外は 32bit BGRA の DIB（古い読み手・NSIS でも読める形）
  - 原本の絵は変えない（切り抜き・余白の追加・色の補正をしない）。縮小だけ

  原本を差し替えたら、これを流し直して icon.png と icon.ico を一緒に commit する。
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'resources\icon.png'
$outputPath = Join-Path $root 'resources\icon.ico'
$sizes = @(16, 20, 24, 32, 40, 48, 64, 256)

function Resize-Square([System.Drawing.Image]$source, [int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $attributes = New-Object System.Drawing.Imaging.ImageAttributes
  try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    # 既定の WrapMode では縁の外を透明として補間し、外周が1px 暗く滲むため。
    $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $graphics.DrawImage(
      $source,
      (New-Object System.Drawing.Rectangle(0, 0, $size, $size)),
      0, 0, $source.Width, $source.Height,
      [System.Drawing.GraphicsUnit]::Pixel,
      $attributes
    )
  } finally {
    $attributes.Dispose()
    $graphics.Dispose()
  }
  return $bitmap
}

function Get-PngBytes([System.Drawing.Bitmap]$bitmap) {
  $stream = New-Object System.IO.MemoryStream
  try {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return ,$stream.ToArray()
  } finally {
    $stream.Dispose()
  }
}

# ICO の中の DIB: BITMAPINFOHEADER（高さは XOR + AND で2倍）→ 下の行から並べた BGRA → AND マスク（全 0。透過は alpha で表す）
function Get-DibBytes([System.Drawing.Bitmap]$bitmap) {
  $size = $bitmap.Width
  $maskRowBytes = [int]([Math]::Ceiling($size / 32.0)) * 4
  $pixelBytes = $size * $size * 4
  $stream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($stream)
  try {
    $writer.Write([UInt32]40)
    $writer.Write([Int32]$size)
    $writer.Write([Int32]($size * 2))
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]0)
    $writer.Write([UInt32]($pixelBytes + $maskRowBytes * $size))
    $writer.Write([Int32]0)
    $writer.Write([Int32]0)
    $writer.Write([UInt32]0)
    $writer.Write([UInt32]0)

    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $rowBytes = New-Object byte[] ($size * 4)
      for ($y = $size - 1; $y -ge 0; $y--) {
        $rowPointer = [IntPtr]::Add($data.Scan0, $y * $data.Stride)
        [System.Runtime.InteropServices.Marshal]::Copy($rowPointer, $rowBytes, 0, $rowBytes.Length)
        $writer.Write($rowBytes)
      }
    } finally {
      $bitmap.UnlockBits($data)
    }
    $writer.Write((New-Object byte[] ($maskRowBytes * $size)))
    $writer.Flush()
    return ,$stream.ToArray()
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
  if ($source.Width -ne $source.Height) {
    throw "resources/icon.png は正方形である必要がある（$($source.Width)x$($source.Height)）"
  }
  if ($source.Width -lt 256) {
    throw "resources/icon.png は 256px 以上が要る（$($source.Width)px）"
  }

  $images = @()
  foreach ($size in $sizes) {
    $bitmap = Resize-Square $source $size
    try {
      if ($size -ge 256) { $bytes = Get-PngBytes $bitmap } else { $bytes = Get-DibBytes $bitmap }
    } finally {
      $bitmap.Dispose()
    }
    $images += , @{ Size = $size; Bytes = $bytes }
  }
} finally {
  $source.Dispose()
}

$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($stream)
try {
  # ICONDIR
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$images.Count)
  # ICONDIRENTRY（256 は 0 と書く）
  $offset = 6 + 16 * $images.Count
  foreach ($image in $images) {
    $dimension = if ($image.Size -ge 256) { 0 } else { $image.Size }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$image.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $image.Bytes.Length
  }
  foreach ($image in $images) {
    $writer.Write([byte[]]$image.Bytes)
  }
  $writer.Flush()
  [System.IO.File]::WriteAllBytes($outputPath, $stream.ToArray())
} finally {
  $writer.Dispose()
  $stream.Dispose()
}

Write-Output "wrote $outputPath ($((Get-Item $outputPath).Length) bytes; $($sizes -join ' / ') px)"
