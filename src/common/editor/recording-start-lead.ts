/* SPDX-License-Identifier: AGPL-3.0-only */

// WebKit can take longer than 80 ms to acknowledge an AudioWorklet start under
// load. Keep the recorder frame ahead until every input confirms the same one.
export const CLOCKED_RECORDING_START_LEAD_SECONDS = 0.25;

const CLOCKED_PLAYBACK_START_LEAD_SECONDS = 0.08;

export function clockedPlaybackStartLeadSeconds(withRecorderBarrier: boolean): number {
	return withRecorderBarrier ? CLOCKED_RECORDING_START_LEAD_SECONDS : CLOCKED_PLAYBACK_START_LEAD_SECONDS;
}
