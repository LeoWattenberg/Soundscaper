/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { createVideoKeyframeExportPlanV7 } from '../src/common/editor/video-keyframe-export-plan-v7.ts';
import { createVideoRetimeExportIntentV6 } from '../src/common/editor/video-retime-export-plan.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';
import {
	baseInput, bindCfrTiming, videoClip,
} from './helpers/video-retime-export-fixtures.ts';

const repositoryRoot = resolve(import.meta.dirname, '..');
const encodedFixture = join(
	repositoryRoot,
	'native/framescaper-media-host/tests/fixtures/prores-proxy-64x36-24fps-4frames.mov.b64',
);

test('a provisioned FFmpeg 9.0.1 host publishes decode, proxy, render, and encode bytes', (context) => {
	const executable = process.env.FRAMESCAPER_MEDIA_HOST_TEST_BINARY;
	if (!executable || !existsSync(executable)) {
		context.skip('Set FRAMESCAPER_MEDIA_HOST_TEST_BINARY to a locally linked, unshipped FFmpeg 9.0.1 fixture.');
		return;
	}
	const selfTest = run(executable, ['--self-test']);
	assert.equal(selfTest.status, 0, selfTest.stderr);
	assert.deepEqual(JSON.parse(selfTest.stdout), {
		contractVersion: 1, ffmpeg: '9.0.1', networkInitialized: false,
		versionsMatch: true, exactRetimeMatches: true, proresProxyEncoderPresent: true,
		professionalCharacteristicsMatches: true,
	});
	const selectedSelfTest = run(executable, ['--self-test-operation', 'selected-v20-render']);
	assert.equal(selectedSelfTest.status, 78, selectedSelfTest.stderr);
	assert.deepEqual({
		evaluatedRgbaInputBound: JSON.parse(selectedSelfTest.stdout).evaluatedRgbaInputBound,
		staticGeometryAdapterBound: JSON.parse(selectedSelfTest.stdout).staticGeometryAdapterBound,
		stagedAudioInputBound: JSON.parse(selectedSelfTest.stdout).stagedAudioInputBound,
		ready: JSON.parse(selectedSelfTest.stdout).ready,
	}, {
		evaluatedRgbaInputBound: true, staticGeometryAdapterBound: false,
		stagedAudioInputBound: true, ready: false,
	});
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-media-linked-'));
	try {
		const source = join(directory, 'source.mov');
		writeFileSync(source, Buffer.from(readFileSync(encodedFixture, 'utf8'), 'base64'));
		const sourceSha256 = digest(readFileSync(source));
		const plan = join(directory, 'plan.json');
		const planBytes = JSON.stringify(simpleExactPlan(sourceSha256));
		writeFileSync(plan, planBytes);
		const planSha256 = digest(planBytes);
		const scratch = join(directory, 'scratch');
		const destination = join(directory, 'destination');
		mkdirSync(scratch);
		mkdirSync(destination);
		const common = [
			'--plan', plan, '--plan-sha256', planSha256,
			'--source', source, '--source-sha256', sourceSha256,
			'--source-byte-length', String(readFileSync(source).byteLength), '--source-role', 'original',
			'--scratch', scratch, '--maximum-output-bytes', '1048576',
			'--backend', 'native-cpu',
		];

		const decoded = join(scratch, 'decoded.frames');
		const decode = run(executable, [
			'--operation', 'media-decode', ...common, '--decode-output', decoded,
		]);
		assert.equal(decode.status, 0, decode.stderr);
		assert.equal(JSON.parse(decode.stdout).frameCount, 4);
		assert.match(String(readFileSync(decoded).subarray(0, 32)), /^framescaper-rgba-frame-pack-v1/u);

		const carrier = join(scratch, 'selected-v20-evaluated.frames');
		writeFileSync(carrier, exactOutputCarrier(readFileSync(decoded), 24, 1));
		const stagedAudio = join(scratch, 'audio-mix.wav');
		writeFileSync(stagedAudio, silentPcmWav(48_000, 8_000, 2));
		const keyedPlanValue = selectedV20KeyedPlan(sourceSha256);
		const keyedPlanBytes = JSON.stringify(keyedPlanValue);
		const keyedPlan = join(directory, 'selected-v20-v7.json');
		writeFileSync(keyedPlan, keyedPlanBytes);
		const keyedOutput = join(destination, 'selected-v20-v7.mp4');
		const keyed = run(executable, [
			'--operation', 'media-render',
			'--plan', keyedPlan, '--plan-sha256', digest(keyedPlanBytes),
			'--source', source, '--source-sha256', sourceSha256,
			'--source-byte-length', String(readFileSync(source).byteLength), '--source-role', 'original',
			'--source', carrier, '--source-sha256', digest(readFileSync(carrier)),
			'--source-byte-length', String(readFileSync(carrier).byteLength),
			'--source-role', 'evaluated-rgba-frame-pack',
			'--source', stagedAudio, '--source-sha256', digest(readFileSync(stagedAudio)),
			'--source-byte-length', String(readFileSync(stagedAudio).byteLength),
			'--source-role', 'staged-audio-mix',
			'--scratch', scratch, '--maximum-output-bytes', '1048576', '--backend', 'native-cpu',
			'--destination-root', destination, '--temporary-output', keyedOutput,
			]);
			assert.equal(keyed.status, 0, keyed.stderr || keyed.stdout);
			const keyedResult = JSON.parse(keyed.stdout);
			assert.deepEqual({
				profile: keyedResult.profile,
				frameCount: keyedResult.frameCount,
				maximumInFlightFrames: keyedResult.maximumInFlightFrames,
			}, {
				profile: 'selected-v20-v7-keyed-rgba', frameCount: 4, maximumInFlightFrames: 1,
			});
			assert.equal(keyedResult.byteLength, readFileSync(keyedOutput).byteLength);
			assert.equal(keyedResult.sha256, digest(readFileSync(keyedOutput)));
			assertVideoOutput(executable, keyedOutput, 1);

			const evaluatedV8PlanValue = selectedV20EvaluatedV8Plan();
			const evaluatedV8PlanBytes = JSON.stringify(evaluatedV8PlanValue);
			const evaluatedV8Plan = join(directory, 'selected-v20-v8.json');
			writeFileSync(evaluatedV8Plan, evaluatedV8PlanBytes);
			const evaluatedV8Output = join(destination, 'selected-v20-v8.mp4');
			const evaluatedV8 = run(executable, [
				'--operation', 'media-render',
				'--plan', evaluatedV8Plan, '--plan-sha256', digest(evaluatedV8PlanBytes),
				'--source', source, '--source-sha256', sourceSha256,
				'--source-byte-length', String(readFileSync(source).byteLength), '--source-role', 'original',
				'--source', carrier, '--source-sha256', digest(readFileSync(carrier)),
				'--source-byte-length', String(readFileSync(carrier).byteLength),
				'--source-role', 'evaluated-rgba-frame-pack',
				'--scratch', scratch, '--maximum-output-bytes', '1048576', '--backend', 'native-cpu',
				'--destination-root', destination, '--temporary-output', evaluatedV8Output,
			]);
			assert.equal(evaluatedV8.status, 0, evaluatedV8.stderr || evaluatedV8.stdout);
			assert.deepEqual({
				profile: JSON.parse(evaluatedV8.stdout).profile,
				frameCount: JSON.parse(evaluatedV8.stdout).frameCount,
			}, { profile: 'selected-v20-v8-evaluated-rgba', frameCount: 4 });
			assertVideoOutput(executable, evaluatedV8Output, 0);

		const proxy = join(destination, 'proxy.mov');
		const proxyRun = run(executable, [
			'--operation', 'media-proxy', ...common,
			'--destination-root', destination, '--temporary-output', proxy,
			'--proxy-recipe', 'framescaper-native-prores-proxy-mov-v1',
			'--proxy-width', '64', '--proxy-height', '36',
		]);
		assert.equal(proxyRun.status, 0, proxyRun.stderr);
		assert.equal(JSON.parse(proxyRun.stdout).exportAuthority, 'original');
		assertVideoOutput(executable, proxy);

		for (const operation of ['media-render', 'media-encode']) {
			const output = join(destination, `${operation}.mp4`);
			const result = run(executable, [
				'--operation', operation, ...common,
				'--destination-root', destination, '--temporary-output', output,
			]);
			assert.equal(result.status, 78, result.stderr);
			assert.deepEqual(JSON.parse(result.stdout), {
				error: 'unsupported-render-subset', operation, planVersion: 9,
				family: 'unified-exact-v9-graph',
			});
			assert.equal(existsSync(output), false);
		}

		const mismatch = join(destination, 'mismatch.mov');
		const refused = run(executable, [
			'--operation', 'media-proxy', ...common,
			'--destination-root', destination, '--temporary-output', mismatch,
			'--proxy-recipe', 'framescaper-native-prores-proxy-mov-v1',
			'--proxy-width', '62', '--proxy-height', '34',
		]);
		assert.equal(refused.status, 78);
		assert.equal(JSON.parse(refused.stdout).error, 'proxy-geometry-mismatch');
		assert.equal(existsSync(mismatch), false);

		const visualPlan = structuredClone(simpleExactPlan(sourceSha256));
		visualPlan.version = 10;
		const visualNode = structuredClone(
			unifiedExactPlanFixture(10).nodes.find(({ kind }) => kind === 'visual'),
		);
		assert.ok(visualNode);
		visualNode.authoredFallback = null;
		visualNode.fallbackDisposition = null;
		visualNode.frozenFallback = null;
		visualPlan.nodes.push(visualNode);
		const visualPlanValue = createUnifiedExactRenderPlan(visualPlan);
		const visualPlanPath = join(directory, 'unified-v10-visual.json');
		const visualPlanBytes = JSON.stringify(visualPlanValue);
		writeFileSync(visualPlanPath, visualPlanBytes);
		const visualOutput = join(destination, 'unified-v10-visual.mp4');
		const visual = run(executable, [
			'--operation', 'media-render',
			...common.map((value) => value === plan ? visualPlanPath
				: value === planSha256 ? digest(visualPlanBytes) : value),
			'--destination-root', destination, '--temporary-output', visualOutput,
		]);
		assert.equal(visual.status, 78, visual.stderr || visual.stdout);
		assert.deepEqual(JSON.parse(visual.stdout), {
			error: 'unsupported-render-subset', operation: 'media-render', planVersion: 10,
			family: 'unified-exact-v10-graph',
		});
		assert.equal(existsSync(visualOutput), false);

		const sequence = writePngSequenceFixture(directory);
		const sequenceOutput = join(scratch, 'sequence.frames');
		const sequenceCommon = [
			'--operation', 'media-decode',
			'--plan', sequence.plan, '--plan-sha256', sequence.planSha256,
			'--source', sequence.pack, '--source-sha256', sequence.packSha256,
			'--source-byte-length', String(sequence.packBytes.byteLength),
			'--source-role', 'image-sequence-pack',
			'--source', sequence.inventory, '--source-sha256', sequence.inventorySha256,
			'--source-byte-length', String(sequence.inventoryBytes.byteLength),
			'--source-role', 'image-sequence-inventory',
			'--sequence-profile', 'decode-png-sequence',
			'--sequence-rate-num', '24', '--sequence-rate-den', '1',
			'--scratch', scratch, '--maximum-output-bytes', '1048576', '--backend', 'native-cpu',
		];
		const sequenceDecode = run(executable, [...sequenceCommon, '--decode-output', sequenceOutput]);
		assert.equal(sequenceDecode.status, 0, sequenceDecode.stderr || sequenceDecode.stdout);
		assert.deepEqual({
			profile: JSON.parse(sequenceDecode.stdout).profile,
			frameCount: JSON.parse(sequenceDecode.stdout).frameCount,
			exportAuthority: JSON.parse(sequenceDecode.stdout).exportAuthority,
		}, {
			profile: 'decode-png-sequence', frameCount: 2,
			exportAuthority: 'image-sequence-source-pack',
		});
		assert.match(String(readFileSync(sequenceOutput).subarray(0, 32)), /^framescaper-rgba-frame-pack-v1/u);

		const missingOutput = join(scratch, 'missing-inventory.frames');
		const missing = run(executable, [
			...sequenceCommon.map((value) => value === sequence.inventory
				? join(directory, 'missing.inventory.json') : value),
			'--decode-output', missingOutput,
		]);
		assert.notEqual(missing.status, 0);
		assert.equal(existsSync(missingOutput), false);

		const unsupportedOutput = join(scratch, 'unsupported-profile.frames');
		const unsupported = run(executable, [
			...sequenceCommon.map((value) => value === 'decode-png-sequence'
				? 'decode-tiff-sequence' : value),
			'--decode-output', unsupportedOutput,
		]);
		assert.notEqual(unsupported.status, 0);
		assert.equal(existsSync(unsupportedOutput), false);

		const tamperedBytes = Buffer.from(sequence.packBytes);
		tamperedBytes[tamperedBytes.length - 1] ^= 0xff;
		writeFileSync(sequence.pack, tamperedBytes);
		const tamperedOutput = join(scratch, 'tampered-sequence.frames');
		const tampered = run(executable, [...sequenceCommon, '--decode-output', tamperedOutput]);
		assert.notEqual(tampered.status, 0);
		assert.equal(existsSync(tamperedOutput), false);

		const hardwareOutput = join(destination, 'hardware-request.mp4');
		const hardware = run(executable, [
			'--operation', 'media-render',
			...common.map(
				(value) => value === 'native-cpu' ? 'nvenc' : value,
			),
			'--destination-root', destination, '--temporary-output', hardwareOutput,
		]);
		assert.equal(hardware.status, 78);
		assert.deepEqual(JSON.parse(hardware.stdout), {
			error: 'backend-policy-unavailable', operation: 'media-render',
			requestedBackend: 'nvenc', fallbackBackend: 'native-cpu',
		});
		assert.equal(existsSync(hardwareOutput), false);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

function assertVideoOutput(executable, path, expectedAudioStreams = null) {
	const result = run(executable, [
		'--operation', 'probe-video-source', '--source', path,
		'--source-sha256', digest(readFileSync(path)),
	]);
	assert.equal(result.status, 0, result.stderr);
	const probe = JSON.parse(result.stdout);
	assert.deepEqual({
		videoStreams: probe.videoStreams,
		width: probe.width,
		height: probe.height,
	}, { videoStreams: 1, width: 64, height: 36 });
	if (expectedAudioStreams !== null) assert.equal(probe.audioStreams, expectedAudioStreams);
}

function writePngSequenceFixture(directory) {
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64',
	);
	const frames = [png, png];
	const entries = frames.map((bytes, index) => ({
		fileName: `plate.${String(index + 1).padStart(4, '0')}.png`,
		frameNumber: index + 1, byteLength: bytes.byteLength, sha256: digest(bytes),
	}));
	const inventoryBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, entries }));
	const inventorySha256 = digest(inventoryBytes);
	const inventory = join(directory, 'linked-sequence.inventory.json');
	writeFileSync(inventory, inventoryBytes);
	const packBytes = sequencePack(frames, entries, inventoryBytes.byteLength, inventorySha256);
	const packSha256 = digest(packBytes);
	const pack = join(directory, 'linked-sequence.pack');
	writeFileSync(pack, packBytes);
	const planValue = imageSequenceExactPlan({
		packSha256, packByteLength: packBytes.byteLength,
		inventorySha256, inventoryByteLength: inventoryBytes.byteLength,
	});
	const planBytes = JSON.stringify(planValue);
	const plan = join(directory, 'linked-sequence-plan.json');
	writeFileSync(plan, planBytes);
	return {
		inventory, inventoryBytes, inventorySha256, pack, packBytes, packSha256,
		plan, planSha256: digest(planBytes),
	};
}

function sequencePack(frames, entries, inventoryByteLength, inventorySha256) {
	const payloadOffset = 128 + entries.length * 64;
	const output = Buffer.alloc(payloadOffset + frames.reduce((total, frame) => total + frame.byteLength, 0));
	output.write('FSISPK01', 0, 'ascii');
	output.writeUInt32LE(128, 8);
	output.writeUInt32LE(64, 12);
	output.writeUInt32LE(1, 16);
	output.writeBigUInt64LE(BigInt(inventoryByteLength), 24);
	output.writeUInt32LE(entries.length, 32);
	output.writeUInt32LE(24, 36);
	output.writeUInt32LE(1, 40);
	output.writeBigUInt64LE(128n, 48);
	output.writeBigUInt64LE(BigInt(payloadOffset), 56);
	output.writeBigUInt64LE(BigInt(output.byteLength), 64);
	Buffer.from(inventorySha256, 'hex').copy(output, 72);
	let payload = payloadOffset;
	for (const [index, entry] of entries.entries()) {
		const offset = 128 + index * 64;
		output.writeUInt32LE(entry.frameNumber, offset);
		output.writeBigUInt64LE(BigInt(payload), offset + 8);
		output.writeBigUInt64LE(BigInt(entry.byteLength), offset + 16);
		Buffer.from(entry.sha256, 'hex').copy(output, offset + 24);
		frames[index].copy(output, payload);
		payload += entry.byteLength;
	}
	return output;
}

function simpleExactPlan(sourceSha256) {
	const rate = Object.freeze({ num: 24, den: 1 });
	const clipId = 'clip-1';
	const intent = createVideoRetimeExportIntentV6(baseInput({
		sampleStart: 0, sampleDuration: 4, sampleRate: 24,
		sequenceBinding: { id: 'sequence-1', rate },
		topology: [{
			startSample: 0, endSample: 4, layers: [{ clips: [{ clipId }] }],
		}],
		canonicalClips: [videoClip(clipId, 'source-1', null, {
			sequenceStartFrame: 0, sequenceFrameCount: 4,
			sourceInFrame: 0, sourceFrameCount: 4,
		})],
	}), new Map([['source-1', bindCfrTiming('source-1', 4, rate)]]));
	return createUnifiedExactRenderPlan({
		version: 9, strategy: 'framescaper-unified-exact-v1',
		project: { id: 'project-1', revision: 0 },
		format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null,
			audioEncoder: null, pixelFormat: 'yuv420p',
		},
		timebase: {
			sampleStart: 0, sampleDuration: 4, sampleRate: 24,
			sequenceId: 'sequence-1', sequenceRate: rate,
		},
		output: {
			frameRate: rate, frameCount: 4, quality: 'balanced',
			canvas: {
				width: 64, height: 36, fit: 'contain', pixelFormat: 'yuv420p',
				backgroundColor: '#000000',
			},
			includeAudio: false, audioLayout: null,
		},
		tracks: [{
			trackId: 'track-1', sequenceOrder: 0, mute: false, solo: false, hidden: false,
		}],
		sources: [{
			inputIndex: 0, nodeId: 'source-node-1', sourceId: 'source-1',
			storageKey: 'media/source-1', mimeType: 'video/quicktime', contentSha256: sourceSha256,
			timing: { kind: 'cfr', frameCount: 4, rate },
		}],
		nodes: [{
			kind: 'clip', nodeId: 'clip-node-1', clipId, trackId: 'track-1',
			sourceNodeId: 'source-node-1', sequenceStartFrame: 0, sequenceFrameCount: 4,
			sourceInFrame: 0, sourceFrameCount: 4,
			pictureState: {
				composition: {
					schemaVersion: 1,
					crop: { left: 0, top: 0, right: 0, bottom: 0 },
					transform: {
						anchorX: 0.5, anchorY: 0.5, positionX: 0.5, positionY: 0.5,
						scaleX: 1, scaleY: 1, rotationDegrees: 0,
						flipHorizontal: false, flipVertical: false,
					},
					opacity: 1, blendMode: 'normal', compositingOrder: 0,
				},
				videoEffects: [],
				videoKeyframes: {
					schemaVersion: 1,
					timeDomain: {
						authoredDuration: { num: 4, den: 1 },
						viewStart: { num: 0, den: 1 }, viewDuration: { num: 4, den: 1 },
					},
					curves: [],
				},
			},
			sourceTimeMapping: {
				kind: 'video-retime-export-intent-v6', sourceRate: rate, retimeMap: null, intent,
			},
		}],
	});
}

function selectedV20KeyedPlan(sourceSha256) {
	return createVideoKeyframeExportPlanV7({
		format: 'mp4', sampleRate: 48_000,
		range: { startFrame: 0, endFrame: 8_000, durationFrames: 8_000 },
		canvas: {
			width: 64, height: 36, frameRate: { num: 24, den: 1 }, fit: 'contain',
			pixelFormat: 'yuv420p', backgroundColor: '#000000',
			referenceClipId: 'clip-1', referenceSourceId: 'source-1',
		},
		activeClipIds: ['clip-1'], activeSourceIds: ['source-1'],
		sources: [{
			kind: 'video', id: 'source-1', storageKey: 'media/source-1',
			mimeType: 'video/quicktime', contentSha256: sourceSha256,
		}],
		includeAudio: true, audioLayout: 'stereo', audioFileName: 'audio-mix.wav',
		quality: 'balanced',
	});
}

function selectedV20EvaluatedV8Plan() {
	return createVideoExportPlan({
		sampleRate: 24,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video', id: 'source-1', name: 'Source', mimeType: 'video/quicktime',
			storageKey: 'media/source-1', frameCount: 4, sampleRate: 24,
			width: 64, height: 36, frameRate: 24, videoCodec: 'prores', audioCodec: null,
			hasAudio: false, posterStorageKey: null, thumbnailStorageKey: null,
		}],
		clips: [{
			kind: 'video', id: 'clip-1', sourceId: 'source-1', title: 'Clip',
			timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 4,
			durationFrames: 4, trimStartFrames: 0, trimEndFrames: 0, speedRatio: 1,
			groupId: null, avLinkId: null, binItemId: null, color: 'blue',
		}],
		tracks: [{
			type: 'video', id: 'track-1', name: 'Video', clipIds: ['clip-1'],
			mute: false, hidden: false, collapsed: false, height: 120, laneGroupId: null,
		}],
	}, {
		includeAudio: false, range: { startFrame: 0, endFrame: 4 },
		canvas: { maximumWidth: 64, maximumHeight: 36 },
	});
}

function exactOutputCarrier(decoded, rateNum, rateDen) {
	const magic = Buffer.from('framescaper-rgba-frame-pack-v1\n');
	assert.equal(decoded.subarray(0, magic.byteLength).compare(magic), 0);
	const width = decoded.readUInt32LE(35);
	const height = decoded.readUInt32LE(39);
	const frameCount = Number(decoded.readBigUInt64LE(43));
	const frameBytes = width * height * 4;
	const frames = [];
	let inputOffset = 59;
	for (let ordinal = 0; ordinal < frameCount; ordinal += 1) {
		assert.equal(Number(decoded.readBigUInt64LE(inputOffset)), ordinal);
		assert.equal(Number(decoded.readBigUInt64LE(inputOffset + 24)), frameBytes);
		frames.push(decoded.subarray(inputOffset + 32, inputOffset + 32 + frameBytes));
		inputOffset += 32 + frameBytes;
	}
	assert.equal(inputOffset, decoded.byteLength);
	const output = Buffer.alloc(59 + frameCount * (32 + frameBytes));
	magic.copy(output, 0);
	output.writeUInt32LE(1, 31); output.writeUInt32LE(width, 35); output.writeUInt32LE(height, 39);
	output.writeBigUInt64LE(BigInt(frameCount), 43);
	output.writeUInt32LE(rateDen, 51); output.writeUInt32LE(rateNum, 55);
	let outputOffset = 59;
	for (let ordinal = 0; ordinal < frameCount; ordinal += 1) {
		output.writeBigUInt64LE(BigInt(ordinal), outputOffset);
		output.writeBigInt64LE(BigInt(ordinal), outputOffset + 8);
		output.writeBigInt64LE(1n, outputOffset + 16);
		output.writeBigUInt64LE(BigInt(frameBytes), outputOffset + 24);
		frames[ordinal].copy(output, outputOffset + 32);
		outputOffset += 32 + frameBytes;
	}
	return output;
}

function silentPcmWav(sampleRate, sampleCount, channels) {
	const bytesPerSample = 2;
	const dataBytes = sampleCount * channels * bytesPerSample;
	const output = Buffer.alloc(44 + dataBytes);
	output.write('RIFF', 0, 'ascii'); output.writeUInt32LE(36 + dataBytes, 4);
	output.write('WAVEfmt ', 8, 'ascii'); output.writeUInt32LE(16, 16);
	output.writeUInt16LE(1, 20); output.writeUInt16LE(channels, 22);
	output.writeUInt32LE(sampleRate, 24);
	output.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
	output.writeUInt16LE(channels * bytesPerSample, 32); output.writeUInt16LE(16, 34);
	output.write('data', 36, 'ascii'); output.writeUInt32LE(dataBytes, 40);
	return output;
}

function imageSequenceExactPlan({
	packSha256, packByteLength, inventorySha256, inventoryByteLength,
}) {
	const plan = structuredClone(simpleExactPlan(packSha256));
	plan.version = 11;
	plan.timebase.sampleDuration = 2;
	plan.output.frameCount = 2;
	plan.output.canvas.width = 1;
	plan.output.canvas.height = 1;
	plan.sources[0].storageKey = `image-sequence-pack-sha256:${packSha256}`;
	plan.sources[0].mimeType = 'application/vnd.soundscaper.image-sequence-pack';
	plan.sources[0].timing.frameCount = 2;
	const professional = structuredClone(
		unifiedExactPlanFixture(11).nodes.find(({ kind }) => kind === 'professional-media'),
	);
	assert.ok(professional?.imageSequence);
	professional.sourceNodeId = 'source-node-1';
	professional.imageSequence.stem = 'plate.';
	professional.imageSequence.extension = 'png';
	professional.imageSequence.frameNumberWidth = 4;
	professional.imageSequence.firstFrameNumber = 1;
	professional.imageSequence.lastFrameNumber = 2;
	professional.imageSequence.frameCount = 2;
	professional.imageSequence.frameRate = { num: 24, den: 1 };
	professional.imageSequence.inventory = {
		kind: 'image-sequence-inventory', version: 1,
		storageKey: `image-sequence-inventory-sha256:${inventorySha256}`,
		sha256: inventorySha256, byteLength: inventoryByteLength,
		frameCount: 2, firstFrameNumber: 1, lastFrameNumber: 2,
	};
	professional.imageSequence.sourcePack = {
		kind: 'image-sequence-source-pack',
		storageKey: `image-sequence-pack-sha256:${packSha256}`,
		sha256: packSha256, byteLength: packByteLength,
	};
	professional.proxyAttachment = null;
	plan.nodes = [professional];
	return createUnifiedExactRenderPlan(plan);
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function run(executable, args) {
	return spawnSync(executable, args, { encoding: 'utf8' });
}
