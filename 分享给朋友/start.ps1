$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8090

Write-Host ''
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host '  今天吃啥 · 生成微信可分享的链接' -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''

# 1) 检查 ssh
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
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
    if ($line -match 'https://[a-z0-9]+.lhr.life') {
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
