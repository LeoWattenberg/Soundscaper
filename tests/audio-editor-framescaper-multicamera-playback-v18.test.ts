/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	registerVideoTimingIndex,
	unregisterVideoTimingIndex,
} from '../src/common/editor/video-source-time.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';
import {
	createFramescaperPlaybackProjectServiceV18,
} from '../src/framescaper/editor-project-playback-v18.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	materializeFramescaperMulticameraPlaybackProjectV18,
} from '../src/framescaper/editor-project-v18-multicam-playback.ts';
import {
	createFramescaperProjectV18,
	type FramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
const NOW = '2026-08-13T13:00:00.000Z';
const SOURCE_A_SHA = '12'.repeat(32);
const SOURCE_B_SHA = '34'.repeat(32);

test('multicamera playback selects the active canonical source without moving persisted timeline state', () => {
	const project = cfrProject();
	const materialized = materializeFramescaperMulticameraPlaybackProjectV18(PROFILE, project);
	const output = materialized.clips.find((clip) => clip.id === 'output-clip');
	assert.deepEqual(output, {
		...project.clips[0],
		sourceId: 'source-b',
		sourceInFrame: 3,
		sourceFrameCount: 3,
	});
	assert.equal(output?.sequenceStartFrame, 10);
	assert.equal(output?.sequenceFrameCount, 3);
	assert.deepEqual(materialized.multicameraGroups, []);
	assert.equal(Object.isFrozen(materialized), true);
	assert.equal(Object.isFrozen(materialized.clips), true);
	assert.equal(Object.isFrozen(output), true);
	assert.notStrictEqual(materialized, project);
	assert.notStrictEqual(materialized.clips, project.clips);
	assert.equal(project.clips[0]?.sourceId, 'source-a');
	assert.equal(project.clips[0]?.sourceInFrame, 2);
	for (const source of materialized.sources) {
		assert.equal(source.kind === 'video' ? source.proxyAttachment : undefined, source.kind === 'video' ? null : undefined);
	}
});

test('maintained preview and both delivery paths consume the same multicamera projection', () => {
	const project = cfrProject();
	const service = createFramescaperPlaybackProjectServiceV18(PROFILE);
	for (const projection of [
		service.projectForPlayback(project),
		service.projectForAudioRenderedFallbackDelivery(project),
		service.projectForVideoRenderedFallbackDelivery(project),
	]) {
		const runtime = projection.project as unknown as Record<string, unknown>;
		assert.equal(runtime.schemaVersion, 17);
		assert.equal(Object.hasOwn(runtime, 'multicameraGroups'), false);
		const output = (runtime.clips as readonly Record<string, unknown>[])
			.find((clip) => clip.id === 'output-clip');
		assert.equal(output?.sourceId, 'source-b');
		assert.equal(output?.sequenceStartFrame, 10);
		assert.equal(output?.sequenceFrameCount, 3);
		assert.equal(output?.sourceInFrame, 3);
		assert.equal(output?.sourceFrameCount, 3);
		const activeSource = (runtime.sources as readonly Record<string, unknown>[])
			.find((source) => source.id === 'source-b');
		assert.equal(activeSource?.storageKey, 'source-b');
		assert.equal(Object.hasOwn(activeSource ?? {}, 'proxyAttachment'), false);
	}
});

test('multicamera selection composes before exact nested playback materialization', () => {
	const project = cfrProject({ nested: true });
	const projection = createFramescaperPlaybackProjectServiceV18(PROFILE).projectForPlayback(project);
	const runtime = projection.project as unknown as Record<string, unknown>;
	const clips = runtime.clips as readonly Record<string, unknown>[];
	assert.equal(clips.length, 1);
	assert.equal(clips[0]?.sourceId, 'source-b');
	assert.equal(clips[0]?.sequenceId, 'root');
	assert.equal(clips[0]?.sequenceStartFrame, 20);
	assert.equal(clips[0]?.sequenceFrameCount, 3);
	assert.equal(clips[0]?.sourceInFrame, 3);
	assert.equal(clips[0]?.sourceFrameCount, 3);
	assert.equal(project.clips[0]?.sourceId, 'source-a');
});

test('multicamera playback refuses sample offsets between CFR source boundaries', () => {
	const project = cfrProject({ syncOffsetSamples: 1 });
	assert.throws(
		() => materializeFramescaperMulticameraPlaybackProjectV18(PROFILE, project),
		/exact.*source boundary|representable.*source/iu,
	);
	assert.equal(project.clips[0]?.sourceId, 'source-a');
});

test('multicamera playback admits VFR coordinates only with verified exact boundary evidence', () => {
	const fixture = vfrProject();
	assert.throws(
		() => materializeFramescaperMulticameraPlaybackProjectV18(PROFILE, fixture.project),
		/no verified timing view/iu,
	);
	const index = validateVideoTimingAssetBytes(fixture.publication.reference, fixture.publication.bytes);
	registerVideoTimingIndex(fixture.sourceB, index);
	try {
		const materialized = materializeFramescaperMulticameraPlaybackProjectV18(PROFILE, fixture.project);
		const output = materialized.clips.find((clip) => clip.id === 'output-clip');
		assert.equal(output?.sourceId, 'source-b');
		assert.equal(output?.sourceInFrame, 1);
		assert.equal(output?.sourceFrameCount, 1);
		assert.equal(output?.sequenceStartFrame, 10);
		assert.equal(output?.sequenceFrameCount, 2);
	} finally {
		unregisterVideoTimingIndex(fixture.sourceB);
	}
});

test('verified VFR evidence still refuses an exact time between presentation boundaries', () => {
	const fixture = vfrProject({ sourceInFrame: 2, sourceFrameCount: 1 });
	const index = validateVideoTimingAssetBytes(fixture.publication.reference, fixture.publication.bytes);
	registerVideoTimingIndex(fixture.sourceB, index);
	try {
		assert.throws(
			() => materializeFramescaperMulticameraPlaybackProjectV18(PROFILE, fixture.project),
			/exact.*source boundary|representable.*source/iu,
		);
	} finally {
		unregisterVideoTimingIndex(fixture.sourceB);
	}
});

test('multicamera playback authenticates V18 before traversing project input', () => {
	let reads = 0;
	const hostile = new Proxy({}, {
		get() { reads += 1; throw new Error('project get'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('project descriptor'); },
		ownKeys() { reads += 1; throw new Error('project keys'); },
	});
	assert.throws(
		() => materializeFramescaperMulticameraPlaybackProjectV18({}, hostile),
		/exact Framescaper V18/iu,
	);
	assert.equal(reads, 0);
});

function cfrProject(
	options: Readonly<{ nested?: boolean; syncOffsetSamples?: number }> = {},
): FramescaperProjectV18 {
	const rate = { num: 24, den: 1 };
	const nested = options.nested === true;
	const clipSequenceId = nested ? 'leaf' : 'main-sequence';
	const trackId = nested ? 'leaf-track' : 'video-track';
	return createFramescaperProjectV18(PROFILE, {
		id: 'multicamera-playback-v18', title: 'Multicamera playback V18', now: NOW,
		sampleRate: 48_000,
		sources: [
			videoSource('source-a', SOURCE_A_SHA, rate, 24),
			videoSource('source-b', SOURCE_B_SHA, rate, 24),
		],
		clips: [{
			kind: 'video', id: 'output-clip', sourceId: 'source-a', title: 'Multicamera output',
			sequenceId: clipSequenceId, sequenceStartFrame: 0, sequenceFrameCount: 3,
			sourceInFrame: 2, sourceFrameCount: 3, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: trackId, name: 'Video', clipIds: ['output-clip'], locked: false,
		})],
		sequences: nested ? [
			{ id: 'root', rate, trackIds: [] },
			{ id: 'leaf', rate, trackIds: [trackId] },
		] : [{ id: 'main-sequence', rate, trackIds: [trackId] }],
		primarySequenceId: nested ? 'root' : 'main-sequence',
		subsequences: nested ? [{
			id: 'root-leaf', sequenceId: 'root', sourceSequenceId: 'leaf',
			sequenceStartFrame: 20, sequenceFrameCount: 3, sourceInFrame: 0, sourceFrameCount: 3,
		}] : [],
		multicameraGroups: [multicameraGroup(
			clipSequenceId,
			options.syncOffsetSamples ?? 2_000,
		)],
	});
}

function vfrProject(
	options: Readonly<{ sourceInFrame?: number; sourceFrameCount?: number }> = {},
): Readonly<{
	readonly project: FramescaperProjectV18;
	readonly sourceB: Readonly<Record<string, unknown>>;
	readonly publication: ReturnType<typeof createVideoTimingAssetPublication>;
}> {
	const publication = createVideoTimingAssetPublication(SOURCE_B_SHA, {
		timescale: 1,
		presentationTicks: [0n, 1n, 3n],
		finalFrameDurationTicks: 2n,
	});
	const rate = { num: 1, den: 1 };
	const sourceB = videoSource('source-b', SOURCE_B_SHA, rate, 3, {
		sampleFrameCount: 240_000,
		timingAsset: publication.reference,
		timingDecision: { mode: 'exact', rate },
	});
	const sourceInFrame = options.sourceInFrame ?? 1;
	const sourceFrameCount = options.sourceFrameCount ?? 2;
	const project = createFramescaperProjectV18(PROFILE, {
		id: 'multicamera-vfr-v18', title: 'Multicamera VFR V18', now: NOW,
		sampleRate: 48_000,
		sources: [
			videoSource('source-a', SOURCE_A_SHA, rate, 5, { sampleFrameCount: 240_000 }),
			sourceB,
		],
		clips: [{
			kind: 'video', id: 'output-clip', sourceId: 'source-a', title: 'Multicamera output',
			sequenceId: 'main-sequence', sequenceStartFrame: 10, sequenceFrameCount: sourceFrameCount,
			sourceInFrame, sourceFrameCount, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['output-clip'], locked: false,
		})],
		sequences: [{ id: 'main-sequence', rate, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
		multicameraGroups: [{
			id: 'group-vfr', projectId: 'multicamera-vfr-v18', sequenceId: 'main-sequence',
			outputClipId: 'output-clip', activeMemberId: 'camera-b',
			members: [
				{ id: 'camera-a', groupId: 'group-vfr', sourceId: 'source-a', syncOffsetSamples: 0 },
				{ id: 'camera-b', groupId: 'group-vfr', sourceId: 'source-b', syncOffsetSamples: 0 },
			],
		}],
	});
	return { project, sourceB: project.sources[1]!, publication };
}

function multicameraGroup(sequenceId: string, syncOffsetSamples: number) {
	return {
		id: 'group-a', projectId: 'multicamera-playback-v18', sequenceId,
		outputClipId: 'output-clip', activeMemberId: 'camera-b',
		members: [
			{ id: 'camera-a', groupId: 'group-a', sourceId: 'source-a', syncOffsetSamples: 0 },
			{ id: 'camera-b', groupId: 'group-a', sourceId: 'source-b', syncOffsetSamples },
		],
	};
}

function videoSource(
	id: string,
	contentSha256: string,
	rate: Readonly<{ readonly num: number; readonly den: number }>,
	sourceFrameCount: number,
	options: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return createVideoSourceV10({
		id, name: id, storageKey: id, mimeType: 'video/mp4', contentSha256,
		sampleFrameCount: 48_000, sourceFrameCount, frameRate: rate,
		width: 1920, height: 1080, ...options,
	});
}
