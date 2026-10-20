import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASH = "C:/Program Files/Git/bin/bash.exe" if os.name == "nt" else shutil.which("bash")
DIGEST = "sha256:" + "a" * 64


@unittest.skipUnless(BASH and Path(BASH).exists(), "Bash is required")
class RegistryRetryTests(unittest.TestCase):
    def invoke(self, failures=0, error="429 Too Many Requests", actual=DIGEST, archive=True):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        folder = Path(temp.name)
        mock = folder / "mock.sh"
        mock.write_text('''
sleep() { echo "sleep $*" >> "$MOCK_LOG"; }
skopeo() {
  echo "copy $*" >> "$MOCK_LOG"
  local n=0
  [[ ! -f "$MOCK_COUNT" ]] || n=$(cat "$MOCK_COUNT")
  n=$((n + 1))
  echo "$n" > "$MOCK_COUNT"
  if (( n <= MOCK_FAILURES )); then
    echo "$MOCK_ERROR" >&2
    return 17
  fi
  while (( $# )); do
    if [[ "$1" == --digestfile ]]; then printf '%s' "$MOCK_DIGEST" > "$2"; break; fi
    shift
  done
}
''', encoding="utf-8", newline="\n")
        source = folder / "image with spaces.tar"
        if archive:
            source.touch()
        log = folder / "log"
        env = dict(os.environ, BASH_ENV=mock.as_posix(), MOCK_LOG=log.as_posix(),
                   MOCK_COUNT=(folder / "count").as_posix(), MOCK_FAILURES=str(failures),
                   MOCK_ERROR=error, MOCK_DIGEST=actual)
        result = subprocess.run([BASH, "scripts/push-image-archive.sh", source.as_posix(),
                                 "example/modelshot:build-test", DIGEST], cwd=ROOT,
                                env=env, capture_output=True, text=True)
        calls = log.read_text().splitlines() if log.exists() else []
        return result, calls

    def test_rate_limit_retries_same_archive_and_preserves_attestations(self):
        result, calls = self.invoke(failures=2)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        copies = [c for c in calls if c.startswith("copy ")]
        self.assertEqual(len(copies), 3)
        # Only the registry transfer repeats; no build command is involved.
        self.assertEqual(len(set(copies)), 1)
        self.assertIn("--all --preserve-digests", copies[0])
        self.assertIn("oci-archive:", copies[0])
        self.assertIn("docker://example/modelshot:build-test", copies[0])
        self.assertEqual([c for c in calls if c.startswith("sleep")], ["sleep 60", "sleep 120"])

    def test_exhausted_rate_limit_stays_failed(self):
        result, calls = self.invoke(failures=9)
        self.assertEqual(result.returncode, 17)
        self.assertEqual(sum(c.startswith("copy ") for c in calls), 5)
        self.assertEqual([c for c in calls if c.startswith("sleep")],
                         ["sleep 60", "sleep 120", "sleep 240", "sleep 480"])

    def test_permission_errors_do_not_retry(self):
        result, calls = self.invoke(failures=9, error="unauthorized: authentication required for sha256:abc429def503abc")
        self.assertEqual(result.returncode, 17)
        self.assertEqual(sum(c.startswith("copy ") for c in calls), 1)
        self.assertFalse(any(c.startswith("sleep") for c in calls))

    def test_mismatched_digest_fails(self):
        result, _ = self.invoke(actual="sha256:" + "b" * 64)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not match build output", result.stderr)

    def test_missing_archive_is_not_uploaded(self):
        result, calls = self.invoke(archive=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_transient_server_error_retries(self):
        result, calls = self.invoke(failures=1, error="503 Service Unavailable")
        self.assertEqual(result.returncode, 0)
        self.assertIn("sleep 60", calls)


if __name__ == "__main__":
    unittest.main()
