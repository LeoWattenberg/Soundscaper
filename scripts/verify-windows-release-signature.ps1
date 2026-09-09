param([Parameter(Mandatory=$true)][string]$Artifact)
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $Artifact
if ($signature.Status -ne 'Valid') { throw "Release signature is not valid: $Artifact" }
if (-not $signature.TimeStamperCertificate) { throw "Release signature has no timestamp: $Artifact" }
if ($env:WINDOWS_PUBLISHER_NAME -and $signature.SignerCertificate.GetNameInfo('SimpleName', $false) -ne $env:WINDOWS_PUBLISHER_NAME) {
    throw "Release signature has the wrong publisher: $Artifact"
}
