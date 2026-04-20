# -----------------------------------------------------------------------------
# IAM Roles, Instance Profiles, and Policies for EC2 Instances
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# IAM Role — EC2 instances assume this role via instance profile
# -----------------------------------------------------------------------------

resource "aws_iam_role" "ec2" {
  name = "${var.project_name}-${var.environment}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-ec2-role"
  }
}

# -----------------------------------------------------------------------------
# Instance Profile — attached to EC2 instances at launch
# -----------------------------------------------------------------------------

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project_name}-${var.environment}-ec2-profile"
  role = aws_iam_role.ec2.name
}

# -----------------------------------------------------------------------------
# SSM Session Manager — managed policy for instance access (no SSH keys)
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# -----------------------------------------------------------------------------
# CloudWatch Metrics Publishing — inline policy for PutMetricData
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "cloudwatch_metrics" {
  name = "${var.project_name}-${var.environment}-cloudwatch-metrics"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "cloudwatch:PutMetricData"
        Resource = "*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Secrets Manager Read Access — for retrieving RDS credentials
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "secrets_manager_read" {
  name = "${var.project_name}-${var.environment}-secrets-read"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = "*"
      }
    ]
  })
}
