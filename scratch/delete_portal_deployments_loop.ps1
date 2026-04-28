$projectName = "portal"
while ($true) {
    Write-Host "Deployment listesi çekiliyor..."
    $json = npx wrangler pages deployment list --project-name $projectName --json
    if ($null -eq $json -or $json -eq "[]" -or $json -eq "") {
        Write-Host "Silinecek deployment kalmadı."
        break
    }
    
    $deployments = $json | ConvertFrom-Json
    Write-Host "$($deployments.Count) adet deployment bulundu."
    
    foreach ($d in $deployments) {
        Write-Host "Siliniyor: $($d.id)"
        npx wrangler pages deployment delete $d.id --project-name $projectName --force
    }
}
Write-Host "Tüm deploymentlar silindi. Proje silmeyi deneyin."
