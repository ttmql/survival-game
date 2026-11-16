param([string]$OutputDirectory = "")
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$buildDirectory = Join-Path $projectRoot '.desktop-build'
New-Item -ItemType Directory -Path $buildDirectory, $OutputDirectory -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archivePath = Join-Path $buildDirectory 'game.zip'
$stream = [IO.File]::Create($archivePath)
try {
    $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        $files = @((Get-Item -LiteralPath (Join-Path $projectRoot 'index.html')))
        foreach ($folder in @('css', 'js', 'assets', 'Music')) {
            $files += @(Get-ChildItem -LiteralPath (Join-Path $projectRoot $folder) -Recurse -File)
        }
        foreach ($file in ($files | Sort-Object FullName)) {
            $name = $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
            $entry = $archive.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = [DateTimeOffset]::new(2026, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
            $inputStream = $file.OpenRead()
            $entryStream = $entry.Open()
            try { $inputStream.CopyTo($entryStream) }
            finally { $entryStream.Dispose(); $inputStream.Dispose() }
        }
    } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
$framework = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$exe = Join-Path $OutputDirectory '荒野方界.exe'
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ "/out:$exe" "/resource:$archivePath,game.zip" /reference:System.Windows.Forms.dll "/reference:$(Join-Path $framework 'System.IO.Compression.dll')" (Join-Path $PSScriptRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'EXE 编译失败。' }
Write-Output $exe
