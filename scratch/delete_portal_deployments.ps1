$projectName = "portal"
try {
    $json = npx wrangler pages deployment list --project-name $projectName --json
    if ($null -eq $json -or $json -eq "") {
        Write-Host "Deployment bulunamadı veya proje mevcut değil."
        exit
    }
    $deployments = $json | ConvertFrom-Json
    Write-Host "Toplam $($deployments.Count) adet deployment bulundu."
    
    foreach ($d in $deployments) {
        Write-Host "Siliniyor: $($d.id) ($($d.url))"
        npx wrangler pages deployment delete $d.id --project-name $projectName --force
    }
    
    Write-Host "Tüm deploymentlar silindi. Şimdi projeyi tamamen silmeyi deneyebilirsiniz."
} catch {
    Write-Error "Bir hata oluştu: $_"
}
