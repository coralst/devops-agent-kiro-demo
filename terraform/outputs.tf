output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "s3_website_url" {
  description = "S3 static website endpoint for the frontend"
  value       = aws_s3_bucket_website_configuration.frontend.website_endpoint
  # Note: website_endpoint is on aws_s3_bucket_website_configuration in AWS Provider >= 4.0
}

output "rds_endpoint" {
  description = "RDS PostgreSQL instance endpoint"
  value       = aws_db_instance.main.endpoint
}

output "sns_topic_arn" {
  description = "ARN of the SNS topic for CloudWatch alarm notifications"
  value       = aws_sns_topic.alarms.arn
}

output "s3_bucket_name" {
  description = "Name of the S3 bucket hosting the frontend (used by app-down.sh)"
  value       = aws_s3_bucket.frontend.id
}
