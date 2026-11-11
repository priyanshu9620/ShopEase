output "alb_dns" {
  description = "Public URL of the app"
  value       = "http://${aws_lb.app.dns_name}"
}

output "ecr_repository" {
  value = aws_ecr_repository.app.repository_url
}

output "github_deploy_access_key_id" {
  description = "GitHub Actions secret AWS_ACCESS_KEY_ID"
  value       = aws_iam_access_key.github_deploy.id
}

output "github_deploy_secret_access_key" {
  description = "GitHub Actions secret AWS_SECRET_ACCESS_KEY (tofu output -raw …)"
  value       = aws_iam_access_key.github_deploy.secret
  sensitive   = true
}

output "app_instance_ids" {
  value = aws_instance.app[*].id
}

output "data_instance_private_ip" {
  value = aws_instance.data.private_ip
}

output "target_group_arn" {
  value = aws_lb_target_group.app.arn
}
