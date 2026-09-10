/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ControllerTransportMeters {
	readonly tracks: Readonly<Record<string, unknown>>;
	readonly master: unknown;
}

/** Where the metronome cursor was anchored to the audio clock, and at what rate. */
export interface ControllerMetronomeAnchor {
	contextTime: number;
	frame: number;
	cursorFrame: number;
	playbackRate: number;
}

/**
 * Every field the transport owns: the published playhead and transport state,
 * the meters, play-at-speed and playback-cache preparation, the metronome, and
 * the playback display toggles. The controller state exposes them flat for the
 * services that read them there, but they are declared and typed in one place.
 */
export interface ControllerTransportState {
	positionFrame: number;
	durationFrames: number;
	transportState: string;
	meters: ControllerTransportMeters;
	playAtSpeedRate: number;
	playAtSpeedAbort: AbortController | null;
	playAtSpeedGeneration: number;
	playbackCacheAbort: AbortController | null;
	playbackCacheRefreshAbort: AbortController | null;
	playbackCacheGeneration: number;
	metronomeEnabled: boolean;
	metronomeTimer: ReturnType<typeof setTimeout> | 0;
	metronomeAnchor: ControllerMetronomeAnchor | null;
	metronomePending: Pick<OscillatorNode, 'stop'>[];
	selectionFollowsLoop: boolean;
	pinnedPlayhead: boolean;
	playbackOnRulerClick: boolean;
	updateDisplayWhilePlaying: boolean;
}

export function createControllerTransportState(): ControllerTransportState {
	return {
		positionFrame: 0,
		durationFrames: 0,
		transportState: 'stopped',
		meters: { tracks: {}, master: null },
		playAtSpeedRate: 1,
		playAtSpeedAbort: null,
		playAtSpeedGeneration: 0,
		playbackCacheAbort: null,
		playbackCacheRefreshAbort: null,
		playbackCacheGeneration: 0,
		metronomeEnabled: false,
		metronomeTimer: 0,
		metronomeAnchor: null,
		metronomePending: [],
		selectionFollowsLoop: false,
		pinnedPlayhead: false,
		playbackOnRulerClick: true,
		updateDisplayWhilePlaying: true,
	};
}
