# -----------------------------------------------------------------------------
# CloudWatch Alarms — Observability Stack
# Three alarms monitor EBS volume health, ALB 5XX errors, and API latency.
# All alarms publish state changes (ALARM and OK) to the SNS topic for
# downstream consumption by a DevOps agent.
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Alarm 1: EBS Bottleneck
# Fires when the dedicated Orders EBS volume queue length exceeds 10 for
# 2 consecutive 1-minute periods, indicating I/O saturation from fault
# injection.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "ebs_bottleneck" {
  alarm_name          = "${var.project_name}-${var.environment}-ebs-bottleneck"
  alarm_description   = "EBS VolumeQueueLength exceeds threshold — possible I/O saturation on Orders data volume"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "VolumeQueueLength"
  namespace           = "AWS/EBS"
  period              = 60
  statistic           = "Average"
  threshold           = 10

  dimensions = {
    VolumeId = aws_ebs_volume.orders_data.id
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = {
    Name = "${var.project_name}-${var.environment}-ebs-bottleneck"
  }
}

# -----------------------------------------------------------------------------
# Alarm 2: ALB 5XX Spike
# Fires when the ALB target 5XX error count exceeds 5 in a single 1-minute
# period. Missing data is treated as not breaching so the alarm stays quiet
# when there is no traffic.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "alb_5xx_spike" {
  alarm_name          = "${var.project_name}-${var.environment}-alb-5xx-spike"
  alarm_description   = "ALB target 5XX error count exceeds threshold — backend returning server errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = {
    Name = "${var.project_name}-${var.environment}-alb-5xx-spike"
  }
}

# -----------------------------------------------------------------------------
# Alarm 3: Latency Spike
# Fires when the ALB average target response time exceeds 3 seconds over
# 2 consecutive 1-minute periods, indicating degraded backend performance.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "latency_spike" {
  alarm_name          = "${var.project_name}-${var.environment}-latency-spike"
  alarm_description   = "ALB TargetResponseTime exceeds threshold — backend latency degraded"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = 3

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = {
    Name = "${var.project_name}-${var.environment}-latency-spike"
  }
}
