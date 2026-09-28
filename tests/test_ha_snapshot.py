"""Business boundaries for the HA snapshot derived from AL1S responses."""

import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "al1s_snapshot", Path(__file__).resolve().parents[1] / "custom_components/al1s_wms/snapshot.py"
)
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


class SnapshotTest(unittest.TestCase):
    def test_opened_stock_is_still_in_total_and_uses_earlier_expiry(self):
        item = {"id": "milk", "name": "Milk", "baseUnit": "bottle", "quantity": 2, "reorderPoint": 3}
        batch = {"itemId": "milk", "itemName": "Milk", "baseUnit": "bottle", "quantity": 2,
                 "batchId": "b1", "locationId": "fridge", "locationName": "Fridge", "expiryDate": "2026-10-08"}
        opened = {"id": "o1", "itemId": "milk", "itemName": "Milk", "baseUnit": "bottle",
                  "quantity": 1, "batchId": "b1", "locationId": "fridge", "locationName": "Fridge",
                  "expiryDate": "2026-10-08", "openedExpiryDate": "2026-10-03", "openedAt": "2026-09-29T08:00:00Z"}
        overview = {"generatedAt": "2026-09-29T08:00:00Z", "expiryWindow": {"days": 30}}
        details = snapshot.build_details(overview, [item], [batch], [opened], [], "https://inventory.test")
        self.assertEqual(details["low_stock"][0]["suggested_quantity"], 1)
        self.assertEqual(details["opened"][0]["expiry_date"], "2026-10-03")
        data = {"details": details, "batches": [batch], "url": "https://inventory.test"}
        attributes = snapshot.item_attributes(data, item)
        self.assertEqual((attributes["opened_quantity"], attributes["unopened_quantity"]), (1, 1))
        self.assertEqual(attributes["locations"][0]["quantity"], 2)
        self.assertEqual(attributes["next_opened_expiry_date"], "2026-10-03")

    def test_original_batch_expiry_and_opened_expiry_are_separate(self):
        overview = {"generatedAt": "2026-09-29T08:00:00Z", "expiryWindow": {"days": 30}}
        item = {"id": "shampoo", "name": "Shampoo", "baseUnit": "bottle", "quantity": 1, "reorderPoint": 0}
        batch = {"itemId": "shampoo", "itemName": "Shampoo", "baseUnit": "bottle", "quantity": 1,
                 "batchId": "b1", "expiryDate": "2027-09-01", "locationId": "bath", "locationName": "Bathroom"}
        opened = {"id": "o1", "itemId": "shampoo", "itemName": "Shampoo", "baseUnit": "bottle", "quantity": 1,
                  "batchId": "b1", "expiryDate": "2027-09-01", "openedExpiryDate": "2026-09-30",
                  "locationId": "bath", "locationName": "Bathroom", "openedAt": "2026-09-01T00:00:00Z"}
        details = snapshot.build_details(overview, [item], [batch], [opened], [], "https://inventory.test")
        self.assertEqual(details["expiring"], [])
        self.assertEqual(details["opened"][0]["days_remaining"], 1)
        self.assertEqual(snapshot.item_attributes({"details": details, "batches": [batch], "url": "https://inventory.test"}, item)["next_expiry_date"], "2027-09-01")


if __name__ == "__main__":
    unittest.main()
