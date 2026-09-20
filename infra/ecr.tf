resource "aws_ecr_repository" "job_asset_service" {
  name                 = "tvp/job-asset-service"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}