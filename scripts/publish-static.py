"""Publish immutable Next.js assets without replacing or deleting existing files."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import tempfile


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.digest()


def no_symlinks(path):
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError(f"Symlink is not allowed: {part}")


def publish(source, destination):
    source = Path(source).absolute()
    destination = Path(destination).absolute()
    no_symlinks(source)
    no_symlinks(destination)
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError("Source and destination must be separate directories")
    if not source.is_dir():
        raise ValueError("Source directory does not exist")
    files = []
    # Preflight the entire release before adding any files.
    for item in sorted(source.rglob("*")):
        no_symlinks(item)
        if item.is_dir():
            continue
        if not item.is_file():
            raise ValueError(f"Not a regular file: {item}")
        target = destination / item.relative_to(source)
        no_symlinks(target)
        checksum = digest(item)
        if target.exists() and (not target.is_file() or digest(target) != checksum):
            raise ValueError(f"Immutable asset conflict: {target}")
        files.append((item, target, checksum))
    if not files:
        raise ValueError("No static assets found")
    added = 0
    for item, target, checksum in files:
        if target.exists():
            if digest(target) != checksum:
                raise ValueError(f"Immutable asset conflict: {target}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        no_symlinks(target)
        descriptor, temporary = tempfile.mkstemp(prefix=".hk-upload-", dir=target.parent)
        try:
            with os.fdopen(descriptor, "wb") as stream, item.open("rb") as incoming:
                shutil.copyfileobj(incoming, stream)
                stream.flush()
                os.fsync(stream.fileno())
            if digest(Path(temporary)) != checksum:
                raise ValueError(f"Source changed during copy: {item}")
            os.chmod(temporary, 0o644)
            # Same-filesystem hard link publishes a complete file atomically.
            # Unlike rename/replace, it cannot overwrite a concurrent publisher.
            try:
                os.link(temporary, target)
                added += 1
            except FileExistsError:
                if not target.is_file() or digest(target) != checksum:
                    raise ValueError(f"Immutable asset conflict: {target}")
        finally:
            os.unlink(temporary)
    print(f"Static assets: {added} added, {len(files) - added} unchanged; no files replaced or deleted.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("destination")
    args = parser.parse_args()
    publish(args.source, args.destination)
