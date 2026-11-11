# ShopEase on AWS: 3 × EC2 behind an Application Load Balancer, images from ECR, secrets from SSM,
# a GitHub Actions OIDC role for CI/CD, and (until Atlas) one data instance with Mongo + Redis.
#
# Every resource has a one-line "what / why" so it maps to what you build by hand in the console.

# ---------------------------------------------------------------------------------------------
# Network: the default VPC (one per region, public subnets in 3 AZs). Enough for this project;
# a custom VPC with private subnets + NAT would cost ~$35/month for the NAT alone.
# ---------------------------------------------------------------------------------------------
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

# Latest Amazon Linux 2023 AMI, resolved through the public SSM parameter so it never goes stale.
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

data "aws_caller_identity" "me" {}

# ---------------------------------------------------------------------------------------------
# Security groups = the firewall. Internet → ALB:80 only; ALB → app:8080 only; app → data:27017/6379 only.
# ---------------------------------------------------------------------------------------------
resource "aws_security_group" "alb" {
  name        = "shopease-alb"
  description = "ALB: HTTP from the internet"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "app" {
  name        = "shopease-app"
  description = "App instances: 8080 from the ALB only (no SSH; use SSM Session Manager)"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "data" {
  name        = "shopease-data"
  description = "Mongo + Redis: reachable from app instances only"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port       = 27017
    to_port         = 27017
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ---------------------------------------------------------------------------------------------
# ECR: the private image registry the instances pull from with their IAM role (no registry token).
# ---------------------------------------------------------------------------------------------
resource "aws_ecr_repository" "app" {
  name                 = "shopease"
  image_tag_mutability = "MUTABLE" # :latest moves; CI also pushes immutable :<sha> tags
  force_delete         = true      # destroy deletes images too, so teardown is one command
}

# ---------------------------------------------------------------------------------------------
# Secrets: SSM Parameter Store (SecureString, free). Instances read /shopease/* at boot.
# ---------------------------------------------------------------------------------------------
locals {
  mongo_url = var.mongo_url != "" ? var.mongo_url : "mongodb://${aws_instance.data.private_ip}:27017"
  redis_url = "redis://${aws_instance.data.private_ip}:6379"
  params = {
    JWT_SECRET            = var.jwt_secret
    BRAINTREE_MERCHANT_ID = var.braintree_merchant_id
    BRAINTREE_PUBLIC_KEY  = var.braintree_public_key
    BRAINTREE_PRIVATE_KEY = var.braintree_private_key
    MONGO_URL             = local.mongo_url
    REDIS_URL             = local.redis_url
    CACHE_ENABLED         = var.cache_enabled # not a secret, but the instances read all /shopease/* params as their env
    PHOTO_STORAGE         = "s3"              # Phase 4: photos uploaded to S3 and served from CloudFront
    PHOTO_BUCKET          = aws_s3_bucket.assets.bucket
    PHOTO_CDN_URL         = "https://${aws_cloudfront_distribution.cdn.domain_name}"
    AWS_REGION            = var.region
  }
}

resource "aws_ssm_parameter" "app" {
  for_each  = local.params
  name      = "/shopease/${each.key}"
  type      = "SecureString"
  value     = each.value
  overwrite = true # a parameter may have been set by hand (e.g. CACHE_ENABLED during a benchmark); take it over
}

# ---------------------------------------------------------------------------------------------
# IAM for the instances: SSM (remote commands, no SSH), pull from ECR, read /shopease/* params.
# ---------------------------------------------------------------------------------------------
resource "aws_iam_role" "instance" {
  name = "shopease-instance"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "instance_ssm" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "instance" {
  name = "shopease-instance"
  role = aws_iam_role.instance.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      { Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], Resource = aws_ecr_repository.app.arn },
      { Effect = "Allow", Action = ["ssm:GetParameters", "ssm:GetParametersByPath"], Resource = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.me.account_id}:parameter/shopease/*" },
    ]
  })
}

resource "aws_iam_instance_profile" "instance" {
  name = "shopease-instance"
  role = aws_iam_role.instance.name
}

# ---------------------------------------------------------------------------------------------
# Data instance (D-22): Mongo 7 + Redis 7 in Docker, data on the root volume. Replace with Atlas by
# setting var.mongo_url; this instance then only serves Redis.
# ---------------------------------------------------------------------------------------------
resource "aws_instance" "data" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.data_instance_type
  subnet_id              = sort(data.aws_subnets.default.ids)[0]
  vpc_security_group_ids = [aws_security_group.data.id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name
  user_data              = file("${path.module}/user-data-data.sh")
  credit_specification {
    cpu_credits = "unlimited" # t3 burst credits ran out mid-benchmark (P-30); unlimited costs cents, not stalls
  }
  root_block_device {
    volume_size = 20
  }
  tags = { Name = "shopease-data", Role = "data" }
}

# ---------------------------------------------------------------------------------------------
# Load generator (optional, var.loadgen): runs k6 in the same region so benchmarks measure the
# servers, not the laptop's internet path. Never on the data instance — k6 starves Mongo/Redis (P-25).
# ---------------------------------------------------------------------------------------------
resource "aws_instance" "loadgen" {
  count                  = var.loadgen ? 1 : 0
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = "t3.small"
  subnet_id              = sort(data.aws_subnets.default.ids)[1]
  vpc_security_group_ids = [aws_security_group.app.id] # outbound only is what it needs
  iam_instance_profile   = aws_iam_instance_profile.instance.name
  user_data              = "#!/bin/bash\ndnf install -y docker && systemctl enable --now docker && docker pull grafana/k6:0.55.0\n"
  credit_specification {
    cpu_credits = "unlimited"
  }
  tags = { Name = "shopease-loadgen", Role = "loadgen" }
}

# ---------------------------------------------------------------------------------------------
# App instances: one per AZ (round-robin over the subnets), pull the image and run it at boot.
# ---------------------------------------------------------------------------------------------
resource "aws_instance" "app" {
  count                  = var.app_replicas
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = sort(data.aws_subnets.default.ids)[count.index % length(data.aws_subnets.default.ids)]
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name
  user_data = templatefile("${path.module}/user-data-app.sh", {
    region    = var.region
    ecr_url   = aws_ecr_repository.app.repository_url
    image_tag = var.image_tag
  })
  user_data_replace_on_change = true
  credit_specification {
    cpu_credits = "unlimited"
  }
  depends_on = [aws_ssm_parameter.app]
  tags       = { Name = "shopease-app-${count.index + 1}", Role = "app" }
}

# ---------------------------------------------------------------------------------------------
# Application Load Balancer: public entry point, spreads requests over the healthy app instances.
# Health check = GET /healthz every 10 s; 2 failures → out of rotation; deregistration delay 15 s
# (the app drains in-flight requests on SIGTERM within that window — experiment 04 on real infra).
# ---------------------------------------------------------------------------------------------
resource "aws_lb" "app" {
  name               = "shopease"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids
}

resource "aws_lb_target_group" "app" {
  name                 = "shopease-app"
  port                 = 8080
  protocol             = "HTTP"
  vpc_id               = data.aws_vpc.default.id
  deregistration_delay = 15
  health_check {
    path                = "/healthz"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
    matcher             = "200"
  }
}

resource "aws_lb_target_group_attachment" "app" {
  count            = var.app_replicas
  target_group_arn = aws_lb_target_group.app.arn
  target_id        = aws_instance.app[count.index].id
  port             = 8080
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

# ---------------------------------------------------------------------------------------------
# GitHub Actions → AWS. The preferred way is an OIDC identity provider (no long-lived keys), but the
# free-plan project's service control policy denies iam:CreateOpenIDConnectProvider (P-22). Fallback:
# a dedicated IAM user with the minimum deploy policy; its key goes into GitHub Actions secrets.
# ---------------------------------------------------------------------------------------------
resource "aws_iam_user" "github_deploy" {
  name = "shopease-github-deploy"
}

resource "aws_iam_access_key" "github_deploy" {
  user = aws_iam_user.github_deploy.name
}

resource "aws_iam_user_policy" "github_deploy" {
  name = "shopease-github-deploy"
  user = aws_iam_user.github_deploy.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      { Effect = "Allow", Action = ["ecr:*"], Resource = aws_ecr_repository.app.arn },
      { Effect = "Allow", Action = ["ec2:DescribeInstances", "elasticloadbalancing:DescribeTargetHealth", "elasticloadbalancing:DescribeTargetGroups"], Resource = "*" },
      { Effect = "Allow", Action = ["elasticloadbalancing:DeregisterTargets", "elasticloadbalancing:RegisterTargets"], Resource = aws_lb_target_group.app.arn },
      { Effect = "Allow", Action = ["ssm:SendCommand"], Resource = ["arn:aws:ssm:${var.region}::document/AWS-RunShellScript", "arn:aws:ec2:${var.region}:${data.aws_caller_identity.me.account_id}:instance/*"] },
      { Effect = "Allow", Action = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"], Resource = "*" },
    ]
  })
}
