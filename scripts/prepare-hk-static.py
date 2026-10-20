"""Stage only static assets, under the exact URL prefix recorded in an image."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import shutil
import tempfile

spec = importlib.util.spec_from_file_location(
    "publish_static", Path(__file__).with_name("publish-static.py")
)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def prepare(next_dir, destination, deployment_id, namespace):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,160}", deployment_id):
        raise ValueError("Invalid deployment ID")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,160}", namespace):
        raise ValueError("Invalid static asset namespace")
    next_dir = Path(next_dir)
    manifest = json.loads((next_dir / "required-server-files.json").read_text(encoding="utf-8"))
    config = manifest["config"]
    prefix = f"/_next/static/releases/{namespace}"
    if config.get("deploymentId") != deployment_id or config.get("assetPrefix") != prefix:
        raise ValueError("Image deployment ID / asset prefix does not match this release")
    # destination corresponds to the HK webroot's /_next/static/. assetPrefix
    # itself is followed by /_next/static/ in Next's generated URLs.
    target = Path(destination) / "releases" / namespace / "_next" / "static"
    publisher.publish(next_dir / "static", target)
    with tempfile.TemporaryDirectory() as temporary:
        images = Path(temporary)
        for directory in ("studio", "inspiration"):
            source = next_dir / "public" / directory
            publisher.no_symlinks(source)
            if not source.is_dir():
                continue
            for item in sorted(source.rglob("*")):
                publisher.no_symlinks(item)
                if not item.is_file() or item.suffix.lower() not in (".webp", ".png", ".jpg", ".jpeg", ".avif"):
                    continue
                relative = item.relative_to(next_dir / "public")
                if any(not re.fullmatch(r"[a-zA-Z0-9_-][a-zA-Z0-9_.-]*", part) for part in relative.parts):
                    raise ValueError(f"Invalid public image path: {relative}")
                staged = images / relative
                staged.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(item, staged)
        if any(images.iterdir()):
            publisher.publish(images, Path(destination) / "public-releases" / deployment_id)
    print(f"Prepared static assets for {prefix}/_next/static/")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("next_dir")
    parser.add_argument("destination")
    parser.add_argument("--deployment-id", required=True)
    parser.add_argument("--namespace", required=True)
    args = parser.parse_args()
    prepare(args.next_dir, args.destination, args.deployment_id, args.namespace)
