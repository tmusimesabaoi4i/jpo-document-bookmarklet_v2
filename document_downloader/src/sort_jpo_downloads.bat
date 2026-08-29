@echo off
rem ============================================================================
rem sort_jpo_downloads.bat
rem   ブラウザのダウンロードフォルダ直下にある JPO 書類を、
rem   「直近でダウンロードした出願番号」の 1 件だけ、拡張子別フォルダへ仕分ける。
rem
rem     出願番号\HTML  .html .htm
rem     出願番号\TXT   .txt
rem     出願番号\PDF   .pdf
rem     出願番号\IMG   .png .jpg .jpeg .gif .bmp .webp
rem     出願番号\OPD   .zip
rem
rem   使い方（このファイルをダウンロードフォルダに置いて実行する）:
rem     sort_jpo_downloads.bat                 … 直近ファイルの出願番号を自動判定
rem     sort_jpo_downloads.bat 特願2022-122252 … 出願番号を明示指定
rem
rem   環境変数 JPO_SORT_NOPAUSE を定義すると最後の pause を省略する（自動テスト用）。
rem
rem   設計の要点（document_downloader/README.md「ダウンロードの仕分け」も参照）:
rem     - 判定に使うのは「ファイル名先頭の出願番号」と「拡張子」だけ。
rem       日付や文書名の位置に依存しないので、新命名（出願番号_YYYYMMDD_文書名）も
rem       旧命名（出願番号_文書名(YYYYMMDD)）も OPD（出願番号_元ZIP名）も
rem       blank note（出願番号_note.pdf）も同じように扱える。
rem     - 出願番号を読み取れないファイルは動かさない（fail-safe）。
rem     - 対象出願番号と一致しないファイルは絶対に動かさない。
rem     - ダウンロードフォルダ直下のみ。仕分け済みフォルダの中は再処理しない。
rem     - 移動先に同名があれば上書きせず _2 / _3 … を付ける。
rem
rem   実体は、このファイル末尾のマーカー行より後ろに埋め込んだ PowerShell。cmd は
rem   exit /b でそこへ到達しないため、1 ファイルのまま可読な PowerShell を書ける。
rem   （マーカー文字列がファイル中で 1 回だけ現れるよう、ここには直接書かない）
rem ============================================================================
setlocal EnableExtensions
chcp 65001 >nul

set "JPO_SORT_SELF=%~nx0"
set "JPO_SORT_SELF_FULL=%~f0"
set "JPO_SORT_TARGET=%~1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$m='#@PS' + '-BEGIN@'; $s=[IO.File]::ReadAllText($env:JPO_SORT_SELF_FULL, [Text.Encoding]::UTF8); $i=$s.IndexOf($m); if ($i -lt 0) { Write-Host 'ERROR: embedded PowerShell block not found.'; exit 2 }; & ([scriptblock]::Create($s.Substring($i + $m.Length)))"
set "JPO_SORT_RC=%ERRORLEVEL%"

if not defined JPO_SORT_NOPAUSE pause
endlocal & exit /b %JPO_SORT_RC%

#@PS-BEGIN@
$ErrorActionPreference = 'Stop'

function Invoke-JpoSort {
  # 出力の文字化け防止（リダイレクト時に失敗することがあるので握りつぶす）
  try {
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [Console]::OutputEncoding = $utf8
    $global:OutputEncoding = $utf8
  } catch { }

  $root = (Get-Location).ProviderPath
  $self = [string]$env:JPO_SORT_SELF
  $argTarget = [string]$env:JPO_SORT_TARGET

  # 拡張子 → 仕分け先フォルダ名。ここに無い拡張子のファイルは一切動かさない。
  $buckets = @{
    '.html' = 'HTML'; '.htm' = 'HTML'
    '.txt'  = 'TXT'
    '.pdf'  = 'PDF'
    '.png'  = 'IMG'; '.jpg' = 'IMG'; '.jpeg' = 'IMG'; '.gif' = 'IMG'; '.bmp' = 'IMG'; '.webp' = 'IMG'
    '.zip'  = 'OPD'
  }

  # 出願番号 = ファイル名の先頭にある「種別 + 西暦4桁 + '-' + 連番6桁」。
  # 直後は '_'（何かが続く）か '.'（拡張子）か終端でなければならない。
  # 例: 特願2022-122252_20260602_手続補正書（自発・内容）.pdf
  #     特願2022-122252_手続補正書（自発・内容）(20260602).pdf
  #     特願2022-122252_EP4312460A1.zip / 特願2022-122252_note.pdf
  $appNoPattern = '^(特願|実願|意願|商願)[0-9]{4}-[0-9]{6}(?=[_.]|$)'

  function Get-AppNo([string]$name) {
    $m = [regex]::Match($name, $appNoPattern)
    if ($m.Success) { return $m.Value }
    return ''
  }

  # 上書きしない。既にあれば name_2.ext / name_3.ext … を探す。
  function Get-FreeDestination([string]$dir, [string]$name) {
    $dest = Join-Path $dir $name
    if (-not (Test-Path -LiteralPath $dest)) { return $dest }
    $stem = [IO.Path]::GetFileNameWithoutExtension($name)
    $ext = [IO.Path]::GetExtension($name)
    for ($i = 2; $i -le 9999; $i++) {
      $cand = Join-Path $dir ('{0}_{1}{2}' -f $stem, $i, $ext)
      if (-not (Test-Path -LiteralPath $cand)) { return $cand }
    }
    throw ('Too many name collisions for: ' + $name)
  }

  Write-Host ('Folder      : ' + $root)

  # ダウンロードフォルダ「直下」のファイルだけを見る（-Recurse しない＝仕分け済みは触らない）
  $all = @(Get-ChildItem -LiteralPath $root -File)
  $cands = @()
  foreach ($f in $all) {
    if ($f.Name -eq $self) { continue }                     # この BAT 自身は対象外
    $ext = $f.Extension.ToLowerInvariant()
    if (-not $buckets.ContainsKey($ext)) { continue }       # 対象拡張子以外は動かさない
    $app = Get-AppNo $f.Name
    if ($app -eq '') { continue }                           # 出願番号を読めないものは動かさない
    $cands += [pscustomobject]@{ File = $f; App = $app; Bucket = $buckets[$ext] }
  }

  # --- 今回の対象出願番号を決める --------------------------------------------
  if ($argTarget.Trim() -ne '') {
    # 引数指定: 出願番号として妥当なときだけ受け付ける（誤指定で他出願を巻き込まない）
    $target = $argTarget.Trim()
    if ((Get-AppNo $target) -ne $target) {
      Write-Host ('ERROR: not a JPO application number: ' + $target)
      Write-Host '       expected e.g. 特願2022-122252 / 実願… / 意願… / 商願…'
      return 1
    }
    Write-Host ('Target      : ' + $target + '  (from argument)')
  } else {
    if ($cands.Count -eq 0) {
      Write-Host 'Target      : (none)'
      Write-Host 'No JPO file with a leading application number was found in this folder.'
      return 0
    }
    # 「直近」= 最終更新日時が最も新しい「有効な」候補ファイル。その出願番号だけを対象にする。
    $newest = $cands | Sort-Object -Property @{ Expression = { $_.File.LastWriteTime } } -Descending | Select-Object -First 1
    $target = $newest.App
    Write-Host ('Newest file : ' + $newest.File.Name)
    Write-Host ('Target      : ' + $target + '  (auto)')
  }

  # --- 対象出願番号のファイルだけを移動 --------------------------------------
  $picked = @($cands | Where-Object { $_.App -eq $target })
  $others = @($cands | Where-Object { $_.App -ne $target })

  if ($picked.Count -eq 0) {
    Write-Host ('No file starts with ' + $target + '. Nothing moved.')
    return 0
  }

  $rootDir = Join-Path $root $target
  $moved = 0
  foreach ($c in $picked) {
    $destDir = Join-Path $rootDir $c.Bucket
    [void][IO.Directory]::CreateDirectory($destDir)         # 実際に使う種類だけ作る
    $dest = Get-FreeDestination $destDir $c.File.Name
    [IO.File]::Move($c.File.FullName, $dest)                # ワイルドカード解釈のない移動
    Write-Host ('MOVE: ' + $c.File.Name + '  ->  ' + $target + '\' + $c.Bucket + '\' + [IO.Path]::GetFileName($dest))
    $moved++
  }

  if ($others.Count -gt 0) {
    $names = (($others | ForEach-Object { $_.App }) | Sort-Object -Unique) -join ', '
    Write-Host ('KEEP: left in place (other applications): ' + $names)
  }
  Write-Host ''
  Write-Host ('DONE: ' + $moved + ' file(s) -> ' + $rootDir)
  return 0
}

try {
  $rc = Invoke-JpoSort
} catch {
  Write-Host ('ERROR: ' + $_.Exception.Message)
  $rc = 1
}
exit $rc
