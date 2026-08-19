#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Install Debian packages on a GitHub Actions runner without letting a stalled
# Ubuntu mirror consume the job's whole time budget.
#
# GitHub's runners resolve the archive through /etc/apt/apt-mirrors.txt, which
# names the Azure mirror first and archive.ubuntu.com as the fallback. When the
# Azure mirror stops answering, apt falls back to archive.ubuntu.com, and that
# transfer has been observed to trickle rather than fail: apt's own inactivity
# timeout never fires, apt-get never returns, and the job is killed at its
# timeout-minutes limit having installed nothing at all. Two guards close that
# off here. Packages the runner image already carries are never fetched, so the
# common case does no network work; and every apt-get that does run is bounded
# by a wall clock and retried against a fresh mirror connection.

set -euo pipefail

if [[ "$#" -eq 0 ]]; then
	echo 'ci-apt-install.sh needs at least one package name.' >&2
	exit 64
fi

missing=()
for package in "$@"; do
	status="$(dpkg-query --show --showformat='${db:Status-Status}' "$package" 2>/dev/null || true)"
	if [[ "$status" != 'installed' ]]; then
		missing+=("$package")
	fi
done

if [[ "${#missing[@]}" -eq 0 ]]; then
	echo "Already present on the runner image, skipping apt: $*"
	exit 0
fi

echo "Installing from the Ubuntu archive: ${missing[*]}"

timeout_seconds="${CI_APT_TIMEOUT_SECONDS:-300}"
attempt_limit="${CI_APT_ATTEMPTS:-3}"
retry_delay_seconds="${CI_APT_RETRY_DELAY_SECONDS:-10}"

# Bound apt's own waits too, so a mirror that answers slowly is abandoned inside
# an attempt rather than at the wall clock on every single one of them.
apt_options=(
	-o 'Acquire::Retries=2'
	-o 'Acquire::http::Timeout=30'
	-o 'Acquire::https::Timeout=30'
	-o 'DPkg::Lock::Timeout=60'
)

run_apt() {
	local description="$1"
	shift
	local attempt
	for ((attempt = 1; attempt <= attempt_limit; attempt++)); do
		# SIGTERM first so apt can unwind its dpkg transaction; SIGKILL only for a
		# process that ignored it, which apt-get update does not do.
		if sudo timeout --kill-after=30s "$timeout_seconds" apt-get "${apt_options[@]}" "$@"; then
			return 0
		fi
		echo "$description did not complete (attempt $attempt of $attempt_limit)." >&2
		if ((attempt < attempt_limit)); then
			sleep "$retry_delay_seconds"
		fi
	done
	echo "$description failed $attempt_limit times; the Ubuntu mirror is unreachable." >&2
	return 1
}

run_apt 'apt-get update' update
run_apt 'apt-get install' install --yes "${missing[@]}"
