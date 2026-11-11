output "alb_dns" {
  description = "Public URL of the app"
  value       = "http://${aws_lb.app.dns_name}"
}

output "ecr_repository" {
  value = aws_ecr_repository.app.repository_url
}

output "github_deploy_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN repository variable in GitHub"
  value       = aws_iam_role.github_deploy.arn
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
