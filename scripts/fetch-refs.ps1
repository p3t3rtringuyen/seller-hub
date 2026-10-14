# Clones (or refreshes) Amazon's SP-API reference repos into refs/amazon as shallow,
# read-only mirrors, and records the commit of each in refs/amazon/VERSIONS.txt so the
# catalogues built from them can say which version they describe.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'refs/amazon'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$repos = @(
  'selling-partner-api-models',
  'selling-partner-api-sdk',
  'selling-partner-agentic-toolkit',
  'selling-partner-api-samples',
  'selling-partner-api-postman',
  # Amazon Ads: Postman collections, Marketing Stream CloudFormation templates, v1 migration skills
  'ads-advanced-tools-docs'
)

$versions = @()
foreach ($repo in $repos) {
  $path = Join-Path $dest $repo
  if (Test-Path (Join-Path $path '.git')) {
    Write-Host "Refreshing $repo"
    git -C $path fetch --depth 1 origin HEAD
    if ($LASTEXITCODE -ne 0) { throw "fetch failed: $repo" }
    git -C $path reset --hard FETCH_HEAD
  } else {
    Write-Host "Cloning $repo"
    git clone --depth 1 "https://github.com/amzn/$repo.git" $path
  }
  if ($LASTEXITCODE -ne 0) { throw "git failed: $repo" }
  $sha = git -C $path rev-parse HEAD
  $date = git -C $path log -1 --format=%cs
  $versions += "$repo $sha $date"
}

$versions | Set-Content -Encoding utf8 -Path (Join-Path $dest 'VERSIONS.txt')
Write-Host "Done. Versions:"
$versions | ForEach-Object { Write-Host "  $_" }
