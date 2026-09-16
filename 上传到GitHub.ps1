$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# ===== 饭饭web 一键上传 / 更新到 GitHub（账号 zhemgcm-maker）=====
# 双击 上传到GitHub.cmd 即可。登录凭据直接从 Windows 凭据库里取（GitHub Desktop 存的），
# 所以正常情况下不会弹浏览器、也不需要邮箱验证。
$Owner = 'zhemgcm-maker'
$Repo  = 'fanfan-web'

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
  $vs = "$env:ProgramFiles\Microsoft Visual Studio\*\*\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe"
  $hit = Get-ChildItem -Path $vs -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return $null
}

# 从 Windows 凭据管理器读取 GitHub Desktop 保存的登录令牌
function Get-GitHubToken {
  $src = @'
using System;
using System.Runtime.InteropServices;
public class FanfanCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr buffer);
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    byte[] blob = new byte[c.CredentialBlobSize];
    Marshal.Copy(c.CredentialBlob, blob, 0, (int)c.CredentialBlobSize);
    CredFree(p);
    string s = System.Text.Encoding.UTF8.GetString(blob);
    return (s.Length > 8 && s.Substring(0, 2) == "gh") ? s : null;
  }
}
'@
  try { Add-Type -TypeDefinition $src -Language CSharp -ErrorAction Stop } catch {}
  $targets = @(
    "GitHub - https://api.github.com/$Owner",
    "GitHub - https://api.github.com",
    "git:https://github.com"
  )
  foreach ($t in $targets) {
    $v = [FanfanCred]::Read($t)
    if ($v) { return $v }
  }
  return $null
}

# 目标文件夹：优先 D:\饭饭web
$Target = 'D:\饭饭web'
if (-not (Test-Path -LiteralPath (Join-Path $Target 'index.html'))) { $Target = $PSScriptRoot }
Set-Location -LiteralPath $Target

Write-Host ''
Write-Host '===== 饭饭web 上传 / 更新到 GitHub =====' -ForegroundColor Cyan
Write-Host ('操作的文件夹：' + $Target)

Write-Host '[1/4] 检查 git ...'
$git = Find-Git
if (-not $git) {
  Write-Host '没有找到 git。请安装 Git for Windows：https://git-scm.com/download/win' -ForegroundColor Red
  Read-Host '按回车退出'; exit 1
}
Write-Host ('      ' + (& $git --version) + '   [' + $git + ']')

Write-Host '[2/4] 本地提交 ...'
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

Write-Host '[3/4] 读取 GitHub 登录凭据 ...'
$tok = Get-GitHubToken
if (-not $tok) {
  Write-Host '      本机没找到 GitHub 凭据。请打开 GitHub Desktop 登录一次（或告诉我，我用别的方式处理），然后重新运行本脚本。' -ForegroundColor Red
  Read-Host '按回车退出'; exit 1
}
Write-Host ('      已读取到凭据（' + $tok.Substring(0,4) + '...，长度 ' + $tok.Length + '，不会显示完整内容）')

$hdr = @{ Authorization = "token $tok"; "User-Agent" = "fanfan-upload" }
$remote = "https://github.com/$Owner/$Repo.git"
try {
  Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$Owner/$Repo" -Headers $hdr -TimeoutSec 20 | Out-Null
  Write-Host ('      远程仓库正常：' + $remote)
} catch {
  Write-Host '      远程仓库不存在，自动创建一个私有的 ...'
  $json = @{ name = $Repo; private = $true; description = '饭饭 · 今天吃啥（智能美食决策 Agent）' } | ConvertTo-Json
  try {
    Invoke-RestMethod -Method Post -Uri 'https://api.github.com/user/repos' -Headers $hdr -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 30 | Out-Null
    Write-Host '      已创建私有仓库' -ForegroundColor Green
  } catch { Write-Host ('      建仓库失败：' + $_.Exception.Message) -ForegroundColor Yellow }
}

Write-Host '[4/4] 推送 ...'
if ((& $git remote) -match '^origin$') { & $git remote set-url origin $remote } else { & $git remote add origin $remote }
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$tok"))
& $git -c credential.helper= -c "http.extraHeader=Authorization: Basic $b64" push -u origin main

if ($LASTEXITCODE -eq 0) {
  Write-Host ''
  Write-Host ('✅ 上传完成：https://github.com/' + $Owner + '/' + $Repo) -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host '❌ 推送失败。把上面的报错发我。' -ForegroundColor Red
}
Write-Host ''
Read-Host '按回车退出'
