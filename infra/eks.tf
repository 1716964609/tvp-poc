module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "21.25.0"

  name               = "tvp-eks"
  kubernetes_version = "1.35"

  endpoint_public_access = true

  # 今Terraformを実行しているtvp-terraform userを
  # Kubernetes側のadminとして登録
  enable_cluster_creator_admin_permissions = true

  addons = {
    coredns = {}

    kube-proxy = {}

    vpc-cni = {
      before_compute = true
    }
  }

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.public_subnets

  eks_managed_node_groups = {
    tvp = {
      ami_type = "AL2023_ARM_64_STANDARD"

      instance_types = [
        "t4g.small"
      ]

      min_size     = 1
      max_size     = 2
      desired_size = 1

      capacity_type = "ON_DEMAND"
    }
  }

  tags = {
    Project   = "tvp-poc"
    Terraform = "true"
  }
}