# -----------------------------------------------------------------------------
# Application Load Balancer, Target Groups, and Routing Rules
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Application Load Balancer
# Deployed in public subnets, internet-facing, using the ALB security group.
# -----------------------------------------------------------------------------

resource "aws_lb" "main" {
  name               = "${var.project_name}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]

  tags = {
    Name = "${var.project_name}-${var.environment}-alb"
  }
}

# -----------------------------------------------------------------------------
# Target Group — Catalog Service
# Routes to Catalog EC2 instance on port 3000 with health check on
# /api/catalog/health.
# -----------------------------------------------------------------------------

resource "aws_lb_target_group" "catalog" {
  name     = "${var.project_name}-${var.environment}-catalog-tg"
  port     = 3000
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = "/api/catalog/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-catalog-tg"
  }
}

# -----------------------------------------------------------------------------
# Target Group — Orders Service
# Routes to Orders EC2 instance on port 3000 with health check on
# /api/orders/health.
# -----------------------------------------------------------------------------

resource "aws_lb_target_group" "orders" {
  name     = "${var.project_name}-${var.environment}-orders-tg"
  port     = 3000
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = "/api/orders/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-orders-tg"
  }
}

# -----------------------------------------------------------------------------
# HTTP Listener — Port 80
# Default action returns a 404 fixed response for unmatched paths.
# -----------------------------------------------------------------------------

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\": \"Not Found\"}"
      status_code  = "404"
    }
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-http-listener"
  }
}

# -----------------------------------------------------------------------------
# Listener Rule — Catalog Service
# Forwards /api/catalog/* requests to the Catalog target group.
# -----------------------------------------------------------------------------

resource "aws_lb_listener_rule" "catalog" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.catalog.arn
  }

  condition {
    path_pattern {
      values = ["/api/catalog/*"]
    }
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-catalog-rule"
  }
}

# -----------------------------------------------------------------------------
# Listener Rule — Orders Service
# Forwards /api/orders/* requests to the Orders target group.
# -----------------------------------------------------------------------------

resource "aws_lb_listener_rule" "orders" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 200

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.orders.arn
  }

  condition {
    path_pattern {
      values = ["/api/orders/*"]
    }
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-orders-rule"
  }
}
