/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceSelectedPreparation,
} from '../src/common/editor/controller/local-assistance-selected-preparation.ts';

test('a selected video exposes its one exact linked audio peer for highlight signal preparation', async () => {
	const project = linkedProject();
	const renders: unknown[][] = [];
	const preparation = createLocalAssistanceSelectedPreparation({
		getProject: () => project,
		getSelectedClipId: () => 'video-clip',
		captureProject: () => ({ id: project.id, revision: project.revision }),
		assertProject: (token) => assert.deepEqual(token,
			{ id: project.id, revision: project.revision }),
		renderDryTrackRange: async (...args) => {
			renders.push(args);
			return [Float32Array.from({ length: 48_000 }, () => 0.25)];
		},
		videoStore: { async loadMediaAsset() { return null; } },
	});
	const inventory = await preparation.listSelectedMedia();
	assert.deepEqual(inventory.sources.map(({ sourceId, mediaKind }) => ({ sourceId, mediaKind })), [
		{ sourceId: 'audio-source', mediaKind: 'audio' },
		{ sourceId: 'video-source', mediaKind: 'video' },
	]);
	const prepared = await preparation.prepareSelectedMedia({
		sourceId: 'audio-source', operation: 'audio-tagging',
	});
	assert.equal(prepared.sourceId, 'audio-source');
	assert.equal(prepared.operation, 'audio-tagging');
	assert.deepEqual(renders, [['audio-track', 0, 48_000, null, ['audio-clip']]]);
	assert.deepEqual(prepared.selectionFence.occurrenceIds, ['audio-clip', 'video-clip']);
});

test('ambiguous or absent linked audio is not inferred from a selected video', async () => {
	for (const clips of [
		linkedProject().clips.filter(({ kind }) => kind === 'video'),
		[...linkedProject().clips, { ...linkedProject().clips[1]!, id: 'audio-clip-2' }],
	]) {
		const project = { ...linkedProject(), clips };
		const preparation = createLocalAssistanceSelectedPreparation({
			getProject: () => project, getSelectedClipId: () => 'video-clip',
			captureProject: () => null, assertProject: () => undefined,
			renderDryTrackRange: async () => { throw new Error('must not render'); },
			videoStore: { async loadMediaAsset() { return null; } },
		});
		assert.deepEqual((await preparation.listSelectedMedia()).sources.map(({ mediaKind }) => mediaKind),
			['video']);
	}
});

function linkedProject() {
	return {
		id: 'project-a', schemaVersion: 31, revision: 8, sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		selection: { startFrame: 0, endFrame: 48_000, clipIds: ['video-clip'],
			trackIds: ['video-track'] },
		sources: [{ id: 'video-source', name: 'Camera', kind: 'video',
			storageKey: 'video-source', mimeType: 'video/mp4', contentSha256: '12'.repeat(32),
			sampleFrameCount: 48_000, sourceFrameCount: 10, frameRate: { num: 10, den: 1 },
			width: 1_920, height: 1_080, timingAsset: null,
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 10, den: 1 } } },
		{ id: 'audio-source', name: 'Audio', kind: 'audio', contentSha256: '34'.repeat(32),
			sampleRate: 48_000, frameCount: 48_000 }],
		clips: [{ id: 'video-clip', title: 'Camera', kind: 'video', sourceId: 'video-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
			reversed: false, speedRatio: 1, avLinkId: 'link-a' },
		{ id: 'audio-clip', title: 'Audio', kind: 'audio', sourceId: 'audio-source',
			sequenceId: 'main-sequence', timelineStartFrame: 0, durationFrames: 48_000,
			sourceStartFrame: 0, sourceDurationFrames: 48_000, reversed: false, speedRatio: 1,
			pitchCents: 0, stretchToTempo: false, anchor: 'sample', warpMap: null,
			avLinkId: 'link-a' }],
		tracks: [{ id: 'video-track', name: 'Picture', type: 'video', clipIds: ['video-clip'] },
			{ id: 'audio-track', name: 'Audio', type: 'audio', clipIds: ['audio-clip'] }],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 },
			trackIds: ['video-track', 'audio-track'] }],
		subsequences: [], multicameraGroups: [],
	};
}
