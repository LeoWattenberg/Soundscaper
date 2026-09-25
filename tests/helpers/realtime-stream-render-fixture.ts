/* SPDX-License-Identifier: AGPL-3.0-only */

/** A single streamed frame used to exercise realtime render scheduling. */
export function chunkSource() {
	return {
		channelCount: 1,
		frameCount: 1,
		chunkFrames: 1,
		sampleRate: 48_000,
		readStorageChunk: async () => [Float32Array.of(0.5)],
	};
}

export function streamProject() {
	return {
		sampleRate: 48_000,
		masterChannels: 1,
		tracks: [{ id: 'track-1', type: 'audio', clipIds: ['clip-1'] }],
		clips: [{
			id: 'clip-1', sourceId: 'source-1', timelineStartFrame: 0,
			durationFrames: 1, sourceStartFrame: 0, sourceDurationFrames: 1,
		}],
		master: { gain: 1, pan: 0, mute: false, effects: [] },
	};
}
