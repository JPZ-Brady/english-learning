# 一键生成本地发音（单词 + 例句）到 audio\ 文件夹。用法（pwsh 里）：
#   & '.\生成发音.ps1'               # 单词 + 例句
#   & '.\生成发音.ps1' --words-only  # 只要单词
#   & '.\生成发音.ps1' --limit 20       # 先试 20 条
# 想指定某个 Python：先 $env:EL_PYTHON = 'C:\路径\python.exe' 再运行。
# 回退：删掉 audio\ 文件夹即可，学习台会自动退回浏览器语音。
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'

# 候选 Python：指定的 > 用户目录里装的正式版（新版本优先）> py 启动器 > PATH 里的 python
# PATH 里第一个可能是没带 pip 的测试版（比如 F:\python.exe 3.13.0b1），所以不能只看 PATH
$cands = @()
if ($env:EL_PYTHON) { $cands += ,@($env:EL_PYTHON) }
$userPy = Join-Path $env:LOCALAPPDATA 'Programs\Python'
if (Test-Path $userPy) {
    Get-ChildItem $userPy -Directory -Filter 'Python3*' |
        Sort-Object { [int]($_.Name -replace '\D', '') } -Descending |
        ForEach-Object { $exe = Join-Path $_.FullName 'python.exe'; if (Test-Path $exe) { $cands += ,@($exe) } }
}
$cands += ,@('py', '-3'); $cands += ,@('python'); $cands += ,@('python3')

$py = $null; $noPip = $null
foreach ($cand in $cands) {
    $rest = @($cand | Select-Object -Skip 1)
    try { $v = "$(& $cand[0] @rest --version 2>&1)" } catch { continue }
    if ($v -notmatch '^Python 3\.(\d+)\.\d+$' -or [int]$Matches[1] -lt 8) {   # 带 a/b/rc 的测试版直接跳过
        if ($v -match '^Python 3') { Write-Host "跳过 $($cand -join ' ')：$v（测试版或太旧）" }
        continue
    }
    & $cand[0] @rest -m pip --version *> $null
    if ($LASTEXITCODE -eq 0) { $py = $cand; break }
    if (-not $noPip) { $noPip = $cand }
}
if (-not $py -and $noPip) {
    Write-Host "找到的 Python 都没带 pip，尝试用自带的 ensurepip 补上：$($noPip -join ' ')"
    $rest = @($noPip | Select-Object -Skip 1)
    & $noPip[0] @rest -m ensurepip --upgrade
    if ($LASTEXITCODE -eq 0) { $py = $noPip }
}
if (-not $py) {
    Write-Host '没找到能用的 Python 3.8+（需要正式版且带 pip）。把上面的输出发给我。' -ForegroundColor Yellow
    exit 1
}
$pyArgs = @($py | Select-Object -Skip 1)
Write-Host ("用的 Python：" + (& $py[0] @pyArgs -c "import sys; print(sys.executable, sys.version.split()[0])" 2>&1))

& $py[0] @pyArgs -c "import edge_tts" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host '第一次运行：安装 edge-tts（免费开源，生成微软神经语音用）…'
    & $py[0] @pyArgs -m pip install --user edge-tts
    if ($LASTEXITCODE -ne 0) { Write-Host 'edge-tts 安装失败，把上面的完整报错发给我。' -ForegroundColor Red; exit 1 }
}

& $py[0] @pyArgs (Join-Path $here '生成发音.py') @args
exit $LASTEXITCODE
