/* SPDX-License-Identifier: AGPL-3.0-only */

export function directCompressedStemProjectFixture(masterChannels = 2, durationFrames = 1) {
	return {
		schemaVersion: 9, id: 'compressed-stem-service', title: 'Session', revision: 1,
		createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
		sampleRate: 48_000, masterChannels, metadata: {},
		selection: { startFrame: 0, endFrame: durationFrames },
		loop: { enabled: false, startFrame: 0, endFrame: durationFrames },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: durationFrames, channelCount: masterChannels, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames,
		}],
		tracks: [
			{ id: 'voice', type: 'audio', name: 'Voice', clipIds: ['clip'], effectsActive: true, effects: [] },
			{ id: 'music', type: 'audio', name: 'Music', clipIds: [], effectsActive: true, effects: [] },
		],
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}
