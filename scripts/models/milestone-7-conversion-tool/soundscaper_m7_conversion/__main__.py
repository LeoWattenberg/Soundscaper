# SPDX-License-Identifier: AGPL-3.0-only

"""Command-line entry point for the closed offline conversion protocol."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

from .contract import (
    ContractError, extracted_source, relative_path, validate_policy_environment,
    validate_source_manifest, workspace, write_json_exclusive,
)
from .exporters import convert_models
from .parity import create_parity_evidence
from .specs import CANDIDATES, PROTOCOL, candidate


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(
        prog="soundscaper_m7_conversion",
        description="Offline conversion and retained parity evidence for four pinned candidates.",
    )
    actions = command.add_subparsers(dest="action", required=True)
    convert = actions.add_parser("convert", help="convert one authenticated source closure")
    identity_arguments(convert)
    convert.add_argument("--source-manifest", required=True)
    convert.add_argument("--output-manifest", required=True)
    parity = actions.add_parser("parity", help="validate retained source-framework comparisons")
    identity_arguments(parity)
    parity.add_argument("--fixture", required=True)
    parity.add_argument("--source-runs", required=True)
    parity.add_argument("--converted-manifest", required=True)
    parity.add_argument("--evidence", required=True)
    return command


def identity_arguments(command: argparse.ArgumentParser) -> None:
    command.add_argument("--protocol", required=True, choices=[PROTOCOL])
    command.add_argument("--candidate", required=True, choices=list(CANDIDATES))
    command.add_argument("--plan-sha256", required=True)


def execute(arguments) -> dict:
    validate_policy_environment()
    root = workspace()
    spec = candidate(arguments.candidate, arguments.plan_sha256)
    if arguments.protocol != PROTOCOL:
        raise ContractError("The conversion protocol is unsupported.")
    if arguments.action == "parity":
        create_parity_evidence(root, arguments, spec)
        return {"schemaVersion": 1, "candidateId": arguments.candidate,
                "status": "verified", "evidence": arguments.evidence}
    output_manifest = relative_path(root, arguments.output_manifest,
                                    "converted manifest", must_exist=False)
    if output_manifest.exists() or output_manifest.is_symlink():
        raise ContractError("The converted manifest already exists and is never overwritten.")
    admitted = validate_source_manifest(root, arguments.source_manifest,
                                        arguments.candidate, arguments.plan_sha256, spec)
    created = []
    try:
        with extracted_source(root, admitted["archive"]["path"]) as source_root:
            with tempfile.TemporaryDirectory(prefix="m7-converted-", dir=root) as temporary:
                staging = Path(temporary)
                artifacts = convert_models(arguments.candidate, source_root,
                                           admitted["artifacts"], staging, spec)
                for row in artifacts:
                    source = staging / row["fileName"]
                    destination = output_manifest.parent / row["fileName"]
                    if destination.exists() or destination.is_symlink():
                        raise ContractError(
                            f"The converted artifact {row['fileName']} already exists.")
                    try:
                        os.link(source, destination)
                    except FileExistsError as error:
                        raise ContractError(
                            f"The converted artifact {row['fileName']} was not overwritten.") from error
                    os.chmod(destination, 0o600)
                    created.append(destination)
        manifest = {"schemaVersion": 1, "candidateId": arguments.candidate,
                    "planSha256": arguments.plan_sha256, "artifacts": artifacts}
        write_json_exclusive(root, arguments.output_manifest, manifest, "converted manifest")
        return {"schemaVersion": 1, "candidateId": arguments.candidate,
                "status": "converted", "manifest": arguments.output_manifest,
                "artifacts": artifacts}
    except Exception:
        for path in created:
            path.unlink(missing_ok=True)
        raise


def main() -> int:
    try:
        result = execute(parser().parse_args())
        sys.stdout.write(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")
        return 0
    except (ContractError, ValueError, OSError, RuntimeError) as error:
        sys.stderr.write(f"soundscaper_m7_conversion: {error}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
