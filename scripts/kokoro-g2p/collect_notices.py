# SPDX-License-Identifier: AGPL-3.0-only

"""Retain installed Python distribution notices beside the frozen helper."""

from hashlib import sha256
from importlib.metadata import distributions
from pathlib import Path
import json
import re
import sys


def notice_path(value: str) -> bool:
    parts = Path(value).parts
    return bool(parts and any(part.endswith(".dist-info") for part in parts)
                and (any(part.lower() == "licenses" for part in parts)
                     or re.match(r"^(license|licence|copying|notice)(\.|$)",
                                 parts[-1], re.IGNORECASE)))


def notice_destination(bundle: Path, safe_name: str, relative: str) -> Path:
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or not notice_path(relative):
        raise ValueError(f"Invalid Python distribution notice path: {relative}")
    return bundle / "licenses" / "python" / safe_name / path


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: collect_notices.py <frozen-bundle-root>")
    bundle = Path(sys.argv[1]).resolve()
    environment = Path(sys.prefix).resolve()
    if not bundle.is_dir():
        raise RuntimeError("Frozen G2P bundle does not exist.")
    rows = []
    for distribution in distributions():
        name = distribution.metadata["Name"]
        version = distribution.version
        safe_name = re.sub(r"[^a-z0-9.-]", "-", name.lower())
        if not safe_name or name is None or not version:
            raise RuntimeError("An installed Python distribution has invalid identity.")
        notices = []
        for relative in sorted(distribution.files or [], key=lambda value: str(value)):
            if not notice_path(str(relative)):
                continue
            source = Path(distribution.locate_file(relative)).resolve()
            if not source.is_relative_to(environment) or not source.is_file():
                raise RuntimeError(f"Python notice escapes the locked environment: {name}")
            data = source.read_bytes()
            target = notice_destination(bundle, safe_name, str(relative))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            notices.append({
                "path": target.relative_to(bundle).as_posix(),
                "byteLength": len(data),
                "sha256": sha256(data).hexdigest(),
            })
        metadata = distribution.read_text("METADATA") or ""
        rows.append({
            "name": name,
            "version": version,
            "licenseExpression": distribution.metadata.get("License-Expression"),
            "licenseMetadata": distribution.metadata.get("License"),
            "metadataSha256": sha256(metadata.encode("utf-8")).hexdigest(),
            "notices": notices,
        })
    rows.sort(key=lambda row: row["name"].lower())
    inventory = {"schemaVersion": 1, "packages": rows}
    (bundle / "python-license-inventory.json").write_text(
        json.dumps(inventory, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Retained {sum(len(row['notices']) for row in rows)} Python notices "
          f"for {len(rows)} locked distributions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
