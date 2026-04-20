variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "devops-demo"
}

variable "db_username" {
  description = "Master username for the RDS PostgreSQL instance"
  type        = string
  default     = "demoadmin"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "environment" {
  description = "Environment name for tagging and resource naming"
  type        = string
  default     = "demo"
}
