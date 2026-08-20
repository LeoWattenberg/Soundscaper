/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoSource, createVideoTrack } from '../../common/editor/project-media-factory.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../../common/editor/video-timing-asset.ts';
import { assertFramescaperProjectV18Profile } from '../editor-project-v18-profile.ts';
import {
	FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18,
} from '../editor-project-feature-requirements-v18.ts';
import { flattenFramescaperSequenceV18 } from '../editor-project-v18-nested-sequence.ts';
import {
	materializeFramescaperMulticameraPlaybackProjectV18,
} from '../editor-project-v18-multicam-playback.ts';
import {
	createFramescaperProjectV18,
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from '../editor-project-v18.ts';

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 7_200;
const ORIGINAL_SHA_A = '21'.repeat(32);
const ORIGINAL_SHA_B = '43'.repeat(32);
const VFR_SHA = '54'.repeat(32);
const PROXY_SHA = '65'.repeat(32);
const PROXY_TIMING_SHA = '87'.repeat(32);
const PROXY_FRAME_COUNT = 216_000;
const VFR_TIMING = createVideoTimingAssetPublication(VFR_SHA, {
	timescale: 1,
	presentationTicks: [0n, 1n, 3n],
	finalFrameDurationTicks: 2n,
});

export interface M3FramescaperV18ExitCheckpoint {
	readonly id: string;
	readonly kind: 'audio' | 'video' | 'nested' | 'multicamera';
	readonly expectedSample: number;
	readonly observedSample: number;
	readonly expectedVideoFrame: number | null;
	readonly observedVideoFrame: number | null;
}

export interface M3FramescaperV18ExitWorkload {
	readonly specification: Readonly<{
		readonly id: 'm3-framescaper-v18-exit';
		readonly durationSeconds: 7200;
		readonly sampleRate: 48000;
		readonly frameRates: readonly Readonly<Record<string, unknown>>[];
	}>;
	readonly project: FramescaperProjectV18;
	readonly vfrTimingBytes: readonly number[];
	readonly checkpoints: readonly Readonly<M3FramescaperV18ExitCheckpoint>[];
}

export interface M3FramescaperV18ExitValidation {
	readonly status: 'qualified-input';
	readonly checkpointCount: number;
	readonly maximumAudioErrorSamples: number;
	readonly maximumVideoErrorFrames: number;
	readonly maximumNestedErrorFrames: number;
	readonly maximumMulticameraErrorSamples: number;
}

/** Build deterministic schema-18 exit input without claiming unavailable proxy generation. */
export function createM3FramescaperV18ExitWorkload(
	profile: unknown,
): Readonly<M3FramescaperV18ExitWorkload> {
	assertFramescaperProjectV18Profile(profile);
	const project = exitProject(profile);
	const nested = flattenFramescaperSequenceV18(profile, project, 'main-sequence');
	const nestedClip = nested.find(({ clipId }) => clipId === 'nested-video-clip');
	if (!nestedClip || nestedClip.startFrame.denominator !== 1n) {
		throw new Error('The V18 exit workload nested checkpoint is not exact.');
	}
	const multicamera = materializeFramescaperMulticameraPlaybackProjectV18(profile, project);
	const cameraClip = multicamera.clips.find(({ id }) => id === 'multicamera-output');
	if (!cameraClip) throw new Error('The V18 exit workload multicamera checkpoint is missing.');
	const nestedFrame = Number(nestedClip.startFrame.numerator);
	const nestedSample = nestedFrame * (SAMPLE_RATE / 30);
	const cameraSample = Number(cameraClip.sequenceStartFrame) * (SAMPLE_RATE / 30);
	const checkpoints: readonly Readonly<M3FramescaperV18ExitCheckpoint>[] = Object.freeze([
		checkpoint('audio-start', 'audio', 0, 0, null, null),
		checkpoint('integer-video', 'video', 48_000, 48_000, 30, 30),
		checkpoint('ntsc-video', 'video', 48_048, 48_048, 30, 30),
		checkpoint('verified-vfr', 'video', 144_000, 144_000, 2, 2),
		checkpoint('nested-root', 'nested', nestedSample, nestedSample, nestedFrame, nestedFrame),
		checkpoint('multicamera-active', 'multicamera', cameraSample, cameraSample, 60, 60),
	]);
	return deepFreeze({
		specification: {
			id: 'm3-framescaper-v18-exit',
			durationSeconds: DURATION_SECONDS,
			sampleRate: SAMPLE_RATE,
			frameRates: [{ num: 30, den: 1 }, { num: 30_000, den: 1_001 }, { mode: 'verified-vfr-boundaries' }],
		},
		project,
		vfrTimingBytes: [...VFR_TIMING.bytes],
		checkpoints,
	});
}

/** Authenticate and enforce a zero-drift oracle before external host qualification. */
export function validateM3FramescaperV18ExitWorkload(
	profile: unknown,
	value: unknown,
): Readonly<M3FramescaperV18ExitValidation> {
	assertFramescaperProjectV18Profile(profile);
	const workload = record(value, 'V18 exit workload');
	validateFramescaperProjectV18(profile, workload.project);
	const timingBytes = array(workload.vfrTimingBytes, 'V18 exit VFR timing bytes');
	const source = (workload.project as FramescaperProjectV18).sources.find(({ id }) => id === 'vfr-source');
	if (!source || source.kind !== 'video' || source.timingAsset === null) {
		throw new ReferenceError('The V18 exit workload VFR source is missing exact timing evidence.');
	}
	validateVideoTimingAssetBytes(source.timingAsset, Uint8Array.from(timingBytes.map(safeByte)));
	const checkpoints = array(workload.checkpoints, 'V18 exit checkpoints');
	if (checkpoints.length === 0) throw new RangeError('The V18 exit workload requires checkpoints.');
	const maxima = { audio: 0, video: 0, nested: 0, multicamera: 0 };
	for (const [index, value] of checkpoints.entries()) {
		const check = record(value, `V18 exit checkpoint ${String(index)}`);
		const kind = check.kind;
		if (kind !== 'audio' && kind !== 'video' && kind !== 'nested' && kind !== 'multicamera') {
			throw new RangeError('A V18 exit checkpoint kind is unsupported.');
		}
		const sampleError = Math.abs(safeInteger(check.observedSample) - safeInteger(check.expectedSample));
		const frameError = nullableIntegerError(check.observedVideoFrame, check.expectedVideoFrame);
		if (sampleError !== 0 || frameError !== 0) throw new RangeError(`V18 ${kind} drift is nonzero.`);
		maxima[kind] = Math.max(maxima[kind], kind === 'video' || kind === 'nested' ? frameError : sampleError);
	}
	const expected = createM3FramescaperV18ExitWorkload(profile);
	if (JSON.stringify(workload) !== JSON.stringify(expected)) {
		throw new RangeError('The exact V18 exit cohort changed from its registered deterministic input.');
	}
	return Object.freeze({
		status: 'qualified-input',
		checkpointCount: checkpoints.length,
		maximumAudioErrorSamples: maxima.audio,
		maximumVideoErrorFrames: maxima.video,
		maximumNestedErrorFrames: maxima.nested,
		maximumMulticameraErrorSamples: maxima.multicamera,
	});
}

function exitProject(profile: unknown): FramescaperProjectV18 {
	const integerRate = { num: 30, den: 1 };
	const ntscRate = { num: 30_000, den: 1_001 };
	const sourceA = createVideoSource({
		id: 'camera-a', name: 'Camera A', storageKey: 'camera-a', mimeType: 'video/mp4',
		contentSha256: ORIGINAL_SHA_A, sampleFrameCount: SAMPLE_RATE * DURATION_SECONDS,
		sourceFrameCount: 216_000, frameRate: integerRate, width: 1920, height: 1080,
	});
	const sourceB = createVideoSource({
		id: 'camera-b', name: 'Camera B', storageKey: 'camera-b', mimeType: 'video/mp4',
		contentSha256: ORIGINAL_SHA_B, sampleFrameCount: SAMPLE_RATE * DURATION_SECONDS,
		sourceFrameCount: 216_000, frameRate: integerRate, width: 1920, height: 1080,
	});
	const vfrSource = createVideoSource({
		id: 'vfr-source', name: 'Verified VFR', storageKey: 'vfr-source', mimeType: 'video/mp4',
		contentSha256: VFR_SHA, sampleFrameCount: SAMPLE_RATE * 5,
		sourceFrameCount: 3, frameRate: { num: 1, den: 1 }, width: 1920, height: 1080,
		timingAsset: VFR_TIMING.reference, timingDecision: { mode: 'exact', rate: { num: 1, den: 1 } },
	});
	const project = createFramescaperProjectV18(profile, {
		id: 'm3-framescaper-v18-exit', title: 'Milestone 3 Framescaper V18 exit workload',
		now: '2026-08-13T00:00:00.000Z', sampleRate: SAMPLE_RATE,
		sources: [sourceA, sourceB, vfrSource],
		clips: [
			videoClip('multicamera-output', 'camera-a', 'main-sequence', 60, 120),
			videoClip('nested-video-clip', 'camera-a', 'nested-sequence', 0, 60),
			videoClip('vfr-video-clip', 'vfr-source', 'vfr-sequence', 0, 3),
		],
		tracks: [
			createVideoTrack({ id: 'main-video', name: 'Main video', clipIds: ['multicamera-output'] }),
			createVideoTrack({ id: 'nested-video', name: 'Nested video', clipIds: ['nested-video-clip'] }),
			createVideoTrack({ id: 'vfr-video', name: 'Verified VFR', clipIds: ['vfr-video-clip'] }),
		],
		sequences: [
			{
				id: 'main-sequence', rate: integerRate, trackIds: ['main-video'],
				startTimecode: { negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0 },
			},
			{ id: 'nested-sequence', rate: ntscRate, trackIds: ['nested-video'] },
			{ id: 'vfr-sequence', rate: { num: 1, den: 1 }, trackIds: ['vfr-video'] },
		],
		primarySequenceId: 'main-sequence',
		subsequences: [
			{
				id: 'nested-placement', sequenceId: 'main-sequence', sourceSequenceId: 'nested-sequence',
				sequenceStartFrame: 300, sequenceFrameCount: 1_001,
				sourceInFrame: 0, sourceFrameCount: 1_000,
			},
			{
				id: 'vfr-placement', sequenceId: 'main-sequence', sourceSequenceId: 'vfr-sequence',
				sequenceStartFrame: 1_500, sequenceFrameCount: 90,
				sourceInFrame: 0, sourceFrameCount: 3,
			},
		],
		multicameraGroups: [{
			id: 'camera-group', projectId: 'm3-framescaper-v18-exit', sequenceId: 'main-sequence',
			outputClipId: 'multicamera-output', activeMemberId: 'camera-b-member',
			members: [
				{ id: 'camera-a-member', groupId: 'camera-group', sourceId: 'camera-a', syncOffsetSamples: 0 },
				{ id: 'camera-b-member', groupId: 'camera-group', sourceId: 'camera-b', syncOffsetSamples: 1_600 },
			],
		}],
	});
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const source = (draft.sources as Record<string, unknown>[])[0]!;
	source.proxyAttachment = proxyAttachment();
	const manifest = draft.featureRequirements as { schemaVersion: number; requirements: unknown[] };
	draft.featureRequirements = {
		schemaVersion: manifest.schemaVersion,
		requirements: [...manifest.requirements, FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18],
	};
	validateFramescaperProjectV18(profile, draft);
	return draft as unknown as FramescaperProjectV18;
}

function proxyAttachment(): Record<string, unknown> {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${PROXY_SHA}`,
		mimeType: 'video/webm', byteLength: 1_024, sha256: PROXY_SHA,
		originalSha256: ORIGINAL_SHA_A, originalAuthorityKind: 'owned',
		generatorId: 'qualified-input-fixture', generatorVersion: 1,
		recipeId: 'milestone-3-exit', recipeVersion: 1, timingBackendId: 'fixture-exact',
		timingRule: 'exact-presentation-boundaries-v1',
		frameCount: PROXY_FRAME_COUNT, boundaryCount: PROXY_FRAME_COUNT + 1,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${PROXY_TIMING_SHA}`,
			sha256: PROXY_TIMING_SHA, sourceSha256: PROXY_SHA,
			byteLength: 32 + PROXY_FRAME_COUNT * 8, frameCount: PROXY_FRAME_COUNT,
			timescale: 30, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function videoClip(id: string, sourceId: string, sequenceId: string, start: number, count: number) {
	return {
		kind: 'video', id, sourceId, title: id, sequenceId,
		sequenceStartFrame: start, sequenceFrameCount: count,
		sourceInFrame: 0, sourceFrameCount: count, retimeMap: null,
	};
}

function checkpoint(
	id: string, kind: M3FramescaperV18ExitCheckpoint['kind'],
	expectedSample: number, observedSample: number,
	expectedVideoFrame: number | null, observedVideoFrame: number | null,
): Readonly<M3FramescaperV18ExitCheckpoint> {
	return Object.freeze({ id, kind, expectedSample, observedSample, expectedVideoFrame, observedVideoFrame });
}

function nullableIntegerError(left: unknown, right: unknown): number {
	if (left === null && right === null) return 0;
	if (left === null || right === null) throw new RangeError('A V18 exit video checkpoint is incomplete.');
	return Math.abs(safeInteger(left) - safeInteger(right));
}

function safeInteger(value: unknown): number {
	if (!Number.isSafeInteger(value)) throw new RangeError('A V18 exit coordinate must be a safe integer.');
	return Number(value);
}

function safeByte(value: unknown): number {
	const byte = safeInteger(value);
	if (byte < 0 || byte > 255) throw new RangeError('A V18 exit timing byte is outside Uint8 range.');
	return byte;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as Record<string, unknown>;
}

function array(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}

function deepFreeze<Value>(value: Value): Readonly<Value> {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
