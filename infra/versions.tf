# OpenTofu / Terraform entry. One `tofu apply` builds the whole AWS stack, one `tofu destroy` removes it.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.82.2" # pinned exactly (no floating versions in this repo)
    }
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = { Project = "shopease", ManagedBy = "opentofu" }
  }
}
