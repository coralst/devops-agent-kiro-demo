output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name for the frontend"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (used for cache invalidation)"
  value       = aws_cloudfront_distribution.frontend.id
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
