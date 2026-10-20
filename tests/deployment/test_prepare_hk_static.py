import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "prepare_hk_static", Path(__file__).resolve().parents[2] / "scripts/prepare-hk-static.py"
)
stager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stager)


class ReleaseStaticTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = self.root / "bundle"
        self.live = self.root / "live"

    def image(self, release, arch, content):
        namespace = f"{release}-{arch}"
        source = self.root / namespace
        manifest = source / "static/build-TfctsWXpff2fKS/_ssgManifest.js"
        manifest.parent.mkdir(parents=True)
        manifest.write_bytes(content)
        (source / "required-server-files.json").write_text(json.dumps({
            "config": {
                "deploymentId": release,
                "assetPrefix": f"/_next/static/releases/{namespace}",
            }
        }), encoding="utf-8")
        # Internal metadata must never be uploaded to the public webroot.
        (source / "server.js").write_bytes(b"private server code")
        return source, namespace

    def asset(self, namespace):
        return self.live / "releases" / namespace / "_next/static/build-TfctsWXpff2fKS/_ssgManifest.js"

    def test_new_releases_and_architectures_preserve_old_assets(self):
        legacy = self.live / "build-TfctsWXpff2fKS/_ssgManifest.js"
        legacy.parent.mkdir(parents=True)
        legacy.write_bytes(b"legacy manifest")
        legacy_time = legacy.stat().st_mtime_ns
        for release, arch, content in [
            ("build-abc-123-1", "amd64", b"first build"),
            ("build-abc-123-1", "arm64", b"different architecture"),
            ("build-def-124-1", "amd64", b"new build"),
        ]:
            source, namespace = self.image(release, arch, content)
            stager.prepare(source, self.bundle, release, namespace)
        stager.publisher.publish(self.bundle, self.live)
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.live.rglob("*") if p.is_file()}
        stager.publisher.publish(self.bundle, self.live)
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.live.rglob("*") if p.is_file()})
        self.assertEqual(legacy.read_bytes(), b"legacy manifest")
        self.assertEqual(legacy.stat().st_mtime_ns, legacy_time)
        self.assertEqual(self.asset("build-abc-123-1-amd64").read_bytes(), b"first build")
        self.assertEqual(self.asset("build-abc-123-1-arm64").read_bytes(), b"different architecture")
        self.assertEqual(self.asset("build-def-124-1-amd64").read_bytes(), b"new build")
        self.assertEqual(len(before), 4)

    def test_same_release_conflict_is_still_rejected_before_any_copy(self):
        release = "build-abc-123-1"
        source, namespace = self.image(release, "amd64", b"original")
        stager.prepare(source, self.bundle, release, namespace)
        (source / "static/build-TfctsWXpff2fKS/_ssgManifest.js").write_bytes(b"changed")
        (source / "static/a.js").write_bytes(b"must not publish")
        with self.assertRaisesRegex(ValueError, "conflict"):
            stager.prepare(source, self.bundle, release, namespace)
        self.assertFalse((self.bundle / "releases" / namespace / "_next/static/a.js").exists())

    def test_image_metadata_must_match_release_and_namespace(self):
        source, namespace = self.image("build-abc-123-1", "amd64", b"original")
        for release, expected in [("build-wrong", namespace), ("build-abc-123-1", "wrong-namespace")]:
            with self.assertRaisesRegex(ValueError, "does not match"):
                stager.prepare(source, self.bundle, release, expected)
        self.assertFalse(self.bundle.exists())

    def test_old_unversioned_image_is_rejected(self):
        source, namespace = self.image("build-abc-123-1", "amd64", b"old image")
        (source / "required-server-files.json").write_text(json.dumps({
            "config": {"deploymentId": "build-abc-123-1", "assetPrefix": ""}
        }), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "does not match"):
            stager.prepare(source, self.bundle, "build-abc-123-1", namespace)
        self.assertFalse(self.bundle.exists())

    def test_namespace_cannot_escape_static_directory(self):
        for namespace in ["../escape", "/absolute", "nested/path", "x?dpl=y", ""]:
            with self.assertRaisesRegex(ValueError, "Invalid"):
                stager.prepare(self.root, self.bundle, "build-abc-123-1", namespace)

    def test_public_images_are_allowlisted_and_versioned(self):
        for release, content in [("build-abc-123-1", b"old"), ("build-def-124-1", b"new")]:
            source, namespace = self.image(release, "amd64", b"manifest")
            for filename in ["studio/scene-03.webp", "inspiration/generated/example.webp", "inspiration/sources.json", "uploads/private.webp"]:
                image = source / "public" / filename
                image.parent.mkdir(parents=True, exist_ok=True)
                image.write_bytes(content)
            stager.prepare(source, self.bundle, release, namespace)
            target = self.bundle / "public-releases" / release
            self.assertEqual((target / "studio/scene-03.webp").read_bytes(), content)
            self.assertEqual((target / "inspiration/generated/example.webp").read_bytes(), content)
            self.assertFalse((target / "inspiration/sources.json").exists())
            self.assertFalse((target / "uploads/private.webp").exists())
        self.assertEqual((self.bundle / "public-releases/build-abc-123-1/studio/scene-03.webp").read_bytes(), b"old")

    def test_public_images_reject_symlinks_and_unsafe_release_ids(self):
        source, namespace = self.image("build-abc-123-1", "amd64", b"manifest")
        studio = source / "public/studio"
        studio.mkdir(parents=True)
        (studio / "secret.webp").symlink_to(source / "server.js")
        with self.assertRaisesRegex(ValueError, "Symlink"):
            stager.prepare(source, self.bundle, "build-abc-123-1", namespace)
        with self.assertRaisesRegex(ValueError, "Invalid deployment"):
            stager.prepare(source, self.bundle, "../escape", namespace)

    def test_same_release_public_image_changes_fail(self):
        release = "build-abc-123-1"
        for arch, content in [("amd64", b"first"), ("arm64", b"changed")]:
            source, namespace = self.image(release, arch, b"manifest")
            image = source / "public/studio/scene.webp"
            image.parent.mkdir(parents=True)
            image.write_bytes(content)
            if arch == "amd64":
                stager.prepare(source, self.bundle, release, namespace)
            else:
                with self.assertRaisesRegex(ValueError, "Immutable asset conflict"):
                    stager.prepare(source, self.bundle, release, namespace)


if __name__ == "__main__":
    unittest.main()
