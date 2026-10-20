import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASH = "C:/Program Files/Git/bin/bash.exe" if os.name == "nt" else shutil.which("bash")
DIGESTS = {
    "amd64": "sha256:43aeff40f4afc22e83f7589a2f37e111cff5ca84529571f1c8415bcc5fcc21b2",
    "arm64": "sha256:f71fb9ca71b1b47d4d1a009af78147ed6cdc74f9c7cfc36cbde78ff985169051",
}


@unittest.skipUnless(BASH and Path(BASH).exists(), "Bash is required")
class PrepareNodeBaseTests(unittest.TestCase):
    def invoke(self, arch="amd64", failures=0, invalid_digest=False):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        folder = Path(temp.name)
        mock = folder / "mock.sh"
        mock.write_text('''
sleep() { echo "sleep $*" >> "$MOCK_LOG"; }
skopeo() {
  echo "$*" >> "$MOCK_LOG"
  local n=0
  [[ ! -f "$MOCK_COUNT" ]] || n=$(cat "$MOCK_COUNT")
  n=$((n + 1)); echo "$n" > "$MOCK_COUNT"
  if (( n <= MOCK_FAILURES )); then
    echo '429 Too Many Requests: Data limit exceeded' >&2
    return 1
  fi
  while (( $# )); do
    if [[ "$1" == --digestfile ]]; then printf '%s' "$MOCK_DIGEST" > "$2"; break; fi
    shift
  done
}
''', encoding="utf-8", newline="\n")
        log, output = folder / "calls", folder / "output"
        env = dict(os.environ, BASH_ENV=mock.as_posix(), MOCK_LOG=log.as_posix(),
                   MOCK_COUNT=(folder / "count").as_posix(), MOCK_FAILURES=str(failures),
                   MOCK_DIGEST="sha256:" + "b" * 64 if invalid_digest else DIGESTS.get(arch, ""),
                   GITHUB_OUTPUT=output.as_posix())
        result = subprocess.run([BASH, "scripts/prepare-node-base.sh", arch,
                                 (folder / "base with spaces").as_posix()], cwd=ROOT,
                                env=env, capture_output=True, text=True)
        return result, log.read_text().splitlines() if log.exists() else [], output.read_text() if output.exists() else ""

    def test_success_uses_local_oci_context_for_each_platform(self):
        for arch, digest in DIGESTS.items():
            with self.subTest(arch=arch):
                result, calls, output = self.invoke(arch=arch)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(len(calls), 1)
                self.assertIn("--preserve-digests", calls[0])
                self.assertIn("docker://docker.io/library/node@" + digest, calls[0])
                self.assertTrue(output.startswith("context=oci-layout://"))
                self.assertTrue(output.strip().endswith("@" + digest))

    def test_rate_limits_switch_sources_without_changing_the_digest(self):
        result, calls, output = self.invoke(failures=2)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 3)
        for call, source in zip(calls, ("docker.io/library/node", "mirror.gcr.io/library/node", "public.ecr.aws/docker/library/node")):
            self.assertIn("docker://" + source + "@" + DIGESTS["amd64"], call)
        self.assertTrue(output)

    def test_all_sources_limited_waits_then_tries_again(self):
        result, calls, output = self.invoke(failures=3)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("sleep 60", calls)
        self.assertEqual(sum("docker://" in c for c in calls), 4)
        self.assertTrue(output)

    def test_persistent_limit_does_not_emit_a_build_context(self):
        result, calls, output = self.invoke(failures=99)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sum("docker://" in c for c in calls), 9)
        self.assertEqual([c for c in calls if c.startswith("sleep")], ["sleep 60", "sleep 120"])
        self.assertEqual(output, "")

    def test_digest_mismatch_never_reaches_the_build(self):
        result, calls, output = self.invoke(invalid_digest=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(output, "")

    def test_unknown_architecture_does_not_fetch(self):
        result, calls, output = self.invoke(arch="mips")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])
        self.assertEqual(output, "")


if __name__ == "__main__":
    unittest.main()
