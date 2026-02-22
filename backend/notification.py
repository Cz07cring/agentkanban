"""Web Push notification delivery via VAPID (pywebpush)."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

from filelock import FileLock

logger = logging.getLogger("agentkanban.notification")

# --- Config ---
_DATA_DIR = Path(__file__).parent / "data"
_SUBS_FILE = _DATA_DIR / "push-subscriptions.json"
_SUBS_LOCK = _DATA_DIR / "push-subscriptions.lock"

VAPID_PRIVATE_KEY: Optional[str] = os.getenv("VAPID_PRIVATE_KEY")
VAPID_PUBLIC_KEY: Optional[str] = os.getenv("VAPID_PUBLIC_KEY")
VAPID_CLAIM_EMAIL: str = os.getenv("VAPID_CLAIM_EMAIL", "admin@agentkanban.local")

_push_enabled: bool = bool(VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY)


def _load_subscriptions() -> list[dict]:
    lock = FileLock(str(_SUBS_LOCK))
    with lock:
        if not _SUBS_FILE.exists():
            return []
        try:
            return json.loads(_SUBS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, ValueError):
            logger.warning("Push subscriptions file corrupted, returning empty list")
            return []


def _save_subscriptions(subs: list[dict]) -> None:
    lock = FileLock(str(_SUBS_LOCK))
    with lock:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        _SUBS_FILE.write_text(
            json.dumps(subs, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def add_subscription(subscription: dict) -> None:
    """Persist a new push subscription (idempotent by endpoint)."""
    endpoint = subscription.get("endpoint", "")
    if not endpoint:
        return
    subs = _load_subscriptions()
    subs = [s for s in subs if s.get("endpoint") != endpoint]
    subs.append(subscription)
    _save_subscriptions(subs)


def remove_subscription(endpoint: str) -> None:
    """Remove a subscription by endpoint (called on 410 Gone)."""
    subs = _load_subscriptions()
    subs = [s for s in subs if s.get("endpoint") != endpoint]
    _save_subscriptions(subs)


def get_vapid_public_key() -> Optional[str]:
    """Return the VAPID public key, or None if not configured."""
    return VAPID_PUBLIC_KEY


async def send_push_notification(
    title: str,
    body: str,
    data: Optional[dict[str, Any]] = None,
) -> None:
    """Send a push notification to all stored subscriptions.

    Silently no-ops if VAPID keys are not configured.
    Removes subscriptions that return 410 Gone (expired).
    """
    if not _push_enabled:
        return

    try:
        from pywebpush import webpush, WebPushException  # type: ignore[import-untyped]
    except ImportError:
        logger.warning("pywebpush not installed — push notifications disabled")
        return

    payload = json.dumps({"title": title, "body": body, "data": data or {}})
    vapid_claims = {"sub": f"mailto:{VAPID_CLAIM_EMAIL}"}

    subs = _load_subscriptions()
    stale_endpoints: list[str] = []

    for sub in subs:
        endpoint = sub.get("endpoint", "")
        try:
            webpush(
                subscription_info=sub,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=vapid_claims,
            )
        except WebPushException as exc:
            if getattr(exc, "response", None) is not None and exc.response.status_code == 410:
                stale_endpoints.append(endpoint)
                logger.info("Push subscription expired (410), removing: %s…", endpoint[:40])
            else:
                logger.warning("Push send failed for %s…: %s", endpoint[:40], exc)
        except Exception:  # noqa: BLE001
            logger.warning("Push send error for %s…", endpoint[:40], exc_info=True)

    if stale_endpoints:
        updated = _load_subscriptions()
        updated = [s for s in updated if s.get("endpoint") not in stale_endpoints]
        _save_subscriptions(updated)
