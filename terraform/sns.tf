# -----------------------------------------------------------------------------
# SNS Topic for CloudWatch Alarm Notifications
# Receives alarm state change events (ALARM and OK) from all CloudWatch alarms.
# Downstream consumers (e.g., DevOps agent) subscribe to this topic.
# -----------------------------------------------------------------------------

resource "aws_sns_topic" "alarms" {
  name = "${var.project_name}-${var.environment}-alarms"

  tags = {
    Name = "${var.project_name}-${var.environment}-alarms"
  }
}
