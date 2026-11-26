import unittest
from sales_roster import members


class SalesDirectoryTest(unittest.TestCase):
    def test_pages_and_display_names(self):
        requests = []
        def fetch(path):
            requests.append(path)
            index = len(requests)
            info = {"user_id": "user_" + str(index), "identifier": "rep@dealer.example"}
            if index == 1:
                info.update(first_name="Marty", last_name="Jones")
            return {"data": [{"role": "org:member", "public_user_data": info}], "total_count": 2}
        roster = members("org_test", fetch)
        self.assertEqual(roster, [{"id":"clerk:user_1","label":"Marty Jones"},{"id":"clerk:user_2","label":"rep@dealer.example"}])
        self.assertTrue(requests[1].endswith("offset=1"))

    def test_incomplete_snapshot_is_never_published(self):
        with self.assertRaises(ValueError):
            members("org_test", lambda path: {"data": [], "total_count": 1})


if __name__ == "__main__":
    unittest.main()
