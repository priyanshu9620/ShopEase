variable "region" {
  description = "AWS region. The account is region-locked to Sydney (D-21)."
  type        = string
  default     = "ap-southeast-2"
}

variable "aws_profile" {
  description = "Local AWS CLI profile holding the terraform-shopease key."
  type        = string
  default     = "shopease"
}

variable "app_replicas" {
  description = "Number of app EC2 instances behind the ALB (resume: 3)."
  type        = number
  default     = 3
}

variable "instance_type" {
  description = "App instance size. t3.micro = 2 vCPU burst, 1 GiB; the image is linux/amd64."
  type        = string
  default     = "t3.micro"
}

variable "data_instance_type" {
  description = "Size of the single Mongo+Redis instance (D-22). Not needed once Atlas is used."
  type        = string
  default     = "t3.small"
}

variable "image_tag" {
  description = "ECR image tag the instances run at boot. CI rolls new tags afterwards."
  type        = string
  default     = "latest"
}

variable "loadgen" {
  description = "Create the t3.small k6 load-generator instance (benchmark sessions only)."
  type        = bool
  default     = true
}

variable "cache_enabled" {
  description = "Redis cache-aside on the deployed app (\"true\" / \"false\"). Toggle + `deploy.sh` to re-read."
  type        = string
  default     = "true"
}

variable "github_repo" {
  description = "GitHub repo allowed to assume the deploy role via OIDC (owner/name)."
  type        = string
  default     = "priyanshu9620/ShopEase"
}

# --- application secrets: written to SSM Parameter Store (SecureString), read by instances at boot.
# Set them in infra/terraform.tfvars (git-ignored). Never commit them.
variable "jwt_secret" {
  type      = string
  sensitive = true
}
variable "braintree_merchant_id" {
  type      = string
  sensitive = true
}
variable "braintree_public_key" {
  type      = string
  sensitive = true
}
variable "braintree_private_key" {
  type      = string
  sensitive = true
}
variable "mongo_url" {
  description = "Leave empty to use the data instance's Mongo (D-22); set to the Atlas URL to use Atlas."
  type        = string
  sensitive   = true
  default     = ""
}
