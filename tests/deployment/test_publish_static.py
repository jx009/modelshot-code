import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("publish_static", Path(__file__).resolve().parents[2] / "scripts/publish-static.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class StaticPublishingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "source"
        self.target = Path(self.temp.name) / "target"
        self.source.mkdir()
        self.target.mkdir()

    def test_additive_and_idempotent(self):
        (self.target / "old.js").write_bytes(b"old release")
        (self.source / "new.js").write_bytes(b"new release")
        publisher.publish(self.source, self.target)
        timestamp = (self.target / "new.js").stat().st_mtime_ns
        publisher.publish(self.source, self.target)
        self.assertEqual((self.target / "old.js").read_bytes(), b"old release")
        self.assertEqual((self.target / "new.js").stat().st_mtime_ns, timestamp)

    def test_conflict_stops_before_publishing(self):
        (self.target / "z.js").write_bytes(b"old")
        (self.source / "z.js").write_bytes(b"different")
        (self.source / "a.js").write_bytes(b"new")
        with self.assertRaisesRegex(ValueError, "conflict"):
            publisher.publish(self.source, self.target)
        self.assertEqual((self.target / "z.js").read_bytes(), b"old")
        self.assertFalse((self.target / "a.js").exists())

    def test_incomplete_file_is_not_visible(self):
        (self.source / "new.js").write_bytes(b"new")
        with patch.object(publisher.os, "link", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                publisher.publish(self.source, self.target)
        self.assertEqual(list(self.target.iterdir()), [])

    def test_concurrent_file_is_never_overwritten(self):
        (self.source / "new.js").write_bytes(b"new")
        def concurrent_writer(temporary, target):
            target.write_bytes(b"other publisher")
            raise FileExistsError()
        with patch.object(publisher.os, "link", side_effect=concurrent_writer):
            with self.assertRaisesRegex(ValueError, "conflict"):
                publisher.publish(self.source, self.target)
        self.assertEqual((self.target / "new.js").read_bytes(), b"other publisher")
        self.assertEqual(len(list(self.target.iterdir())), 1)

    def test_empty_release_rejected(self):
        with self.assertRaisesRegex(ValueError, "No static assets"):
            publisher.publish(self.source, self.target)

    def test_symlink_rejected(self):
        (self.target / "old.js").write_bytes(b"old")
        try:
            (self.source / "link.js").symlink_to(self.target / "old.js")
        except OSError:
            self.skipTest("Symlink creation requires OS permission")
        with self.assertRaisesRegex(ValueError, "Symlink"):
            publisher.publish(self.source, self.target)


if __name__ == "__main__":
    unittest.main()
