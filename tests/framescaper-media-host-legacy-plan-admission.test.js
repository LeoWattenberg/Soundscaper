/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { createVideoKeyframeExportPlanV7 } from '../src/common/editor/video-keyframe-export-plan-v7.ts';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceRoot = join(repositoryRoot, 'native/framescaper-media-host/src');

test('V7 admission closes keyed plan metadata, identities, nested fields, and source digests', (context) => {
	const fixture = buildContractHost(context);
	if (fixture === null) return;
	try {
		const paths = operationPaths(fixture.directory);
		const canonical = legacyV7Plan(paths.sourceSha256);
		const admitted = runLegacyPlan(fixture.executable, paths, canonical);
		assert.equal(admitted.status, 78, admitted.stderr);
		assert.deepEqual(JSON.parse(admitted.stdout), {
			error: 'contract-build-has-no-ffmpeg', operation: 'media-render',
			subset: 'evaluated-rgba-frame-pack-v1', planVersion: 7,
		});

		const cases = [
			['reordered canvas', (plan) => {
				const canvas = plan.canvas;
				plan.canvas = {
					height: canvas.height, width: canvas.width, frameRate: canvas.frameRate,
					fit: canvas.fit, pixelFormat: canvas.pixelFormat,
					backgroundColor: canvas.backgroundColor,
					referenceClipId: canvas.referenceClipId,
					referenceSourceId: canvas.referenceSourceId,
				};
			}],
			['extra source field', (plan) => { plan.inputs[0].nativePath = '/not-authorized'; }],
			['non-canonical codec', (plan) => { plan.codecs.videoEncoder = 'raw-argv'; }],
			['inexact frame count', (plan) => { plan.outputFrameCount += 1; }],
			['inexact audio range', (plan) => { plan.inputs.at(-1).durationFrames -= 1; }],
			['unbound source identity', (plan) => { plan.inputs[0].sourceId = 'source-other'; }],
			['unbound canvas reference', (plan) => { plan.canvas.referenceClipId = 'clip-other'; }],
			['tampered source digest', (plan) => { plan.inputs[0].contentSha256 = '11'.repeat(32); }],
		];
		assertRefusedCases(fixture.executable, paths, canonical, cases);
	} finally {
		fixture.cleanup();
	}
});

test('V8 admission closes static graph, filter equivalence, captions, and burn-in bounds', (context) => {
	const fixture = buildContractHost(context);
	if (fixture === null) return;
	try {
		const paths = operationPaths(fixture.directory);
		const canonical = legacyV8Plan();
		const admitted = runLegacyPlan(fixture.executable, paths, canonical);
		assert.equal(admitted.status, 78, admitted.stderr);
		assert.deepEqual(JSON.parse(admitted.stdout), {
			error: 'contract-build-has-no-ffmpeg', operation: 'media-render',
			subset: 'evaluated-rgba-frame-pack-v1', planVersion: 8,
		});
		const repeatedClip = runLegacyPlan(fixture.executable, paths, legacyV8MultiIntervalPlan());
		assert.equal(repeatedClip.status, 78, repeatedClip.stderr);
		assert.equal(JSON.parse(repeatedClip.stdout).subset, 'evaluated-rgba-frame-pack-v1');

		const cases = [
			['reordered layer', (plan) => {
				const layer = plan.intervals[0].layers[0];
				plan.intervals[0].layers[0] = {
					trackIndex: layer.trackIndex, trackId: layer.trackId, clips: layer.clips,
				};
			}],
			['extra clip field', (plan) => { plan.intervals[0].layers[0].clips[0].argv = ['-vf']; }],
			['non-canonical codec', (plan) => { plan.codecs.videoEncoder = 'raw-argv'; }],
			['inexact frame count', (plan) => { plan.outputFrameCount += 1; }],
			['inconsistent range', (plan) => { plan.range.durationFrames -= 1; }],
			['odd canvas width', (plan) => { plan.canvas.width -= 1; }],
			['inexact audio range', (plan) => { plan.inputs.at(-1).startFrame = 1; }],
			['unbound clip input', (plan) => {
				plan.intervals[0].layers[0].clips[0].sourceId = 'source-other';
			}],
			['unsupported source presentation', (plan) => {
				plan.inputs[0].presentation = { autorotate: true };
			}],
			['unsupported video effect', (plan) => {
				plan.intervals[0].layers[0].clips[0].videoEffects = [{ type: 'opaque-native-effect' }];
			}],
			['tampered filter clip identity', (plan) => {
				plan.filterPlan.intervals[0].layers[0].clips[0].sourceId = 'source-other';
			}],
			['reordered filter operation', (plan) => {
				const operation = plan.filterPlan.intervals[0].layers[0].clips[0].operations[0];
				plan.filterPlan.intervals[0].layers[0].clips[0].operations[0] = {
					startSeconds: operation.startSeconds, name: operation.name,
					endSeconds: operation.endSeconds,
				};
			}],
			['oversized caption count', (plan) => { plan.captions.cueCount = 100_001; }],
			['oversized burn-in text', (plan) => {
				plan.filterPlan.burnIn.cues[0].text = 'x'.repeat(501);
			}],
		];
		assertRefusedCases(fixture.executable, paths, canonical, cases);
	} finally {
		fixture.cleanup();
	}
});

function assertRefusedCases(executable, paths, canonical, cases) {
	for (const [name, mutate] of cases) {
		const plan = structuredClone(canonical);
		mutate(plan);
		const refused = runLegacyPlan(executable, paths, plan);
		assert.equal(refused.status, 65, `${name}: ${refused.stderr}`);
		assert.match(refused.stderr, /authenticate|canonical|malformed|source|unsupported|ceiling/iu, name);
	}
}

function buildContractHost(context) {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		return null;
	}
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-legacy-plans-'));
	const executable = join(directory, 'framescaper-media-host');
	const files = [
		'media_host.cpp', 'image_sequence_pack.cpp', 'legacy_plan_semantics.cpp',
		'legacy_plan_v8_filter_semantics.cpp', 'media_file_grants.cpp', 'media_plan.cpp',
		'sha256.cpp', 'strict_json.cpp',
	].map((file) => join(sourceRoot, file));
	const built = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		'-DFRAMESCAPER_MEDIA_HOST_CONTRACT_ONLY=1', '-I', sourceRoot,
		...files, '-o', executable,
	], { encoding: 'utf8' });
	assert.equal(built.status, 0, built.stderr);
	return {
		directory, executable,
		cleanup: () => rmSync(directory, { recursive: true, force: true }),
	};
}

function operationPaths(directory) {
	const scratch = join(directory, 'scratch');
	const destination = join(directory, 'destination');
	mkdirSync(scratch);
	mkdirSync(destination);
	const source = join(directory, 'original.bin');
	writeFileSync(source, 'original-media-fixture');
	const sourceSha256 = digest(readFileSync(source));
	const carrier = join(directory, 'evaluated.frames');
	writeFileSync(carrier, 'authenticated-evaluated-rgba-fixture');
	const audio = join(directory, 'audio-mix.wav');
	writeFileSync(audio, 'authenticated-staged-audio-fixture');
	return {
		scratch, destination, source, sourceSha256,
		sourceByteLength: readFileSync(source).byteLength,
		carrier, carrierSha256: digest(readFileSync(carrier)),
		carrierByteLength: readFileSync(carrier).byteLength,
		audio, audioSha256: digest(readFileSync(audio)),
		audioByteLength: readFileSync(audio).byteLength,
		plan: join(directory, 'plan.json'),
		temporaryOutput: join(destination, 'export.tmp'),
	};
}

function runLegacyPlan(executable, paths, plan) {
	const bytes = JSON.stringify(plan);
	writeFileSync(paths.plan, bytes);
	return spawnSync(executable, renderArguments({
		...paths, planSha256: digest(bytes), planVersion: plan.version,
		includesAudio: plan.inputs.some(({ kind }) => kind === 'staged-audio-mix'),
	}), {
		encoding: 'utf8',
	});
}

function renderArguments(paths) {
	const derived = [
		...(paths.planVersion === 7 || paths.planVersion === 8 ? [
			'--source', paths.carrier, '--source-sha256', paths.carrierSha256,
			'--source-byte-length', String(paths.carrierByteLength),
			'--source-role', 'evaluated-rgba-frame-pack',
		] : []),
		...(paths.includesAudio ? [
			'--source', paths.audio, '--source-sha256', paths.audioSha256,
			'--source-byte-length', String(paths.audioByteLength), '--source-role', 'staged-audio-mix',
		] : []),
	];
	return [
		'--operation', 'media-render', '--plan', paths.plan, '--plan-sha256', paths.planSha256,
		'--source', paths.source, '--source-sha256', paths.sourceSha256,
		'--source-byte-length', String(paths.sourceByteLength), '--source-role', 'original',
		...derived,
		'--temporary-output', paths.temporaryOutput,
		'--destination-root', paths.destination, '--scratch', paths.scratch,
		'--maximum-output-bytes', '1048576', '--backend', 'native-cpu',
	];
}

function legacyV7Plan(sourceSha256) {
	return createVideoKeyframeExportPlanV7({
		format: 'mp4', sampleRate: 48_000,
		range: { startFrame: 0, endFrame: 48_000, durationFrames: 48_000 },
		canvas: {
			width: 64, height: 36, frameRate: { num: 24, den: 1 }, fit: 'contain',
			pixelFormat: 'yuv420p', backgroundColor: '#000000',
			referenceClipId: 'clip-1', referenceSourceId: 'source-1',
		},
		activeClipIds: ['clip-1'], activeSourceIds: ['source-1'],
		sources: [{
			kind: 'video', id: 'source-1', storageKey: 'media/source-1', mimeType: 'video/mp4',
			contentSha256: sourceSha256,
		}],
		includeAudio: true, audioLayout: 'stereo', audioFileName: 'audio-mix.wav',
		quality: 'balanced',
	});
}

function legacyV8Plan() {
	return createVideoExportPlan(legacyV8Project(), {
		includeAudio: true, range: { startFrame: 0, endFrame: 48_000 },
		canvas: { maximumWidth: 640, maximumHeight: 360 },
		captions: { trackId: 'captions', mux: true, burnIn: true, sidecar: 'srt' },
	});
}

function legacyV8MultiIntervalPlan() {
	const project = legacyV8Project();
	project.clips.push({
		...project.clips[0], id: 'clip-2', title: 'Clip 2', timelineStartFrame: 24_000,
		sourceStartFrame: 0, sourceDurationFrames: 24_000, durationFrames: 24_000,
	});
	project.tracks.splice(1, 0, {
		type: 'video', id: 'track-2', name: 'Video 2', clipIds: ['clip-2'],
		mute: false, hidden: false, collapsed: false, height: 120, laneGroupId: null,
	});
	return createVideoExportPlan(project, {
		includeAudio: false, range: { startFrame: 0, endFrame: 48_000 },
		canvas: { maximumWidth: 640, maximumHeight: 360, fit: 'cover' },
	});
}

function legacyV8Project() {
	return {
		sampleRate: 48_000,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video', id: 'source-1', name: 'Source', mimeType: 'video/mp4',
			storageKey: 'media/source-1', frameCount: 480_000, sampleRate: 48_000,
			width: 640, height: 360, frameRate: 30, videoCodec: 'h264', audioCodec: 'aac',
			hasAudio: false, posterStorageKey: null, thumbnailStorageKey: null,
		}],
		clips: [{
			kind: 'video', id: 'clip-1', sourceId: 'source-1', title: 'Clip',
			timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000,
			durationFrames: 48_000, trimStartFrames: 0, trimEndFrames: 0, speedRatio: 1,
			groupId: null, avLinkId: null, binItemId: null, color: 'blue',
		}],
		tracks: [{
			type: 'video', id: 'track-1', name: 'Video', clipIds: ['clip-1'],
			mute: false, hidden: false, collapsed: false, height: 120, laneGroupId: null,
		}, {
			type: 'label', id: 'captions', name: 'Captions',
			labels: [{ id: 'cue-1', startFrame: 4_800, endFrame: 14_400, title: 'Hello' }],
			mute: false, hidden: false, collapsed: false, height: 80, laneGroupId: null,
		}],
	};
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
