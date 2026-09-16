param(
  [string]$Root = $PSScriptRoot,
  [int]$Port = 8090
)

$ErrorActionPreference = 'Stop'
$rootFull = (Resolve-Path -LiteralPath $Root).Path

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
}

function Send-Response($stream, [string]$status, [string]$contentType, [byte[]]$bytes) {
  $head = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host ("[server] ready on http://127.0.0.1:{0}  root: {1}" -f $Port, $rootFull)

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $stream.ReadTimeout = 8000
    $stream.WriteTimeout = 20000
    $buf = New-Object byte[] 4096
    $sb = New-Object System.Text.StringBuilder
    while ($true) {
      $n = $stream.Read($buf, 0, $buf.Length)
      if ($n -le 0) { break }
      [void]$sb.Append([System.Text.Encoding]::ASCII.GetString($buf, 0, $n))
      if ($sb.ToString().Contains("`r`n`r`n")) { break }
      if ($sb.Length -gt 16384) { break }
    }
    $head = $sb.ToString()
    $first = ($head -split "`r`n")[0]
    $sp = $first.Split(' ')
    $url = '/'
    if ($sp.Length -ge 2) { $url = $sp[1] }
    $url = $url.Split('?')[0]
    $url = [System.Uri]::UnescapeDataString($url)
    if ($url -eq '/' -or $url -eq '') { $url = '/index.html' }

    $rel = $url.TrimStart('/').Replace('/', '\')
    $full = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))

    if (-not $full.StartsWith($rootFull)) {
      Send-Response $stream '403 Forbidden' 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('403'))
    } elseif (Test-Path -LiteralPath $full -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ct = 'application/octet-stream'
      if ($mime.ContainsKey($ext)) { $ct = $mime[$ext] }
      Send-Response $stream '200 OK' $ct $bytes
      Write-Host ("[server] 200 {0}" -f $url)
    } else {
      Send-Response $stream '404 Not Found' 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('404'))
    }
  } catch {
    # 单个请求出错不影响后续请求
  } finally {
    try { $client.Close() } catch { }
  }
}
