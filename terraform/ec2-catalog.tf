# -----------------------------------------------------------------------------
# Catalog Service EC2 Instance
# Runs in a private subnet behind the ALB. Uses IAM instance profile for
# CloudWatch metrics and Secrets Manager access. Detailed monitoring enabled
# for 1-minute metric intervals.
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# AMI — Latest Amazon Linux 2023
# -----------------------------------------------------------------------------

data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

# -----------------------------------------------------------------------------
# EC2 Instance — Catalog Service
# t3.micro in private subnet with EC2 security group and IAM instance profile.
# User data installs Node.js 20 and sets up the catalog service placeholder.
# -----------------------------------------------------------------------------

resource "aws_instance" "catalog" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.private_a.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  # Detailed monitoring — 1-minute CloudWatch metric intervals
  monitoring = true

  user_data = base64encode(templatefile("${path.module}/templates/catalog-user-data.sh.tftpl", {
    db_host        = aws_db_instance.main.address
    db_port        = tostring(aws_db_instance.main.port)
    db_name        = aws_db_instance.main.db_name
    secret_arn     = aws_secretsmanager_secret.db_credentials.arn
    aws_region     = var.aws_region
    project_name   = var.project_name
    environment    = var.environment
  }))

  tags = {
    Name = "${var.project_name}-${var.environment}-catalog"
  }
}

# -----------------------------------------------------------------------------
# Target Group Attachment — Register catalog instance with ALB target group
# -----------------------------------------------------------------------------

resource "aws_lb_target_group_attachment" "catalog" {
  target_group_arn = aws_lb_target_group.catalog.arn
  target_id        = aws_instance.catalog.id
  port             = 3000
}
