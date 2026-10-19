import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
BASH = "C:/Program Files/Git/bin/bash.exe" if os.name == "nt" else shutil.which("bash")
# Fixture copied from Docker's imagetools create --metadata-file documentation:
# https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/#metadata-file
METADATA = json.loads((ROOT / "tests/deployment/fixtures/imagetools-create-metadata.json").read_text())
DIGEST = METADATA["containerimage.descriptor"]["digest"]


@unittest.skipUnless(BASH and Path(BASH).exists(), "Bash is required")
class PublishManifestTests(unittest.TestCase):
    def run_publish(self, signed=False, failure=False, invalid_digest=False, tools=False, metadata=None):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        folder = Path(temp.name)
        mock = folder / "mock.sh"
        mock.write_text('''
docker() {
  printf 'docker %s\\n' "$*" >> "$MOCK_LOG"
  if [[ "$3" == create ]]; then
    shift 3
    [[ "$1" == --metadata-file ]] || return 9
    printf '%s' "$MOCK_METADATA" > "$2"
  fi
}
cosign() {
  printf 'cosign %s\\n' "$*" >> "$MOCK_LOG"
  if [[ "$1" == verify ]]; then
    [[ "$MOCK_SIGNED" == 1 ]]
  else
    [[ "$MOCK_FAILURE" != 1 ]]
  fi
}
python3() { command python "$@"; }
''', encoding="utf-8", newline="\n")
        prefix = "tools-" if tools else ""
        tags = [f"example/modelshot:{prefix}{tag}" for tag in ["main", "latest", "sha-abc"]]
        log = folder / "calls.log"
        metadata = METADATA if metadata is None else metadata
        if invalid_digest:
            metadata = {"containerimage.descriptor": {"digest": "invalid"}}
        env = dict(os.environ, BASH_ENV=mock.as_posix(), MOCK_LOG=log.as_posix(),
                   MOCK_METADATA=json.dumps(metadata),
                   MOCK_SIGNED=str(int(signed)), MOCK_FAILURE=str(int(failure)),
                   IMAGE="example/modelshot", TAGS="\n".join(tags),
                   GITHUB_WORKFLOW_REF="jx009/modelshot-code/.github/workflows/docker-build.yml@refs/heads/main",
                   GITHUB_STEP_SUMMARY=(folder / "summary").as_posix())
        result = subprocess.run([BASH, "scripts/publish-image-manifest.sh",
                                 f"example/modelshot:{prefix}build-abc-amd64",
                                 f"example/modelshot:{prefix}build-abc-arm64"],
                                cwd=ROOT, env=env, capture_output=True, text=True)
        return result, log.read_text(encoding="utf-8").splitlines()

    def test_three_aliases_sign_the_merged_digest_only_once(self):
        for tools in (False, True):
            with self.subTest(tools=tools):
                result, calls = self.run_publish(tools=tools)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual([c for c in calls if c.startswith("cosign sign")],
                                 [f"cosign sign --yes example/modelshot@{DIGEST}"])
                self.assertEqual(sum(c.startswith("docker buildx imagetools inspect") for c in calls), 3)
                self.assertIn("--certificate-identity=https://github.com/jx009/modelshot-code/.github/workflows/docker-build.yml@refs/heads/main", "\n".join(calls))

    def test_rerun_verifies_existing_signature_without_signing_again(self):
        result, calls = self.run_publish(signed=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(c.startswith("cosign sign") for c in calls))

    def test_real_signing_errors_still_fail_publication(self):
        result, calls = self.run_publish(failure=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(c.startswith("docker buildx imagetools inspect") for c in calls))

    def test_missing_index_digest_fails_without_signing_a_tag(self):
        result, calls = self.run_publish(invalid_digest=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(c.startswith("cosign") for c in calls))

    def test_build_metadata_or_child_digests_are_not_used_as_index_digest(self):
        for metadata in (
            {"containerimage.digest": DIGEST},
            {"manifests": [{"digest": DIGEST}]},
            {"config": {"digest": DIGEST}},
            {"containerimage.descriptor": None},
            {"containerimage.descriptor": {"digest": None}},
        ):
            with self.subTest(metadata=metadata):
                result, calls = self.run_publish(metadata=metadata)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(c.startswith("cosign") for c in calls))

    def test_index_descriptor_wins_over_unrelated_digest_fields(self):
        metadata = {**METADATA, "containerimage.digest": "sha256:" + "b" * 64,
                    "manifests": [{"digest": "sha256:" + "c" * 64}]}
        result, calls = self.run_publish(metadata=metadata)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([c for c in calls if c.startswith("cosign sign")],
                         [f"cosign sign --yes example/modelshot@{DIGEST}"])


if __name__ == "__main__":
    unittest.main()
