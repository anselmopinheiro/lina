$source = "D:\_dev\obsidian\lina"
$target = "D:\anselmo\__obsidian__\zettel\.obsidian\plugins\lina"

Write-Host "A copiar Lina para vault de testes..."

$files = @(
    "main.js",
    "manifest.json",
    "styles.css"
)

if (!(Test-Path $target)) {
    New-Item -ItemType Directory -Path $target | Out-Null
}

foreach ($file in $files) {
    $origin = Join-Path $source $file
    $dest = Join-Path $target $file

    if (Test-Path $origin) {
        Copy-Item $origin $dest -Force
        Write-Host "Copiado: $file"
    }
    else {
        Write-Warning "Não encontrado: $file"
    }
}

Write-Host "Concluído."