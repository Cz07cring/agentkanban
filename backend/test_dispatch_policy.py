from __future__ import annotations

from unittest import TestCase

from backend.dispatcher import _sla_rank


class DispatchPolicyTests(TestCase):
    def test_sla_rank_prefers_urgent(self):
        self.assertLess(_sla_rank({"sla_tier": "urgent"}), _sla_rank({"sla_tier": "standard"}))
