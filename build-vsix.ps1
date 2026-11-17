# Builds a .vsix without vsce/npm and (with -Install) installs it into VS Code.
# Bump "version" in package.json before building, otherwise VS Code may keep using a cached older version.
#   powershell -ExecutionPolicy Bypass -File build-vsix.ps1 -Install
param([switch]$Install)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression

$root = $PSScriptRoot
$pkg = Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$out = Join-Path $root "$($pkg.name)-$($pkg.version).vsix"
$files = @('package.json', 'extension.js', 'media/view.js', 'media/view.css')

$contentTypes = @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".css" ContentType="text/css"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>
'@

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="$($pkg.name)" Version="$($pkg.version)" Publisher="$($pkg.publisher)"/>
    <DisplayName>$($pkg.displayName)</DisplayName>
    <Description xml:space="preserve">$([System.Security.SecurityElement]::Escape($pkg.description))</Description>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($pkg.engines.vscode)"/>
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  </Assets>
</PackageManifest>
"@

if (Test-Path $out) { Remove-Item $out -Force }
$utf8 = New-Object System.Text.UTF8Encoding($false)
$fs = [System.IO.File]::Open($out, 'CreateNew')
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($e in @(@('[Content_Types].xml', $contentTypes), @('extension.vsixmanifest', $manifest))) {
    $w = New-Object System.IO.StreamWriter($zip.CreateEntry($e[0]).Open(), $utf8)
    $w.Write($e[1]); $w.Dispose()
  }
  foreach ($f in $files) {
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $root $f))
    $s = $zip.CreateEntry("extension/$f").Open()   # forward slashes are required
    $s.Write($bytes, 0, $bytes.Length); $s.Dispose()
  }
} finally { $zip.Dispose(); $fs.Dispose() }
Write-Host "Built: $out"

if ($Install) {
  & code --install-extension $out --force
}
