# Phase 4: static assets on S3 behind CloudFront (resume bullet 4).
#
#   CloudFront (one distribution, HTTPS, edge-cached)
#     ├── /api/*        → ALB origin (no caching; WebSockets for /socket.io/* pass through)
#     ├── /socket.io/*  → ALB origin
#     ├── /photos/*     → S3 origin (product photos uploaded by the app, immutable, cached a year)
#     └── /*            → S3 origin (the React build; 403/404 → index.html for client-side routes)
#
# The bucket is private: only CloudFront (Origin Access Control) can read it; the app instances can write
# photos; CI writes the React build.

resource "aws_s3_bucket" "assets" {
  bucket        = "shopease-assets-${data.aws_caller_identity.me.account_id}"
  force_destroy = true # destroy removes the objects too
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront → S3 with Origin Access Control (signed requests; no public bucket, no legacy OAI)
resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "shopease-assets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.assets.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.cdn.arn } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.assets]
}

# AWS-managed policies: CachingOptimized for static files, CachingDisabled + AllViewer for the API
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}
data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  comment             = "shopease: React build + photos from S3, /api and /socket.io to the ALB"
  default_root_object = "index.html"
  price_class         = "PriceClass_All" # edges everywhere, including India where the author sits

  origin {
    origin_id                = "s3-assets"
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  origin {
    origin_id   = "alb-api"
    domain_name = aws_lb.app.dns_name
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only" # the ALB listener is plain HTTP (no certificate/domain in this lab)
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior { # the React build
    target_origin_id       = "s3-assets"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
  }

  ordered_cache_behavior { # product photos: immutable objects, cache a year at the edge
    path_pattern           = "/photos/*"
    target_origin_id       = "s3-assets"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = false
  }

  ordered_cache_behavior { # API: never cached, every header/cookie/query forwarded
    path_pattern             = "/api/*"
    target_origin_id         = "alb-api"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  ordered_cache_behavior { # WebSockets (socket.io) — CloudFront proxies the upgrade to the ALB
    path_pattern             = "/socket.io/*"
    target_origin_id         = "alb-api"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  # single-page app: unknown paths are client-side routes → serve index.html
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    cloudfront_default_certificate = true # *.cloudfront.net HTTPS; a custom domain would add ACM here
  }
}

# the app instances may write photos; the deploy user may write the React build and invalidate the cache
resource "aws_iam_role_policy" "instance_s3" {
  name = "shopease-instance-s3"
  role = aws_iam_role.instance.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject"], Resource = "${aws_s3_bucket.assets.arn}/photos/*" }]
  })
}

resource "aws_iam_user_policy" "github_deploy_cdn" {
  name = "shopease-github-deploy-cdn"
  user = aws_iam_user.github_deploy.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.assets.arn },
      { Effect = "Allow", Action = ["s3:PutObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.assets.arn}/*" },
      { Effect = "Allow", Action = ["cloudfront:CreateInvalidation"], Resource = aws_cloudfront_distribution.cdn.arn },
    ]
  })
}

output "cdn_url" {
  description = "Public HTTPS URL of the app through CloudFront"
  value       = "https://${aws_cloudfront_distribution.cdn.domain_name}"
}
output "assets_bucket" {
  value = aws_s3_bucket.assets.bucket
}
output "cdn_distribution_id" {
  value = aws_cloudfront_distribution.cdn.id
}
