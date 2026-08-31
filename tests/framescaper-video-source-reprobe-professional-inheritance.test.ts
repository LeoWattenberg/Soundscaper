/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import {
	createVideoTimingAssetPublication,
	decodeVideoTimingAsset,
} from '../src/common/editor/video-timing-asset.ts';
import { normalizeVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';
import {
	normalizeVideoSourceCharacteristicsV25,
} from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import { planVideoSourceUpgrade } from '../src/common/editor/video-source-upgrade.ts';
import { createDefaultDissolveVideoTransitionV1 } from '../src/common/editor/video-transition-registry.ts';
import {
	prepareFramescaperVideoTransitionAllocations,
	type FramescaperProjectCommand,
} from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';

const CONTENT_SHA256 = 'ef'.repeat(32);
const FABRICATED_RATE = Object.freeze({ num: 30, den: 1 });
const EXACT_RATE = Object.freeze({ num: 24, den: 1 });

test('a Framescaper re-probe carries professional facts through the V17 command projection', () => {
	const { plan, project, runtime } = professionalReprobeFixture();
	const execute = (command: FramescaperProjectCommand) => runtime.executeCommand(
		runtime.createHistory(project),
		command,
		{ now: '2026-08-31T12:00:01.000Z' },
	).present;
	const unreported = execute({
			type: 'source/reprobe', sourceId: plan.sourceId,
			changes: { characteristics: null }, clips: [],
		} as FramescaperProjectCommand);
	const unreportedCharacteristics = firstSource(unreported).characteristics as Readonly<Record<string, unknown>>;
	assert.equal(unreportedCharacteristics.backend, null);
	assert.equal(unreportedCharacteristics.bitDepth, 10);

	const plannedCharacteristics = plan.changes.characteristics as Readonly<Record<string, unknown>>;
	assert.throws(() => execute({
			type: 'source/reprobe', sourceId: plan.sourceId,
			changes: {
				...plan.changes,
				characteristics: { ...plannedCharacteristics, bitDepth: 12 },
			},
			clips: plan.clips,
		} as FramescaperProjectCommand), /cannot change professional source characteristics/u);

	const upgraded = execute({
			type: 'source/reprobe', sourceId: plan.sourceId,
			changes: plan.changes, clips: plan.clips,
		} as FramescaperProjectCommand);
	const upgradedSource = firstSource(upgraded);
	const characteristics = upgradedSource.characteristics as Readonly<Record<string, unknown>>;

	assert.deepEqual(upgradedSource.frameRate, EXACT_RATE);
	assert.equal(upgradedSource.sourceFrameCount, 240);
	assert.equal(characteristics.backend, 'ffmpeg');
	assert.equal(characteristics.bitDepth, 10);
	assert.equal(characteristics.pixelFormat, 'yuva420p10le');
	assert.equal(characteristics.chromaFormat, '4:2:0');
	assert.equal(characteristics.alphaMode, 'straight');
	assert.equal(characteristics.alphaInterpretation, 'transparency');
});

test('transition preflight overlays an allocation without replacing V25 re-probe authority', () => {
	const { plan, project, runtime } = professionalReprobeFixture();
	const command = {
		type: 'batch',
		commands: [
			{
				type: 'source/reprobe', sourceId: plan.sourceId,
				changes: plan.changes, clips: plan.clips,
			},
			{
				type: 'clip/move', clipId: 'incoming-clip', trackId: 'video-track',
				timelineStartFrame: 12_800,
			},
		],
	} as FramescaperProjectCommand;
	const prepared = prepareFramescaperVideoTransitionAllocations(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		project,
		command,
		() => 'generated-transition',
	);
	const leaves = commandLeaves(prepared);
	const reprobe = leaves.find(({ type }) => type === 'source/reprobe');
	const move = leaves.find(({ type }) => type === 'clip/move');
	assert.ok(reprobe && move);
	assert.deepEqual(reprobe.changes, plan.changes);
	assert.deepEqual(reprobe.videoTransitionAllocations, [{
		trackId: 'video-track', outgoingClipId: 'outgoing-clip',
		incomingClipId: 'incoming-clip', transitionId: 'generated-transition',
	}]);
	assert.equal(Object.hasOwn(move, 'videoTransitionAllocations'), false);

	const upgraded = runtime.executeCommand(
		runtime.createHistory(project),
		prepared,
		{ now: '2026-08-31T12:00:01.000Z' },
	).present;
	assert.deepEqual(firstSource(upgraded).characteristics, plan.changes.characteristics);
	const track = records(upgraded, 'tracks').find(({ id }) => id === 'video-track');
	assert.deepEqual(track?.videoTransitions, [createDefaultDissolveVideoTransitionV1({
		id: 'generated-transition', outgoingClipId: 'outgoing-clip',
		incomingClipId: 'incoming-clip', durationFrames: 2,
	})]);
});

function professionalReprobeFixture() {
	const source = createVideoSource({
		kind: 'video', id: 'video-source', storageKey: 'video-source', name: 'phone.mp4',
		mimeType: 'video/mp4', contentSha256: CONTENT_SHA256,
		frameCount: 480_000, sampleRate: 48_000, width: 640, height: 360,
		frameRate: FABRICATED_RATE, sourceFrameCount: 300,
		timingAsset: null,
		timingDecision: {
			mode: 'conform-cfr-at-ingest', rate: FABRICATED_RATE,
			reason: 'timing-probe-unavailable', failures: [],
		},
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
	}, 48_000);
	const professional = normalizeVideoSourceCharacteristicsV25({
		backend: 'framescaper-media-host', codedWidth: 640, codedHeight: 360,
		hasAlpha: true, videoCodec: 'h264', bitDepth: 10,
		pixelFormat: 'yuva420p10le', chromaFormat: '4:2:0',
		alphaMode: 'straight', alphaInterpretation: 'transparency',
	}, { rate: FABRICATED_RATE });
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'professional-reprobe', now: '2026-08-31T12:00:00.000Z',
		sources: [{ ...source, characteristics: professional }],
		clips: [
			{
				kind: 'video', id: 'outgoing-clip', sourceId: 'video-source', title: 'Outgoing',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
				sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
			},
			{
				kind: 'video', id: 'incoming-clip', sourceId: 'video-source', title: 'Incoming',
				sequenceId: 'main-sequence', sequenceStartFrame: 10, sequenceFrameCount: 10,
				sourceInFrame: 10, sourceFrameCount: 10, retimeMap: null,
			},
		],
		tracks: [createVideoTrack({
			id: 'video-track', name: 'Video', clipIds: ['outgoing-clip', 'incoming-clip'],
		})],
		sequences: [{
			id: 'main-sequence', rate: FABRICATED_RATE, trackIds: ['video-track'],
		}],
		primarySequenceId: 'main-sequence',
	});
	const publication = createVideoTimingAssetPublication(CONTENT_SHA256, {
		timescale: 24_000,
		presentationTicks: Array.from({ length: 240 }, (_value, index) => BigInt(index) * 1_000n),
		finalFrameDurationTicks: 1_000n,
	});
	const plan = planVideoSourceUpgrade({
		source: firstSource(project),
		probe: {
			decision: 'timing-asset', backend: 'ffmpeg', nominalRate: EXACT_RATE,
			timing: decodeVideoTimingAsset(publication.bytes),
			characteristics: normalizeVideoSourceCharacteristics({
				backend: 'ffmpeg', codedWidth: 640, codedHeight: 360,
				hasAlpha: true, videoCodec: 'h264',
			}, { rate: EXACT_RATE }),
		},
		timingAsset: publication.reference,
	});
	return {
		plan,
		project,
		runtime: createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE),
	};
}

function firstSource(project: unknown): Readonly<Record<string, unknown>> {
	assert.ok(project && typeof project === 'object' && !Array.isArray(project));
	const sources = (project as Readonly<Record<string, unknown>>).sources;
	assert.ok(Array.isArray(sources) && sources.length > 0);
	const source = sources[0];
	assert.ok(source && typeof source === 'object' && !Array.isArray(source));
	return source as Readonly<Record<string, unknown>>;
}

function commandLeaves(command: unknown): Readonly<Record<string, unknown>>[] {
	const candidate = record(command, 'command');
	if (candidate.type !== 'batch') return [candidate];
	return records(candidate, 'commands').flatMap(commandLeaves);
}

function records(value: unknown, field: string): Readonly<Record<string, unknown>>[] {
	const candidate = record(value, 'record');
	const values = candidate[field];
	assert.ok(Array.isArray(values));
	return values.map((item) => record(item, field));
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value), name);
	return value as Readonly<Record<string, unknown>>;
}
