module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "6.7.2"

  name = "tvp-vpc"
  cidr = "10.10.0.0/16"

  azs = [
    "ap-northeast-1a",
    "ap-northeast-1c"
  ]

  public_subnets = [
    "10.10.1.0/24",
    "10.10.2.0/24"
  ]

  map_public_ip_on_launch = true

  enable_nat_gateway   = false
  enable_dns_support   = true
  enable_dns_hostnames = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }

  tags = {
    Project   = "tvp-poc"
    Terraform = "true"
  }
}