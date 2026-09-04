import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeAup4ProjectTree } from '../src/common/editor/aup4-conversion.js';
import {
	createAup4ExportPlan,
	normalizeAup4ExportSnapshot,
	normalizeAup4ExportSource,
} from '../src/common/editor/aup4-export.js';
import {
	createAup4ProjectTree,
} from '../src/common/editor/aup4-profile.js';
import {
	createEffect,
} from '../src/common/editor/effects.js';
import {
	clip,
	fixtureProject,
	nativeBlockFixture,
	source,
	track,
} from './helpers/aup4-export-harness.js';

test('AUP4 export plan renders reverse and excessive gain into an isolated PCM variant', () => {
	const project = fixtureProject({
		sources: [source('render-source', 48_000, 1, 4)],
		clips: [clip('render-clip', 'render-source', {
			sourceDurationFrames: 4,
			durationFrames: 4,
			gain: 8,
			fadeInFrames: 2,
			fadeOutFrames: 2,
			reversed: true,
		})],
		tracks: [{
			...track('render-track', ['render-clip']),
			envelope: [{ frame: 0, value: 0.5 }, { frame: 4, value: 1 }],
		}],
	});
	const original = structuredClone(project);
	const plan = createAup4ExportPlan(project);
	const normalized = normalizeAup4ExportSource(plan, {
		sourceId: 'render-source',
		sampleRate: 48_000,
		channels: [Float32Array.of(1, 2, 3, 4)],
	})[0];
	const exportedClip = plan.project.clips[0];

	assert.deepEqual(normalized.channels[0], Float32Array.of(6, 4.5, 3, 1.5));
	assert.equal(exportedClip.reversed, false);
	assert.equal(exportedClip.gain, 1);
	assert.equal(exportedClip.fadeInFrames, 0);
	assert.equal(exportedClip.fadeOutFrames, 0);
	assert.deepEqual(exportedClip.envelope, [
		{ frame: 0, value: 0 },
		{ frame: 1, value: 5 / 3 },
		{ frame: 2, value: 4 },
		{ frame: 3, value: 7 / 3 },
		{ frame: 4, value: 0 },
	]);
	assert.deepEqual(project, original);
	assert.equal(plan.compatibilityReport.schemaVersion, 1);
	assert.equal(plan.compatibilityReport.format, 'aup4');
	assert.equal(plan.compatibilityReport.direction, 'save');
	assert.ok(plan.compatibilityReport.items.some((item) => item.code === 'REVERSED_CLIP_RENDERED'));
	assert.ok(plan.compatibilityReport.items.some((item) => (
		item.code === 'CLIP_GAIN_AUTOMATION_MERGED' && item.data.pcmGain === 1.5
	)));
	assert.equal(plan.compatibilityReport.counts.converted, 3);
});

test('AUP4 export isolates trim-accessible PCM and reverses hidden handles with the clip', async () => {
	const project = fixtureProject({
		sources: [source('trim-source', 48_000, 1, 10)],
		clips: [clip('trim-clip', 'trim-source', {
			sourceStartFrame: 3,
			sourceDurationFrames: 4,
			durationFrames: 4,
			trimStartFrames: 2,
			trimEndFrames: 1,
			reversed: true,
		})],
		tracks: [track('trim-track', ['trim-clip'])],
	});
	const snapshot = normalizeAup4ExportSnapshot(project, [{
		sourceId: 'trim-source',
		sampleRate: 48_000,
		channels: [Float32Array.from({ length: 10 }, (_, frame) => frame)],
	}]);
	const exportedClip = snapshot.project.clips[0];
	assert.deepEqual(snapshot.sources[0].channels[0], Float32Array.of(7, 6, 5, 4, 3, 2, 1));
	assert.deepEqual({
		sourceStartFrame: exportedClip.sourceStartFrame,
		sourceDurationFrames: exportedClip.sourceDurationFrames,
		trimStartFrames: exportedClip.trimStartFrames,
		trimEndFrames: exportedClip.trimEndFrames,
	}, {
		sourceStartFrame: 1,
		sourceDurationFrames: 4,
		trimStartFrames: 1,
		trimEndFrames: 2,
	});
	assert.ok(snapshot.compatibilityReport.items.some((item) => item.code === 'CLIP_SOURCE_RANGE_ISOLATED'));

	const blocks = nativeBlockFixture(snapshot.sources);
	const tree = createAup4ProjectTree(snapshot.project, blocks.channelBlocks);
	let nextId = 0;
	const reopened = await decodeAup4ProjectTree(tree, async (blockId) => blocks.sampleBlocks.get(blockId), {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});
	assert.deepEqual({
		sourceStartFrame: reopened.project.clips[0].sourceStartFrame,
		sourceDurationFrames: reopened.project.clips[0].sourceDurationFrames,
		trimStartFrames: reopened.project.clips[0].trimStartFrames,
		trimEndFrames: reopened.project.clips[0].trimEndFrames,
	}, {
		sourceStartFrame: 1,
		sourceDurationFrames: 4,
		trimStartFrames: 1,
		trimEndFrames: 2,
	});
});

test('AUP4 export splits overlapping clips into lanes and materializes automatic crossfades', () => {
	const project = fixtureProject({
		sources: [source('overlap-source', 48_000, 1, 8)],
		clips: [
			clip('overlap-a', 'overlap-source', { sourceDurationFrames: 6, durationFrames: 6 }),
			clip('overlap-b', 'overlap-source', {
				timelineStartFrame: 3,
				sourceDurationFrames: 5,
				durationFrames: 5,
			}),
		],
		tracks: [{
			...track('overlap-track', ['overlap-a', 'overlap-b']),
			effects: [createEffect('audacity-invert', { id: 'overlap-invert' })],
		}],
	});
	const plan = createAup4ExportPlan(project);
	assert.equal(plan.project.tracks.length, 2);
	assert.deepEqual(plan.project.tracks.map((item) => item.clipIds), [['overlap-a'], ['overlap-b']]);
	assert.deepEqual(plan.project.clips[0].envelope, [
		{ frame: 0, value: 1 },
		{ frame: 3, value: 1 },
		{ frame: 6, value: 0 },
	]);
	assert.deepEqual(plan.project.clips[1].envelope, [
		{ frame: 0, value: 0 },
		{ frame: 3, value: 1 },
		{ frame: 5, value: 1 },
	]);
	const codes = new Set(plan.compatibilityReport.items.map((item) => item.code));
	assert.ok(codes.has('OVERLAPPING_CLIPS_SPLIT_TO_LANES'));
	assert.ok(codes.has('TRACK_EFFECT_RACK_DUPLICATED_FOR_OVERLAP'));
	assert.ok(plan.compatibilityReport.items.filter((item) => (
		item.code === 'CLIP_GAIN_AUTOMATION_MERGED' && item.data.automaticCrossfade
	)).length >= 2);
});
