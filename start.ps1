param([switch]$NoOpen)
$ErrorActionPreference='Stop'
$node=(Get-Command node -ErrorAction SilentlyContinue).Source
if(!$node){throw 'Please install Node.js 24 or newer, then retry.'}
$major=[int](((& $node --version).Trim() -replace '^v','').Split('.')[0])
if($major -lt 24){throw 'Node.js 24 or newer is required.'}
$studioData=if($env:MEME_STUDIO_DATA){$env:MEME_STUDIO_DATA}else{Join-Path $env:USERPROFILE '.meme-studio'}
[IO.Directory]::CreateDirectory($studioData)|Out-Null
$accessFile=Join-Path $studioData 'panel-access.json'
function Get-StudioAccess {
 if(!(Test-Path -LiteralPath $accessFile)){return $null}
 try{
  $a=Get-Content -LiteralPath $accessFile -Raw|ConvertFrom-Json
  $u=[uri]$a.origin
  if($u.Scheme -ne 'http' -or $u.Host -ne '127.0.0.1'){return $null}
  $null=Invoke-RestMethod -Uri ($a.origin+'/api/state') -Headers @{Authorization=('Bearer '+$a.token)} -TimeoutSec 2
  return $a
 }catch{return $null}
}
$access=Get-StudioAccess
if(!$access){
 $entry=Join-Path $PSScriptRoot 'src\server.mjs'
 $null=Start-Process -FilePath $node -ArgumentList @('"'+$entry+'"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $studioData 'panel-out.log') -RedirectStandardError (Join-Path $studioData 'panel-error.log')
 for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 300;$access=Get-StudioAccess;if($access){break}}
 if(!$access){throw ('Panel did not start. Check '+(Join-Path $studioData 'panel-error.log'))}
}
if(!$NoOpen){Start-Process $access.url}
Write-Output ('Meme Studio ready: '+$access.origin)
