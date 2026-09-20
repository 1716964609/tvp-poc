output "job_asset_ecr_url" {
  value = aws_ecr_repository.job_asset_service.repository_url
}