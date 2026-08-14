/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { resolveActiveVideoLayers } from '../src/common/editor/video-timeline.js';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import {
	materializeFramescaperNestedPlaybackFoundationV18,
} from '../src/framescaper/editor-project-v18-nested-playback.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	framescaperProjectForPlaybackFoundationV18,
	framescaperProjectForRuntimeConsumersV18,
} from '../src/framescaper/editor-project-v18-runtime.ts';
import {
	createFramescaperProjectV18,
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';

type TrackedFoundation = Readonly<{ tracks: readonly Readonly<Record<string, unknown>>[] }>;

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
const NOW = '2026-08-13T12:00:00.000Z';
const SOURCE_SHA = '12'.repeat(32);

test('exact schema 18 requires one own dense subsequences collection', () => {
	const project = aliasesProject();
	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete missing.subsequences;
	assert.throws(
		() => validateFramescaperProjectV18(PROFILE, missing),
		/subsequences.*own enumerable data property/iu,
	);

	const sparse = structuredClone(project) as unknown as Record<string, unknown>;
	const values = (sparse.subsequences as unknown[]).slice();
	delete values[0];
	sparse.subsequences = values;
	assert.throws(
		() => validateFramescaperProjectV18(PROFILE, sparse),
		/subsequences.*dense|enumerable data property/iu,
	);
});

test('nested aliases materialize deterministically on the primary frame grid without mutating V18', () => {
	const project = aliasesProject();
	const persisted = structuredClone(project);
	const first = materializeFramescaperNestedPlaybackFoundationV18(PROFILE, project);
	const second = materializeFramescaperNestedPlaybackFoundationV18(PROFILE, project);

	assert.deepEqual(project, persisted);
	assert.deepEqual(second, first);
	assert.equal(first.schemaVersion, 17);
	assert.equal(Object.hasOwn(first, 'subsequences'), false);
	assert.equal(first.primarySequenceId, 'root');
	assert.equal(validateAudioEditorProjectV17(first), true);
	assert.equal(first.sequences.find(({ id }) => id === 'child')?.trackIds.length, 0);
	assert.equal(first.sequences.find(({ id }) => id === 'child')?.trackNodes.length, 0);

	const clips = [...first.clips].sort((left, right) => (
		Number(left.sequenceStartFrame) - Number(right.sequenceStartFrame)
	));
	assert.deepEqual(clips.map((clip) => ({
		sequenceId: clip.sequenceId,
		sequenceStartFrame: clip.sequenceStartFrame,
		sequenceFrameCount: clip.sequenceFrameCount,
		sourceInFrame: clip.sourceInFrame,
		sourceFrameCount: clip.sourceFrameCount,
	})), [
		{ sequenceId: 'root', sequenceStartFrame: 35, sequenceFrameCount: 15, sourceInFrame: 10, sourceFrameCount: 12 },
		{ sequenceId: 'root', sequenceStartFrame: 95, sequenceFrameCount: 15, sourceInFrame: 10, sourceFrameCount: 12 },
	]);
	assert.equal(new Set(clips.map(({ id }) => id)).size, 2);
	assert.ok(clips.every(({ id }) => String(id).startsWith('framescaper-v18-flat-clip-')));
	assert.equal(first.tracks.length, 2);
	assert.equal(new Set(first.tracks.map(({ id }) => id)).size, 2);
	assert.ok(first.tracks.every(({ id }) => String(id).startsWith('framescaper-v18-flat-track-')));
	assert.deepEqual(
		first.sequences.find(({ id }) => id === 'root')?.trackIds,
		first.tracks.map(({ id }) => id),
	);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(Object.isFrozen(first.clips), true);
	assert.ok(first.clips.every(Object.isFrozen));
});

test('playback materializes the primary sequence while runtime consumers keep authored occurrences', () => {
	const project = aliasesProject();
	const foundation = materializeFramescaperNestedPlaybackFoundationV18(PROFILE, project);
	assert.deepEqual(framescaperProjectForPlaybackFoundationV18(PROFILE, project), foundation);

	const runtime = framescaperProjectForRuntimeConsumersV18(PROFILE, project);
	assert.deepEqual(runtime.clips.map(({ id }) => id), ['child-clip']);
	assert.deepEqual(runtime.clips.map(({ timelineStartFrame, timelineEndFrame, durationFrames }) => ({
		timelineStartFrame, timelineEndFrame, durationFrames,
	})), [{ timelineStartFrame: 8_000, timelineEndFrame: 32_000, durationFrames: 24_000 }]);
});

test('nested audio trims and mixer routes materialize by exact leaf and primary rates', () => {
	const project = audioProject();
	const persisted = structuredClone(project);
	const foundation = materializeFramescaperNestedPlaybackFoundationV18(PROFILE, project);
	assert.deepEqual(project, persisted);
	assert.equal(validateAudioEditorProjectV17(foundation), true);
	assert.equal(foundation.clips.length, 1);
	assert.deepEqual({
		timelineStartFrame: foundation.clips[0]?.timelineStartFrame,
		durationFrames: foundation.clips[0]?.durationFrames,
		sourceStartFrame: foundation.clips[0]?.sourceStartFrame,
		sourceDurationFrames: foundation.clips[0]?.sourceDurationFrames,
		anchor: foundation.clips[0]?.anchor,
	}, {
		timelineStartFrame: 48_000,
		durationFrames: 16_000,
		sourceStartFrame: 4_100,
		sourceDurationFrames: 8_000,
		anchor: 'sample',
	});
	const trackId = String(foundation.tracks[0]?.id);
	const mixer = foundation.mixer as Readonly<Record<string, unknown>>;
	const routes = mixer.routes as Readonly<Record<string, unknown>>;
	assert.deepEqual(Object.keys(routes), [trackId]);
	assert.deepEqual(routes[trackId], { groupId: null, sends: {} });

	const runtime = framescaperProjectForRuntimeConsumersV18(PROFILE, project);
	assert.deepEqual({
		id: runtime.clips[0]?.id,
		timelineStartFrame: runtime.clips[0]?.timelineStartFrame,
		timelineEndFrame: runtime.clips[0]?.timelineEndFrame,
		sourceStartFrame: runtime.clips[0]?.sourceStartFrame,
		sourceEndFrame: runtime.clips[0]?.sourceEndFrame,
	}, {
		id: 'child-audio-clip',
		timelineStartFrame: 8_000,
		timelineEndFrame: 32_000,
		sourceStartFrame: 100,
		sourceEndFrame: 12_100,
	});
});

test('nested materialization keeps the authored foreground-first video track order', () => {
	const nested = materializeFramescaperNestedPlaybackFoundationV18(PROFILE, layeredProject(true));
	const flat = framescaperProjectForPlaybackFoundationV18(
		PROFILE,
		layeredProject(false),
	) as unknown as TrackedFoundation;
	assert.deepEqual(nested.tracks.map(({ name }) => name), ['V top', 'V bottom', 'V child']);
	assert.deepEqual(nested.tracks.map(({ name }) => name), flat.tracks.map(({ name }) => name));
	assert.deepEqual(
		nested.sequences.find(({ id }) => id === 'root')?.trackIds,
		nested.tracks.map(({ id }) => String(id)),
	);

	const foreground = (foundation: TrackedFoundation): unknown => {
		const layers = resolveActiveVideoLayers(foundation, 15 * 48_000 / 24) as readonly { trackId: string }[];
		const trackId = layers[layers.length - 1]?.trackId;
		return foundation.tracks.find(({ id }) => id === trackId)?.name;
	};
	assert.equal(foreground(nested), 'V top');
	assert.equal(foreground(flat), 'V top');
});

test('materialization refuses video boundaries that do not align exactly to the primary frame grid', () => {
	const project = aliasesProject();
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const clip = (draft.clips as Record<string, unknown>[])[0]!;
	clip.sequenceStartFrame = 1;
	clip.sequenceFrameCount = 1;
	clip.sourceInFrame = 10;
	clip.sourceFrameCount = 1;
	assert.equal(validateFramescaperProjectV18(PROFILE, draft), true);
	assert.throws(
		() => materializeFramescaperNestedPlaybackFoundationV18(PROFILE, draft),
		/primary.*frame grid|frame grid.*align/iu,
	);
});

test('materialization refuses trims that cannot map exactly to integer source frames', () => {
	const project = fractionalSourceProject();
	assert.throws(
		() => materializeFramescaperNestedPlaybackFoundationV18(PROFILE, project),
		/source.*frame grid|source.*align/iu,
	);
});

test('materialization refuses nested audio boundaries between project samples', () => {
	assert.throws(
		() => materializeFramescaperNestedPlaybackFoundationV18(PROFILE, inexactAudioGridProject()),
		/audio.*sample grid|sample grid.*align/iu,
	);
});

function aliasesProject(): FramescaperProjectV18 {
	return createFramescaperProjectV18(PROFILE, {
		id: 'nested-playback-aliases', title: 'Nested playback aliases', now: NOW,
		sources: [videoSource('nested-source', 100, { num: 24, den: 1 })],
		clips: [{
			kind: 'video', id: 'child-clip', sourceId: 'nested-source', title: 'Child clip',
			sequenceId: 'child', sequenceStartFrame: 4, sequenceFrameCount: 12,
			sourceInFrame: 10, sourceFrameCount: 12, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'child-track', name: 'Child track', clipIds: ['child-clip'], locked: false,
		})],
		sequences: [
			{ id: 'root', rate: { num: 30, den: 1 }, trackIds: [] },
			{ id: 'child', rate: { num: 24, den: 1 }, trackIds: ['child-track'] },
		],
		primarySequenceId: 'root',
		subsequences: [
			{
				id: 'child-b', sequenceId: 'root', sourceSequenceId: 'child',
				sequenceStartFrame: 90, sequenceFrameCount: 30,
				sourceInFrame: 0, sourceFrameCount: 24,
			},
			{
				id: 'child-a', sequenceId: 'root', sourceSequenceId: 'child',
				sequenceStartFrame: 30, sequenceFrameCount: 30,
				sourceInFrame: 0, sourceFrameCount: 24,
			},
		],
	});
}

function layeredProject(nested: boolean): FramescaperProjectV18 {
	return createFramescaperProjectV18(PROFILE, {
		id: 'nested-playback-layers', title: 'Nested playback layers', now: NOW,
		sources: [videoSource('layer-source', 400, { num: 24, den: 1 })],
		clips: [
			{
				kind: 'video', id: 'top-clip', sourceId: 'layer-source', title: 'Top clip',
				sequenceId: 'root', sequenceStartFrame: 10, sequenceFrameCount: 10,
				sourceInFrame: 10, sourceFrameCount: 10, retimeMap: null,
			},
			{
				kind: 'video', id: 'bottom-clip', sourceId: 'layer-source', title: 'Bottom clip',
				sequenceId: 'root', sequenceStartFrame: 0, sequenceFrameCount: 20,
				sourceInFrame: 0, sourceFrameCount: 20, retimeMap: null,
			},
			{
				kind: 'video', id: 'child-clip', sourceId: 'layer-source', title: 'Child clip',
				sequenceId: 'child', sequenceStartFrame: 0, sequenceFrameCount: 30,
				sourceInFrame: 100, sourceFrameCount: 30, retimeMap: null,
			},
		],
		tracks: [
			createVideoTrackV10({ id: 'v-top', name: 'V top', clipIds: ['top-clip'], locked: false }),
			createVideoTrackV10({ id: 'v-bottom', name: 'V bottom', clipIds: ['bottom-clip'], locked: false }),
			createVideoTrackV10({ id: 'v-child', name: 'V child', clipIds: ['child-clip'], locked: false }),
		],
		sequences: [
			{ id: 'root', rate: { num: 24, den: 1 }, trackIds: ['v-top', 'v-bottom'] },
			{ id: 'child', rate: { num: 24, den: 1 }, trackIds: ['v-child'] },
		],
		primarySequenceId: 'root',
		subsequences: nested
			? [{
				id: 'layer-placement', sequenceId: 'root', sourceSequenceId: 'child',
				sequenceStartFrame: 200, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30,
			}]
			: [],
	});
}

function fractionalSourceProject(): FramescaperProjectV18 {
	return createFramescaperProjectV18(PROFILE, {
		id: 'nested-playback-fractional-source', title: 'Fractional source', now: NOW,
		sources: [videoSource('fractional-source', 10, { num: 24, den: 1 })],
		clips: [{
			kind: 'video', id: 'fractional-clip', sourceId: 'fractional-source', title: 'Fractional clip',
			sequenceId: 'child', sequenceStartFrame: 0, sequenceFrameCount: 3,
			sourceInFrame: 0, sourceFrameCount: 2, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'fractional-track', name: 'Fractional track', clipIds: ['fractional-clip'], locked: false,
		})],
		sequences: [
			{ id: 'root', rate: { num: 24, den: 1 }, trackIds: [] },
			{ id: 'child', rate: { num: 24, den: 1 }, trackIds: ['fractional-track'] },
		],
		primarySequenceId: 'root',
		subsequences: [{
			id: 'fractional-placement', sequenceId: 'root', sourceSequenceId: 'child',
			sequenceStartFrame: 10, sequenceFrameCount: 1,
			sourceInFrame: 1, sourceFrameCount: 1,
		}],
	});
}

function audioProject(): FramescaperProjectV18 {
	const project = createFramescaperProjectV18(PROFILE, {
		id: 'nested-playback-audio', title: 'Nested playback audio', now: NOW,
		sources: [audioSource('nested-audio-source', 40_000)],
		clips: [createAudioClipV10({
			id: 'child-audio-clip', sourceId: 'nested-audio-source', title: 'Child audio',
			timelineStartFrame: 8_000, durationFrames: 24_000,
			sourceStartFrame: 100, sourceDurationFrames: 12_000,
			anchor: 'sample', avLinkId: null,
		})],
		tracks: [createAudioTrackV10({
			id: 'child-audio-track', name: 'Child audio', clipIds: ['child-audio-clip'], locked: false,
		})],
		sequences: [
			{ id: 'root', rate: { num: 30, den: 1 }, trackIds: [] },
			{ id: 'child', rate: { num: 24, den: 1 }, trackIds: ['child-audio-track'] },
		],
		primarySequenceId: 'root',
		subsequences: [{
			id: 'audio-placement', sequenceId: 'root', sourceSequenceId: 'child',
			sequenceStartFrame: 30, sequenceFrameCount: 10,
			sourceInFrame: 8, sourceFrameCount: 8,
		}],
	});
	const mixer = project.mixer as Record<string, unknown>;
	mixer.routes = { 'child-audio-track': { groupId: null, sends: {} } };
	validateFramescaperProjectV18(PROFILE, project);
	return project;
}

function inexactAudioGridProject(): FramescaperProjectV18 {
	return createFramescaperProjectV18(PROFILE, {
		id: 'nested-playback-inexact-audio', title: 'Inexact audio grid', now: NOW,
		sources: [audioSource('inexact-audio-source', 4_000)],
		clips: [createAudioClipV10({
			id: 'inexact-audio-clip', sourceId: 'inexact-audio-source', title: 'Inexact audio',
			timelineStartFrame: 0, durationFrames: 2_000,
			sourceStartFrame: 0, sourceDurationFrames: 2_000,
			anchor: 'sample', avLinkId: null,
		})],
		tracks: [createAudioTrackV10({
			id: 'inexact-audio-track', name: 'Inexact audio', clipIds: ['inexact-audio-clip'], locked: false,
		})],
		sequences: [
			{ id: 'root', rate: { num: 30_000, den: 1_001 }, trackIds: [] },
			{ id: 'child', rate: { num: 30_000, den: 1_001 }, trackIds: ['inexact-audio-track'] },
		],
		primarySequenceId: 'root',
		subsequences: [{
			id: 'inexact-audio-placement', sequenceId: 'root', sourceSequenceId: 'child',
			sequenceStartFrame: 1, sequenceFrameCount: 1,
			sourceInFrame: 0, sourceFrameCount: 1,
		}],
	});
}

function audioSource(id: string, frameCount: number): Record<string, unknown> {
	return createAudioSourceV10({
		id, name: id, storageKey: id, mimeType: 'audio/wav', frameCount,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 4_096,
	});
}

function videoSource(
	id: string,
	frameCount: number,
	rate: Readonly<{ num: number; den: number }>,
): Record<string, unknown> {
	return createVideoSourceV10({
		id, name: id, storageKey: id, mimeType: 'video/mp4', contentSha256: SOURCE_SHA,
		sampleFrameCount: Math.ceil(frameCount * 48_000 * rate.den / rate.num),
		sourceFrameCount: frameCount, frameRate: rate, width: 1920, height: 1080,
	});
}
