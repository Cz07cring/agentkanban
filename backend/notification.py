"""Agent Kanban - Notification Manager (Web Push stub)"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

logger = logging.getLogger("agentkanban.notification")


class NotificationManager:
    """Manages Web Push notification subscriptions and delivery.

    Currently a stub — push delivery requires VAPID keys and a push service.
    Notifications are stored in-memory and served via API polling.
    """

    def __init__(self):
        self.subscriptions: List[dict] = []
        self.notifications: List[dict] = []
        self._max_stored = 100

    def add_subscription(self, subscription: dict):
        """Register a push subscription."""
        # Deduplicate by endpoint
        self.subscriptions = [
            s for s in self.subscriptions
            if s.get("endpoint") != subscription.get("endpoint")
        ]
        self.subscriptions.append(subscription)
        logger.info(f"Push subscription added (total: {len(self.subscriptions)})")

    def remove_subscription(self, endpoint: str):
        """Remove a push subscription."""
        self.subscriptions = [
            s for s in self.subscriptions if s.get("endpoint") != endpoint
        ]

    def notify(self, title: str, body: str, data: Optional[dict] = None):
        """Send a notification to all subscribers.

        Currently stores in-memory. In production, would use web-push library.
        """
        notification = {
            "title": title,
            "body": body,
            "data": data or {},
        }
        self.notifications.append(notification)

        # Trim old notifications
        if len(self.notifications) > self._max_stored:
            self.notifications = self.notifications[-self._max_stored:]

        logger.info(f"Notification: {title} — {body}")

    def get_recent(self, limit: int = 20) -> List[dict]:
        """Get recent notifications."""
        return list(reversed(self.notifications[-limit:]))

    def clear(self):
        """Clear all notifications."""
        self.notifications.clear()


# Singleton
notification_manager = NotificationManager()
