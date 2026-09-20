output "job_asset_ecr_url" {
  value = aws_ecr_repository.job_asset_service.repository_url
}
output "github_actions_ci_role_arn" {
  value = aws_iam_role.github_actions_ci.arn
}
