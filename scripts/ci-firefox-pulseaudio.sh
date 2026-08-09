#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP must identify the GitHub Actions temporary directory.}"
: "${GITHUB_ENV:?GITHUB_ENV must identify the GitHub Actions environment file.}"

pulse_root="$RUNNER_TEMP/soundscaper-pulse"
pulse_runtime="$pulse_root/runtime"
pulse_state="$pulse_root/state"
mkdir -p -- "$pulse_runtime" "$pulse_state"
chmod 700 -- "$pulse_runtime" "$pulse_state"

export XDG_RUNTIME_DIR="$pulse_runtime"
export PULSE_STATE_PATH="$pulse_state"

pulseaudio \
	--daemonize=yes \
	--exit-idle-time=-1 \
	--log-target="file:$pulse_root/pulseaudio.log"

for attempt in {1..50}; do
	if pactl info >/dev/null 2>&1; then
		break
	fi
	if [[ "$attempt" -eq 50 ]]; then
		echo "PulseAudio did not become ready." >&2
		exit 1
	fi
	sleep 0.1
done

sink_name='soundscaper_ci_sink'
pactl load-module module-null-sink \
	sink_name="$sink_name" \
	rate=48000 \
	channels=2 \
	sink_properties=device.description=Soundscaper_CI_Null_Sink
pactl set-default-sink "$sink_name"
pactl set-default-source "$sink_name.monitor"
pactl set-sink-mute "$sink_name" false
pactl set-source-mute "$sink_name.monitor" false

pulse_server="unix:$pulse_runtime/pulse/native"
{
	echo "XDG_RUNTIME_DIR=$pulse_runtime"
	echo "PULSE_STATE_PATH=$pulse_state"
	echo "PULSE_SERVER=$pulse_server"
} >> "$GITHUB_ENV"

PULSE_SERVER="$pulse_server" pactl info
PULSE_SERVER="$pulse_server" pactl list short sinks
PULSE_SERVER="$pulse_server" pactl list short sources
