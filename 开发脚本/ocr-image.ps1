# 用 Windows 自带 OCR 识别菜单图片（离线、免费、支持中文）
# 用法：powershell -ExecutionPolicy Bypass -File ocr-image.ps1 <图片路径> [每行之间是否空一行]
param(
  [Parameter(Mandatory=$true)][string]$Path,
  [switch]$Raw,      # 不去空格，原样输出
  [switch]$Blob,     # 输出整段文字（不分行），给大模型做"菜名+价格"配对用
  [switch]$Layout,   # 输出每行的坐标：y<TAB>x<TAB>文字（菜单是分栏排版，靠坐标才能把菜名和价格配对）
  [switch]$NoUpscale # 不放大（默认会放大，实测菜单照片放大 2 倍后价格识别准确率提升明显）
)

$ErrorActionPreference = 'Stop'
if(-not (Test-Path -LiteralPath $Path)){ Write-Error "找不到文件：$Path"; exit 1 }
$full = (Resolve-Path -LiteralPath $Path).Path

# 放大：Windows OCR 对小字很不友好，先把长边放到 3000 像素左右再识别
if(-not $NoUpscale){
  Add-Type -AssemblyName System.Drawing
  $img = [System.Drawing.Image]::FromFile($full)
  $longSide = [Math]::Max($img.Width, $img.Height)
  if($longSide -lt 2400){
    $scale = [Math]::Min(3.0, 3000.0 / $longSide)
    $w = [int]($img.Width * $scale); $h = [int]($img.Height * $scale)
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $w, $h)
    $g.Dispose(); $img.Dispose()
    $tmp = Join-Path $env:TEMP ("ocr-" + [IO.Path]::GetFileNameWithoutExtension($full) + "-" + $w + "x" + $h + ".png")
    $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $full = $tmp
  } else { $img.Dispose() }
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($WinRtTask, $ResultType){
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null

$file    = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($full)) ([Windows.Storage.StorageFile])
$stream  = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap  = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if(-not $engine){ $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language "zh-Hans-CN")) }
if(-not $engine){ Write-Error '这台机器没有可用的中文 OCR 引擎'; exit 1 }

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

# Windows 的中文 OCR 会在每个汉字之间插空格，这里去掉；同时保留原本的行结构
# （菜单一行通常就是"菜名 + 价格"，行结构对后面解析比什么都重要）
function Clean([string]$t){
  if($Raw){ return $t.Trim() }
  $t = $t -replace '(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])', ''
  $t = $t -replace '\s+(?=[\u4e00-\u9fa5])', ' '
  $t = $t -replace '(?<=[\u4e00-\u9fa5])\s+(?=[\d¥￥])', ' '
  $t.Trim()
}

if($Layout){
  # 每行给出 y、x 和文字。菜名在左、价格在右，同一行的 y 很接近——这是最可靠的配对依据。
  foreach($line in $result.Lines){
    $t = Clean $line.Text
    if(-not $t){ continue }
    $words = @($line.Words)
    if($words.Count -gt 0){
      $r = $words[0].BoundingRect
      "" + [int]$r.Y + "`t" + [int]$r.X + "`t" + $t
    } else {
      "" + 0 + "`t" + 0 + "`t" + $t
    }
  }
} elseif($Blob){
  Clean $result.Text
}else{
  foreach($line in $result.Lines){ Clean $line.Text }
}
