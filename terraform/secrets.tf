resource "random_password" "db_password" {
  length           = 24
  special          = true
  override_special = "!#$%&*()-_=+[]{}|:,.?"
}

resource "aws_secretsmanager_secret" "db_credentials" {
  name = "${var.project_name}-${var.environment}-db-credentials"

  tags = {
    Name = "${var.project_name}-${var.environment}-db-credentials"
  }
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id

  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db_password.result
  })
}
