/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAup4ExportSnapshot } from '../src/common/editor/aup4-export.js';
import { createAup4ProjectTree } from '../src/common/editor/aup4-profile.js';
import { decodeAup4ProjectTree } from '../src/common/editor/aup4-conversion.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { nativeBlockFixture } from './helpers/aup4-export-harness.js';

function production(clipChanges: Record<string, unknown> = {}, sourceRate = 48_000) {
	const source = { id: 'recording', kind: 'audio', name: 'Recording', frameCount: 16, channelCount: 1,
		sampleRate: sourceRate, sampleFormat: 'float32', storageKey: 'recording' };
	const clip = { id: 'take', kind: 'audio', sourceId: source.id, timelineStartFrame: 120,
		durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 16,
		warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' }, { outer: 4, source: 12, mode: 'forward' }, { outer: 8, source: 16, mode: 'forward' }] },
		...clipChanges };
	const project = createSoundscaperProject({ id: 'warped-production', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [{ id: 'track', type: 'audio', clipIds: [clip.id] }] });
	const channels = [Float32Array.from({ length: 16 }, (_, frame) => frame / 16)];
	return { project, channels, source };
}

function deliver(fixture: ReturnType<typeof production>) {
	const original = structuredClone(fixture.project);
	const snapshot = normalizeAup4ExportSnapshot(fixture.project, [{ sourceId: fixture.source.id,
		sampleRate: fixture.source.sampleRate, channels: fixture.channels }]);
	assert.deepEqual(fixture.project, original, 'export must not change the authored map or recording');
	return snapshot;
}

test('Audacity material bakes nonlinear source positions instead of stretching unwarped PCM', () => {
	const snapshot = deliver(production());
	assert.deepEqual(snapshot.sources[0]!.channels[0], Float32Array.of(0, 0.1875, 0.375, 0.5625, 0.75, 0.8125, 0.875, 0.9375));
	assert.equal(snapshot.project.clips[0]!.sourceDurationFrames, 8);
	assert.equal(snapshot.project.clips[0]!.sourceStartFrame, 0);
	assert.equal(snapshot.project.clips[0]!.warpMap, null);
});

test('warped material owns the visible source window and retains polarity and excess gain', () => {
	const snapshot = deliver(production({ sourceStartFrame: 2, sourceDurationFrames: 12, trimStartFrames: 2,
		trimEndFrames: 2, gain: 8, inverted: true,
		warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 2, mode: 'forward' }, { outer: 4, source: 10, mode: 'forward' }, { outer: 8, source: 14, mode: 'forward' }] },
	}));
	assert.deepEqual(snapshot.sources[0]!.channels[0], Float32Array.of(-0.25, -0.5, -0.75, -1, -1.25, -1.375, -1.5, -1.625));
	assert.equal(snapshot.project.clips[0]!.trimStartFrames, 0);
	assert.equal(snapshot.project.clips[0]!.trimEndFrames, 0);
	assert.ok(snapshot.project.clips[0]!.envelope.every((point: { value: number }) => point.value === 4));
});

test('native-rate warped material carries one neutral Audacity stretch after actual project-tree reopening', async () => {
	const fixture = production({ durationFrames: 32,
		warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' }, { outer: 16, source: 12, mode: 'forward' }, { outer: 32, source: 16, mode: 'forward' }] },
	}, 24_000);
	const snapshot = deliver(fixture);
	assert.equal(snapshot.sources[0]!.sampleRate, 24_000);
	assert.equal(snapshot.sources[0]!.channels[0]!.length, 16);
	const blocks = nativeBlockFixture(snapshot.sources);
	const tree = createAup4ProjectTree(snapshot.project, blocks.channelBlocks);
	let id = 0;
	const reopened = await decodeAup4ProjectTree(tree, async (blockId: number) => blocks.sampleBlocks.get(blockId), {
		idFactory: (prefix: string) => `${prefix}-${++id}`,
	});
	assert.equal(reopened.project.clips[0]!.durationFrames, 32);
	assert.equal(reopened.project.clips[0]!.speedRatio, 1);
	assert.equal(reopened.project.clips[0]!.timelineStartFrame, 120);
	assert.deepEqual(reopened.sources[0]!.channels, snapshot.sources[0]!.channels);
	assert.ok(Math.abs(snapshot.sources[0]!.channels[0]![8]! - 0.75) < 0.06, 'native-rate midpoint must be the authored source marker');
});

test('identity warp and an ordinary unwarped clip preserve exact PCM and original source timing', () => {
	const identity = deliver(production({ durationFrames: 16,
		warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' }, { outer: 16, source: 16, mode: 'forward' }] },
	}));
	assert.deepEqual(identity.sources[0]!.channels[0], Float32Array.from({ length: 16 }, (_, frame) => frame / 16));
	const ordinary = deliver(production({ warpMap: null }));
	assert.equal(ordinary.sources[0]!.channels[0]!.length, 16);
	assert.equal(ordinary.project.clips[0]!.durationFrames, 8);
	assert.equal(ordinary.project.clips[0]!.sourceDurationFrames, 16);
});

test('two different maps on one recording get independently timed Audacity material', () => {
	const fixture = production();
	const first = fixture.project.clips[0]!;
	fixture.project = createSoundscaperProject({ ...fixture.project, clips: [first, { ...first, id: 'second', timelineStartFrame: 240,
		warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' }, { outer: 4, source: 4, mode: 'forward' }, { outer: 8, source: 16, mode: 'forward' }] },
	}], tracks: [{ id: 'track', type: 'audio', clipIds: ['take', 'second'] }] });
	const snapshot = deliver(fixture);
	assert.notEqual(snapshot.project.clips[0]!.sourceId, snapshot.project.clips[1]!.sourceId);
	assert.equal(snapshot.sources[0]!.channels[0]![4], 0.75);
	assert.equal(snapshot.sources[1]!.channels[0]![4], 0.25);
});

test('musical warp material resolves beat positions through the project tempo before flattening', () => {
	const snapshot = deliver(production({ anchor: 'musical', musicalStartBeat: { num: 1, den: 1 },
		musicalExtent: 'beat', musicalDurationBeats: { num: 1, den: 1 },
		warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' },
			{ outer: { num: 1, den: 2 }, source: 12, mode: 'forward' }, { outer: 1, source: 16, mode: 'forward' }] },
	}));
	assert.equal(snapshot.sources[0]!.channels[0]!.length, 24_000);
	assert.equal(snapshot.sources[0]!.channels[0]![12_000], 0.75);
	assert.equal(snapshot.project.clips[0]!.durationFrames, 24_000);
});
