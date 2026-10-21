import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASH = "C:/Program Files/Git/bin/bash.exe" if os.name == "nt" else shutil.which("bash")


@unittest.skipUnless(BASH and Path(BASH).exists(), "Bash is required")
class HkStaticRetryTests(unittest.TestCase):
    def invoke(self, stage="rsync", failures=1, status=255,
               error="Timeout, server example not responding.", bandwidth="0"):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        folder = Path(temp.name)
        source = folder / "static files"
        source.mkdir()
        mock = folder / "mock.sh"
        mock.write_text('''
sleep() { echo "sleep $*" >> "$MOCK_LOG"; }
mock_call() {
  local stage="$1"
  shift
  echo "$stage $*" >> "$MOCK_LOG"
  if [[ "$stage" == "$MOCK_STAGE" ]]; then
    local count=0
    [[ ! -f "$MOCK_COUNT" ]] || count=$(cat "$MOCK_COUNT")
    count=$((count + 1))
    echo "$count" > "$MOCK_COUNT"
    if (( count <= MOCK_FAILURES )); then
      echo "$MOCK_ERROR" >&2
      return "$MOCK_STATUS"
    fi
  fi
  return 0
}
ssh() {
  case "${!#}" in
    *"python3 --version"*) mock_call prepare "$@" ;;
    *"rm -rf"*) mock_call cleanup "$@" ;;
    *) mock_call publish "$@" ;;
  esac
}
rsync() { mock_call rsync "$@"; }
scp() { mock_call scp "$@"; }
''', encoding="utf-8", newline="\n")
        log = folder / "log"
        env = dict(os.environ, BASH_ENV=mock.as_posix(), MOCK_LOG=log.as_posix(),
                   MOCK_COUNT=(folder / "count").as_posix(), MOCK_STAGE=stage,
                   MOCK_FAILURES=str(failures), MOCK_STATUS=str(status), MOCK_ERROR=error,
                   HK_SERVER_HOST="example.invalid", HK_SERVER_USER="deploy",
                   HK_SERVER_PORT="22", HK_SERVER_SSH_KEY="fake-key",
                   HK_SERVER_KNOWN_HOSTS="fake-host-key", BUILD_TAG="build-abc123-42-1",
                   HK_STATIC_BWLIMIT_KIB=bandwidth, RUNNER_TEMP=folder.as_posix())
        result = subprocess.run([BASH, "scripts/deploy-hk-static.sh", source.as_posix()],
                                cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)
        calls = log.read_text().splitlines() if log.exists() else []
        return result, calls

    def test_interrupted_upload_retries_same_stage(self):
        result, calls = self.invoke()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        uploads = [call for call in calls if call.startswith("rsync ")]
        self.assertEqual(len(uploads), 2)
        self.assertEqual(uploads[0], uploads[1])
        self.assertIn("/build-abc123-42-1/partials", uploads[0])
        self.assertNotIn("/static/partials", uploads[0])
        self.assertIn("--timeout=180", uploads[0])
        self.assertNotIn("--delete", uploads[0])
        self.assertNotIn("--inplace", uploads[0])
        self.assertEqual(sum(call.startswith("publish ") for call in calls), 1)
        self.assertEqual([call for call in calls if call.startswith("sleep ")], ["sleep 10"])

    def test_exhausted_upload_does_not_publish_or_clean_staging(self):
        result, calls = self.invoke(failures=9)
        self.assertEqual(result.returncode, 255)
        self.assertEqual(sum(call.startswith("rsync ") for call in calls), 4)
        self.assertEqual([call for call in calls if call.startswith("sleep ")],
                         ["sleep 10", "sleep 20", "sleep 40"])
        self.assertFalse(any(call.startswith(("scp ", "publish ", "cleanup ")) for call in calls))

    def test_permanent_errors_do_not_retry(self):
        for error in ("Permission denied", "Host key verification failed",
                      "No space left on device", "Immutable asset conflict"):
            with self.subTest(error=error):
                result, calls = self.invoke(failures=9, error=error)
                self.assertEqual(result.returncode, 255)
                self.assertEqual(sum(call.startswith("rsync ") for call in calls), 1)
                self.assertFalse(any(call.startswith(("sleep ", "publish ")) for call in calls))

    def test_other_stages_retry_transient_disconnects(self):
        for stage in ("prepare", "scp", "publish"):
            with self.subTest(stage=stage):
                result, calls = self.invoke(stage=stage, error="Connection reset by peer")
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(sum(call.startswith(stage + " ") for call in calls), 2)
                self.assertEqual(sum(call.startswith("rsync ") for call in calls), 1)

    def test_rsync_io_timeout_retries(self):
        result, calls = self.invoke(status=30, error="rsync: timeout in data send/receive")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(sum(call.startswith("rsync ") for call in calls), 2)

    def test_unknown_failure_does_not_retry(self):
        result, calls = self.invoke(status=23, error="unclassified transfer error")
        self.assertEqual(result.returncode, 23)
        self.assertFalse(any(call.startswith(("sleep ", "publish ")) for call in calls))

    def test_cleanup_failure_does_not_reject_published_release(self):
        result, calls = self.invoke(stage="cleanup")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("staging cleanup was not confirmed", result.stdout)
        self.assertEqual(sum(call.startswith("publish ") for call in calls), 1)

    def test_optional_bandwidth_limit(self):
        result, calls = self.invoke(failures=0, bandwidth="512")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(any("--bwlimit=512" in call for call in calls))

    def test_invalid_bandwidth_rejected_before_remote_calls(self):
        result, calls = self.invoke(bandwidth="-1")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
