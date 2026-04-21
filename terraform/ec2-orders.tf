# -----------------------------------------------------------------------------
# Orders Service EC2 Instance with Dedicated EBS Volume
# Runs in a private subnet behind the ALB. Uses IAM instance profile for
# CloudWatch metrics and Secrets Manager access. Detailed monitoring enabled
# for 1-minute metric intervals. A dedicated gp3 EBS volume is attached and
# mounted at /mnt/ebs-data — this volume is the fault injection target.
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# EC2 Instance — Orders Service
# t3.micro in private subnet with EC2 security group and IAM instance profile.
# User data installs Node.js 20, fio, formats/mounts the EBS volume, and sets
# up the orders service placeholder.
# -----------------------------------------------------------------------------

resource "aws_instance" "orders" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.private_a.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  # Detailed monitoring — 1-minute CloudWatch metric intervals
  monitoring = true

  user_data = base64encode(templatefile("${path.module}/templates/orders-user-data.sh.tftpl", {
    db_host        = aws_db_instance.main.address
    db_port        = tostring(aws_db_instance.main.port)
    db_name        = aws_db_instance.main.db_name
    secret_arn     = aws_secretsmanager_secret.db_credentials.arn
    aws_region     = var.aws_region
    s3_bucket      = aws_s3_bucket.frontend.id
    project_name   = var.project_name
    environment    = var.environment
    ebs_device     = "/dev/xvdf"
    ebs_mount_path = "/mnt/ebs-data"
  }))

  tags = {
    Name = "${var.project_name}-${var.environment}-orders"
  }
}

# -----------------------------------------------------------------------------
# Dedicated EBS Volume — gp3, 20 GB, encrypted
# This volume is the fault injection target. It is attached to the Orders EC2
# instance and mounted at /mnt/ebs-data by the user data script.
# -----------------------------------------------------------------------------

resource "aws_ebs_volume" "orders_data" {
  availability_zone = aws_subnet.private_a.availability_zone
  size              = 2
  type              = "gp3"
  encrypted         = true

  tags = {
    Name = "${var.project_name}-${var.environment}-orders-data"
  }
}

# -----------------------------------------------------------------------------
# Volume Attachment — Attach the dedicated EBS volume to the Orders instance
# -----------------------------------------------------------------------------

resource "aws_volume_attachment" "orders_data" {
  device_name = "/dev/xvdf"
  volume_id   = aws_ebs_volume.orders_data.id
  instance_id = aws_instance.orders.id
}

# -----------------------------------------------------------------------------
# Target Group Attachment — Register orders instance with ALB target group
# -----------------------------------------------------------------------------

resource "aws_lb_target_group_attachment" "orders" {
  target_group_arn = aws_lb_target_group.orders.arn
  target_id        = aws_instance.orders.id
  port             = 3000
}
