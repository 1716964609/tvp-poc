data "aws_iam_openid_connect_provider" "github" {
  arn = "arn:aws:iam::180294215932:oidc-provider/token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_actions_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type = "Federated"
      identifiers = [
        data.aws_iam_openid_connect_provider.github.arn
      ]
    }

    actions = [
      "sts:AssumeRoleWithWebIdentity"
    ]

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values = [
        "sts.amazonaws.com"
      ]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:1716964609@100065427/tvp-poc@1378389018:ref:refs/heads/main"
      ]
    }
  }
}

resource "aws_iam_role" "github_actions_ci" {
  name = "tvp-github-actions-ci"

  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role.json

  tags = {
    Project   = "tvp-poc"
    Terraform = "true"
  }
}

data "aws_iam_policy_document" "github_actions_ecr" {
  statement {
    sid    = "ECRLogin"
    effect = "Allow"

    actions = [
      "ecr:GetAuthorizationToken"
    ]

    resources = ["*"]
  }

  statement {
    sid    = "ECRPush"
    effect = "Allow"

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage"
    ]

    resources = [
      aws_ecr_repository.job_asset_service.arn
    ]
  }
}

resource "aws_iam_role_policy" "github_actions_ci" {
  name = "tvp-github-actions-ci-ecr"
  role = aws_iam_role.github_actions_ci.id

  policy = data.aws_iam_policy_document.github_actions_ecr.json
}
