#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Kitware's binary supplies CMake >=3.25 without raising the Ubuntu 22.04 ABI.
# Published checksum: https://cmake.org/files/v3.31/cmake-3.31.10-SHA-256.txt

set -euo pipefail

if [[ "$(uname -s)" != 'Linux' || "$(uname -m)" != 'x86_64' ]]; then
	echo 'The pinned professional CMake bootstrap requires Linux x64.' >&2
	exit 64
fi
: "${RUNNER_TEMP:?RUNNER_TEMP is required}" "${GITHUB_PATH:?GITHUB_PATH is required}"

cmake_version='3.31.10'
archive_bytes='55010952'
archive_sha256='3cb3dd247b6a1de2d0f4b20c6fd4326c9024e894cebc9dc8699758887e566ca7'
workspace="$(mktemp -d "$RUNNER_TEMP/soundscaper-professional-cmake.XXXXXX")"
trap 'rm -rf -- "$workspace"' EXIT
archive="$workspace/cmake.tar.gz"
curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 \
	--connect-timeout 20 --max-time 180 --retry 3 \
	--output "$archive" \
	"https://cmake.org/files/v3.31/cmake-${cmake_version}-linux-x86_64.tar.gz"
if [[ "$(stat --format='%s' "$archive")" != "$archive_bytes" ]]; then
	echo 'The professional CMake archive has an unexpected byte length.' >&2
	exit 1
fi
printf '%s  %s\n' "$archive_sha256" "$archive" | sha256sum --check --strict -
tar --extract --gzip --file "$archive" --directory "$workspace"
cmake_bin="$workspace/cmake-${cmake_version}-linux-x86_64/bin"
version_output="$("$cmake_bin/cmake" --version)"
if [[ "${version_output%%$'\n'*}" != "cmake version $cmake_version" ]]; then
	echo 'The authenticated professional CMake executable has an unexpected version.' >&2
	exit 1
fi
rm -- "$archive"
printf '%s\n' "$cmake_bin" >> "$GITHUB_PATH"
trap - EXIT
printf '%s\n' "$version_output"
