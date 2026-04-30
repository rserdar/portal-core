param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $false)]
  [string]$OutputPath = "src\data\certificate-history.json"
)

$ErrorActionPreference = "Stop"

function Normalize-CellValue {
  param([object]$Value)

  if ($null -eq $Value) { return "" }

  $text = [string]$Value
  $text = $text -replace "\r\n?", "`n"
  $text = $text -replace "[ \t]+", " "
  $text = $text -replace "\n{3,}", "`n`n"
  return $text.Trim()
}

function Normalize-StandardValue {
  param([string]$Value)

  $text = Normalize-CellValue $Value
  if (-not $text) { return "" }
  return $text.ToUpper([System.Globalization.CultureInfo]::GetCultureInfo("tr-TR"))
}

function Get-WorksheetByName {
  param($Workbook, [string]$Name)

  foreach ($sheet in $Workbook.Worksheets) {
    if ([string]$sheet.Name -eq $Name) {
      return $sheet
    }
  }

  throw "Worksheet '$Name' bulunamadi."
}

$resolvedInput = Resolve-Path -LiteralPath $InputPath
$resolvedOutput = Join-Path (Get-Location) $OutputPath
$outputDir = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$excel = $null
$workbook = $null

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false

  $workbook = $excel.Workbooks.Open($resolvedInput.Path, 0, $true)
  $sheet = Get-WorksheetByName -Workbook $workbook -Name "certificates"
  $lastRow = $sheet.UsedRange.Rows.Count

  $items = New-Object System.Collections.Generic.List[object]
  $standardCounts = @{}
  $eaFilled = 0
  $naceFilled = 0

  for ($row = 2; $row -le $lastRow; $row++) {
    $standard = Normalize-StandardValue $sheet.Cells.Item($row, 1).Text
    $kapsam = Normalize-CellValue $sheet.Cells.Item($row, 2).Text
    $scope = Normalize-CellValue $sheet.Cells.Item($row, 3).Text
    $ea = Normalize-CellValue $sheet.Cells.Item($row, 4).Text
    $nace = Normalize-CellValue $sheet.Cells.Item($row, 5).Text

    if (-not ($standard -or $kapsam -or $scope -or $ea -or $nace)) {
      continue
    }

    if (-not $standardCounts.ContainsKey($standard)) {
      $standardCounts[$standard] = 0
    }
    $standardCounts[$standard] += 1

    if ($ea) { $eaFilled += 1 }
    if ($nace) { $naceFilled += 1 }

    $items.Add([ordered]@{
      id = $items.Count + 1
      standard = $standard
      kapsam = $kapsam
      scope = $scope
      ea = $ea
      nace = $nace
    })
  }

  $payload = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    source_file = $resolvedInput.Path
    stats = [ordered]@{
      total_rows = $items.Count
      standards = $standardCounts
      ea_filled = $eaFilled
      nace_filled = $naceFilled
    }
    items = $items
  }

  $json = $payload | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($resolvedOutput, $json, [System.Text.Encoding]::UTF8)

  Write-Output "Aktarildi: $resolvedOutput"
  Write-Output "Kayit sayisi: $($items.Count)"
  Write-Output "EA dolu satir: $eaFilled"
  Write-Output "NACE dolu satir: $naceFilled"
}
finally {
  if ($workbook) {
    $workbook.Close($false)
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($workbook) | Out-Null
  }
  if ($excel) {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
