/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyFramescaperImageCommandTimelineImage,
	snapshotFramescaperImageCommandTimelineImage,
} from '../src/framescaper/editor-project-timeline-image-image-command.ts';
import {
	applyFramescaperOwnedVisualCommandVisual,
	snapshotFramescaperOwnedVisualCommandVisual,
} from '../src/framescaper/editor-project-visual-visual-command.ts';

type Data = Record<string, unknown>;

function stillClip(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, kind: 'still', id: 'still-clip', sourceId: 'still-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10, ...overrides,
	};
}

function imageClip(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, kind: 'image', id: 'image-clip', sourceId: 'image-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceStartTicks: '0', ...overrides,
	};
}

function project(clip: Data, tracks: Data[]): Data {
	return { sources: [], clips: [clip], projectBin: { clips: [] }, tracks };
}

function owningTrack(clipId: string, overrides: Data = {}): Data {
	return { id: 'video-track', type: 'video', clipIds: [clipId], ...overrides };
}

function visualCommand(placement: Data | null, expectedPlacement: Data): unknown {
	return {
		type: 'video-visual-clip/set', clipId: 'still-clip', expectedClip: stillClip(),
		expectedPlacement, clip: placement === null ? null : stillClip(), placement,
	};
}

function imageCommand(placement: Data | null, expectedPlacement: Data): unknown {
	return {
		type: 'image-clip/set', clipId: 'image-clip', expectedClip: imageClip(),
		expectedPlacement, clip: placement === null ? null : imageClip(), placement,
	};
}

const OWNED = Object.freeze({ scope: 'timeline', trackId: 'video-track' });
const ORPHANED = Object.freeze({ scope: 'timeline', trackId: 'undefined' });

test('a refused visual timeline placement leaves the clip linked to the track that owns it', () => {
	const cases: readonly Readonly<{ tracks: Data[]; trackId: string; message: RegExp }>[] = [
		{ tracks: [owningTrack('still-clip')], trackId: 'missing-track', message: /requires a video track/u },
		{
			tracks: [owningTrack('still-clip'), { id: 'audio-track', type: 'audio', clipIds: [] }],
			trackId: 'audio-track', message: /requires a video track/u,
		},
		{
			tracks: [owningTrack('still-clip'), { id: 'locked-track', type: 'video', clipIds: [], locked: true }],
			trackId: 'locked-track', message: /target track is locked/u,
		},
	];

	for (const { tracks, trackId, message } of cases) {
		const target = project(stillClip(), tracks);
		const before = structuredClone(target);

		assert.throws(() => applyFramescaperOwnedVisualCommandVisual(
			target,
			snapshotFramescaperOwnedVisualCommandVisual(
				visualCommand({ scope: 'timeline', trackId }, OWNED),
			),
		), message);
		assert.deepEqual(target, before);
	}
});

test('a refused timeline-image placement leaves the clip linked to the track that owns it', () => {
	const cases: readonly Readonly<{ tracks: Data[]; trackId: string; message: RegExp }>[] = [
		{ tracks: [owningTrack('image-clip')], trackId: 'missing-track', message: /requires a video track/u },
		{
			tracks: [owningTrack('image-clip'), { id: 'audio-track', type: 'audio', clipIds: [] }],
			trackId: 'audio-track', message: /requires a video track/u,
		},
		{
			tracks: [owningTrack('image-clip'), { id: 'locked-track', type: 'video', clipIds: [], locked: true }],
			trackId: 'locked-track', message: /target track is locked/u,
		},
	];

	for (const { tracks, trackId, message } of cases) {
		const target = project(imageClip(), tracks);
		const before = structuredClone(target);

		assert.throws(() => applyFramescaperImageCommandTimelineImage(
			target,
			snapshotFramescaperImageCommandTimelineImage(
				imageCommand({ scope: 'timeline', trackId }, OWNED),
			),
		), message);
		assert.deepEqual(target, before);
	}
});

test('a visual timeline clip that no track owns is not matchable by the track identifier undefined', () => {
	const target = project(stillClip(), [{ id: 'video-track', type: 'video', clipIds: [] }]);
	const before = structuredClone(target);

	assert.throws(() => applyFramescaperOwnedVisualCommandVisual(
		target,
		snapshotFramescaperOwnedVisualCommandVisual(visualCommand(null, ORPHANED)),
	), /clip or placement is stale/u);
	assert.deepEqual(target, before);
});

test('a timeline-image clip that no track owns is not matchable by the track identifier undefined', () => {
	const target = project(imageClip(), [{ id: 'video-track', type: 'video', clipIds: [] }]);
	const before = structuredClone(target);

	assert.throws(() => applyFramescaperImageCommandTimelineImage(
		target,
		snapshotFramescaperImageCommandTimelineImage(imageCommand(null, ORPHANED)),
	), /clip or placement is stale/u);
	assert.deepEqual(target, before);
});

test('an in-place visual clip edit still moves the clip and its link to the end of their orders', () => {
	const neighbour = stillClip({ id: 'other-clip', sequenceStartFrame: 40 });
	const target: Data = {
		sources: [], clips: [stillClip(), neighbour], projectBin: { clips: [] },
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['still-clip', 'other-clip'] }],
	};

	applyFramescaperOwnedVisualCommandVisual(
		target,
		snapshotFramescaperOwnedVisualCommandVisual({
			type: 'video-visual-clip/set', clipId: 'still-clip', expectedClip: stillClip(),
			expectedPlacement: OWNED, clip: stillClip({ sequenceStartFrame: 5 }), placement: OWNED,
		}),
	);

	assert.deepEqual(target.clips, [neighbour, stillClip({ sequenceStartFrame: 5 })]);
	assert.deepEqual((target.tracks as Data[])[0]?.clipIds, ['other-clip', 'still-clip']);
});

test('an in-place timeline-image clip edit still moves the clip and its link to the end of their orders', () => {
	const neighbour = imageClip({ id: 'other-clip', sequenceStartFrame: 40 });
	const target: Data = {
		sources: [], clips: [imageClip(), neighbour], projectBin: { clips: [] },
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['image-clip', 'other-clip'] }],
	};

	applyFramescaperImageCommandTimelineImage(
		target,
		snapshotFramescaperImageCommandTimelineImage({
			type: 'image-clip/set', clipId: 'image-clip', expectedClip: imageClip(),
			expectedPlacement: OWNED, clip: imageClip({ sequenceStartFrame: 5 }), placement: OWNED,
		}),
	);

	assert.deepEqual(target.clips, [neighbour, imageClip({ sequenceStartFrame: 5 })]);
	assert.deepEqual((target.tracks as Data[])[0]?.clipIds, ['other-clip', 'image-clip']);
});
