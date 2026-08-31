#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# electron-builder delegates runtime and tool downloads to @electron/get and
# app-builder. Those downloads can fail after a hosted runner receives a
# transient HTTP or network error. Repeat only that narrow failure class; a
# configuration, signing, hook, or packaging failure keeps its first exit code.

set -euo pipefail

if [[ "$#" -eq 0 ]]; then
	echo 'ci-electron-builder.sh needs electron-builder arguments.' >&2
	exit 64
fi

attempt_limit=3
retry_delay_seconds="${SOUNDSCAPER_ELECTRON_BUILDER_RETRY_DELAY_SECONDS:-10}"
if [[ ! "$retry_delay_seconds" =~ ^[0-9]+$ ]] || ((retry_delay_seconds > 60)); then
	echo 'SOUNDSCAPER_ELECTRON_BUILDER_RETRY_DELAY_SECONDS must be an integer from 0 through 60.' >&2
	exit 64
fi

retry_log_directory="$(mktemp -d)"
trap 'rm -rf -- "$retry_log_directory"' EXIT

is_transient_download_failure() {
	local log_path="$1"
	local download_context='download|https?://|@electron/get|app-builder'
	local transient_http='(Response code|HTTP (response )?status( code)?|statusCode)[^0-9]*(408|425|429|500|502|503|504)([^0-9]|$)'
	local transient_network='(^|[^[:alnum:]_])(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETDOWN|ENETUNREACH|ERR_STREAM_PREMATURE_CLOSE|UND_ERR_CONNECT_TIMEOUT)([^[:alnum:]_]|$)|socket hang up|disconnected before secure TLS connection'

	grep -Eiq "$download_context" "$log_path" || return 1
	grep -Eiq "$transient_http|$transient_network" "$log_path"
}

for ((attempt = 1; attempt <= attempt_limit; attempt += 1)); do
	attempt_log="$retry_log_directory/attempt-$attempt.log"
	set +e
	npx electron-builder "$@" 2>&1 | tee "$attempt_log"
	pipeline_status=("${PIPESTATUS[@]}")
	set -e
	builder_status="${pipeline_status[0]}"
	tee_status="${pipeline_status[1]}"

	if ((builder_status == 0 && tee_status == 0)); then
		exit 0
	fi
	if ((tee_status != 0)); then
		echo 'electron-builder output could not be recorded; refusing to retry an unclassified failure.' >&2
		exit "$tee_status"
	fi
	if ! is_transient_download_failure "$attempt_log"; then
		echo 'electron-builder failed with a non-transient packaging error; not retrying.' >&2
		exit "$builder_status"
	fi
	if ((attempt == attempt_limit)); then
		echo "electron-builder transient download failed after $attempt_limit attempts." >&2
		exit "$builder_status"
	fi

	echo "electron-builder hit a transient download failure (attempt $attempt of $attempt_limit); retrying in $retry_delay_seconds seconds." >&2
	sleep "$retry_delay_seconds"
done
