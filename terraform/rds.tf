# -----------------------------------------------------------------------------
# RDS PostgreSQL Instance
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# DB Subnet Group — spans both private subnets for RDS placement
# -----------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name = "${var.project_name}-${var.environment}-db-subnet-group"

  subnet_ids = [
    aws_subnet.private_a.id,
    aws_subnet.private_b.id,
  ]

  tags = {
    Name = "${var.project_name}-${var.environment}-db-subnet-group"
  }
}

# -----------------------------------------------------------------------------
# RDS PostgreSQL 15 Instance
# Placed in private subnet, not publicly accessible, encrypted at rest.
# Credentials sourced from Secrets Manager via random_password resource.
# -----------------------------------------------------------------------------

resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-${var.environment}-db"
  engine         = "postgres"
  engine_version = "15"
  instance_class = "db.t3.micro"

  allocated_storage = 20
  storage_encrypted = true

  db_name  = "demodb"
  username = var.db_username
  password = random_password.db_password.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  publicly_accessible = false
  multi_az            = false
  skip_final_snapshot = true

  tags = {
    Name = "${var.project_name}-${var.environment}-db"
  }
}
