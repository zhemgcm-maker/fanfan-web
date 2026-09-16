$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# ===== 饭饭web 一键上传到 GitHub（账号 zhemgcm-maker）=====
# 双击 上传到GitHub.cmd 即可。第一次运行会弹浏览器让你登录 / 授权 GitHub，
# 仓库不存在时会自动创建一个私有仓库并推送。
$Owner = 'zhemgcm-maker'
$Repo  = '饭饭web'

function Find-Git {
  $c = Get-Command git -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $cand = @(
    "$env:ProgramFiles\Git\cmd\git.exe",
    "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
    "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe",
    "$env:USERPROFILE\scoop\apps\git\current\cmd\git.exe"
  )
  foreach ($p in $cand) {
    $hit = Get-ChildItem -Path $p -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  # Visual Studio 2022 自带的 git（你这台机器就是这种）
  $vs = "$env:ProgramFiles\Microsoft Visual Studio\*\*\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe"
  $hit = Get-ChildItem -Path $vs -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return $null
}

# 优先操作 D:\饭饭web（你自己那份），没有就操作脚本所在文件夹
$Target = 'D:\饭饭web'
if (-not (Test-Path -LiteralPath (Join-Path $Target 'index.html'))) { $Target = $PSScriptRoot }
Set-Location -LiteralPath $Target

Write-Host ''
Write-Host '===== 饭饭web 上传到 GitHub =====' -ForegroundColor Cyan
Write-Host ('操作的文件夹：' + $Target)

Write-Host '[1/5] 检查 git ...'
$git = Find-Git
if (-not $git) {
  Write-Host '没有找到 git。请安装 Git for Windows：https://git-scm.com/download/win' -ForegroundColor Red
  Read-Host '按回车退出'; exit 1
}
Write-Host ('      ' + (& $git --version) + '   [' + $git + ']')

Write-Host '[2/5] 本地提交 ...'
if (!(Test-Path (Join-Path $Target '.git'))) { & $git init -b main | Out-Null; Write-Host '      已初始化 git 仓库（分支 main）' }
& $git config user.name  $Owner
& $git config user.email "$Owner@users.noreply.github.com"
& $git add -A
& $git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  & $git commit -m ('更新：' + (Get-Date -Format 'yyyy-MM-dd HH:mm')) | Out-Null
  Write-Host '      已提交本地改动'
} else {
  Write-Host '      没有新改动，跳过提交'
}

Write-Host '[3/5] 取 GitHub 登录凭据（第一次会弹浏览器）...'
$tok = ''
$cred = ("protocol=https" + [char]10 + "host=github.com" + [char]10 + [char]10 | & $git -c http.sslBackend=openssl credential fill) 2>$null
$line = ($cred | Select-String -Pattern '^password=' | Select-Object -First 1)
if ($line) { $tok = ($line.ToString() -replace '^password=', '').Trim() }
if (-not $tok) {
  Write-Host '      本机还没有 GitHub 凭据，触发一次登录 ...'
  & $git credential-manager github login 2>&1 | Write-Host
  $cred = ("protocol=https" + [char]10 + "host=github.com" + [char]10 + [char]10 | & $git -c http.sslBackend=openssl credential fill) 2>$null
  $line = ($cred | Select-String -Pattern '^password=' | Select-Object -First 1)
  if ($line) { $tok = ($line.ToString() -replace '^password=', '').Trim() }
}
if ($tok) { Write-Host ('      已拿到凭据（' + $tok.Substring(0, [Math]::Min(4, $tok.Length)) + '...，不会显示完整内容）') }
else { Write-Host '      还没拿到凭据：下一步推送时 git 会自己再弹一次' -ForegroundColor Yellow }

Write-Host '[4/5] 在 GitHub 上建仓库（已存在就跳过）...'
if ($tok) {
  $body = '{"name":"' + $Repo + '","private":true,"description":"Fanfan - AI meal decision agent (single-file web app)"}'
  $outFile = Join-Path $env:TEMP 'fanfan-api.json'
  $code = (curl.exe -s -o $outFile -w "%{http_code}" -X POST -H "Authorization: token $tok" -H "User-Agent: fanfan-upload" -H "Content-Type: application/json" -d $body https://api.github.com/user/repos) 2>$null
  if ($code -eq '201') { Write-Host ('      已创建私有仓库 https://github.com/' + $Owner + '/' + $Repo) -ForegroundColor Green }
  elseif ($code -eq '422') { Write-Host '      仓库已经存在，直接用它' }
  else { Write-Host ('      自动建仓库失败（HTTP ' + $code + '）；如果下面推送失败，请到 https://github.com/new 手动建一个私有仓库 ' + $Repo) -ForegroundColor Yellow }
} else {
  Write-Host '      跳过（没有凭据）' -ForegroundColor Yellow
}

$remote = "https://github.com/$Owner/$Repo.git"
if ((& $git remote) -match '^origin$') { & $git remote set-url origin $remote } else { & $git remote add origin $remote }

Write-Host '[5/5] 推送 ...（第一次会在浏览器里等你点 Authorize）' -ForegroundColor Yellow
& $git -c http.sslBackend=openssl push -u origin main

if ($LASTEXITCODE -eq 0) {
  Write-Host ''
  Write-Host ('✅ 上传完成：https://github.com/' + $Owner + '/' + $Repo) -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host '❌ 推送失败。常见原因：' -ForegroundColor Red
  Write-Host ('   1) GitHub 上还没有仓库 ' + $Repo + ' → 打开 https://github.com/new 建一个 Private 仓库再重试')
  Write-Host '   2) 浏览器授权没完成 → 重新双击本脚本，在弹出的浏览器页面点 Authorize'
}
Write-Host ''
Read-Host '按回车退出'
