// 生成"分享给朋友"工具包：zero-dependency 的 PowerShell 静态服务 + ssh 隧道一键脚本
import fs from 'node:fs';
import path from 'node:path';

const srcHtml = process.argv[2];
const kitDir = process.argv[3];
fs.mkdirSync(kitDir, { recursive: true });

// ---------- serve.ps1 ----------
const serve = `param(
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
  $head = "HTTP/1.1 $status\`r\`nContent-Type: $contentType\`r\`nContent-Length: $($bytes.Length)\`r\`nCache-Control: no-store\`r\`nConnection: close\`r\`n\`r\`n"
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
      if ($sb.ToString().Contains("\`r\`n\`r\`n")) { break }
      if ($sb.Length -gt 16384) { break }
    }
    $head = $sb.ToString()
    $first = ($head -split "\`r\`n")[0]
    $sp = $first.Split(' ')
    $url = '/'
    if ($sp.Length -ge 2) { $url = $sp[1] }
    $url = $url.Split('?')[0]
    $url = [System.Uri]::UnescapeDataString($url)
    if ($url -eq '/' -or $url -eq '') { $url = '/index.html' }

    $rel = $url.TrimStart('/').Replace('/', '\\')
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
`;

// ---------- start.ps1 ----------
const start = `$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8090

Write-Host ''
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host '  今天吃啥 · 生成微信可分享的链接' -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''

# 1) 检查 ssh
$ssh = Join-Path $env:WINDIR 'System32\\OpenSSH\\ssh.exe'
if (-not (Test-Path $ssh)) {
  $cmd = Get-Command ssh.exe -ErrorAction SilentlyContinue
  if ($cmd) { $ssh = $cmd.Source } else { $ssh = $null }
}
if (-not $ssh) {
  Write-Host '[x] 这台电脑没找到 ssh.exe，无法生成公网链接。' -ForegroundColor Red
  Write-Host '    可以改用「微信直接发 HTML 文件」的方式分享。' -ForegroundColor Yellow
  Read-Host '按回车退出'
  exit 1
}

# 2) 后台起本地服务（同一个进程里的独立 runspace，不弹额外窗口）
$server = [PowerShell]::Create()
[void]$server.AddScript((Join-Path $here 'serve.ps1'))
[void]$server.AddParameter('Root', $here)
[void]$server.AddParameter('Port', $port)
[void]$server.BeginInvoke()
Start-Sleep -Seconds 2

# 3) 自检
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/" -f $port) -TimeoutSec 10
  Write-Host ("[ok] 本地服务自检通过（HTTP {0}，{1} 字节）" -f $r.StatusCode, $r.RawContentLength) -ForegroundColor Green
} catch {
  Write-Host '[!] 本地服务自检没通过，仍继续尝试建立隧道。' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '接下来会出现一行 https://xxxx.lhr.life 的网址' -ForegroundColor Cyan
Write-Host '这就是可以发微信给朋友的链接（手机也能扫下面的二维码）' -ForegroundColor Cyan
Write-Host '⚠ 这个窗口不要关，关掉链接就失效了' -ForegroundColor Yellow
Write-Host ''

# 4) 建立免登录隧道：断线自动重连，并把链接复制到剪贴板
$script:lastUrl = $null
while ($true) {
  & $ssh -n -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -R 80:localhost:$port nokey@localhost.run 2>&1 | ForEach-Object {
    $line = [string]$_
    Write-Host $line
    if ($line -match 'https://[a-z0-9]+\.lhr\.life') {
      $script:lastUrl = $Matches[0]
      try { Set-Clipboard -Value $script:lastUrl } catch { }
      Write-Host ''
      Write-Host '========================================================' -ForegroundColor Green
      Write-Host ('  链接已复制到剪贴板，去微信里粘贴就行：') -ForegroundColor Green
      Write-Host ('  ' + $script:lastUrl) -ForegroundColor Green
      Write-Host '========================================================' -ForegroundColor Green
      Write-Host ''
    }
  }
  Write-Host ''
  Write-Host '隧道断开，5 秒后自动重连（重连后网址可能变化，注意看上面的新链接）。' -ForegroundColor Yellow
  Write-Host '想停止分享，直接关掉这个窗口。' -ForegroundColor Yellow
  Start-Sleep -Seconds 5
}
`;

// ---------- .cmd（保持纯 ASCII，避免 cmd 编码问题） ----------
const cmd = `@echo off
chcp 65001 >nul
title Meal Agent Share Link
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
echo.
echo (window can be closed)
pause >nul
`;

// PowerShell 5.1 读取无 BOM 的 UTF-8 会当 ANSI 处理导致中文乱码，所以带 BOM 写
fs.writeFileSync(path.join(kitDir, 'serve.ps1'), '\uFEFF' + serve, 'utf8');
fs.writeFileSync(path.join(kitDir, 'start.ps1'), '\uFEFF' + start, 'utf8');
fs.writeFileSync(path.join(kitDir, '一键生成分享链接.cmd'), cmd.replace(/\n/g, '\r\n'), 'ascii');

// 页面本体（两份：index.html 供服务器使用，中文名那份方便直接发文件）
const html = fs.readFileSync(srcHtml);
fs.writeFileSync(path.join(kitDir, 'index.html'), html);
fs.writeFileSync(path.join(kitDir, '今天吃啥.html'), html);

console.log('工具包已生成: ' + kitDir);
fs.readdirSync(kitDir).forEach(f => {
  const s = fs.statSync(path.join(kitDir, f));
  console.log('  ' + f + '  (' + (s.size / 1024).toFixed(1) + ' KB)');
});
