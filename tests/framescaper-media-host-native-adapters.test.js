/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';
import {
	baseInput, bindCfrTiming, videoClip,
} from './helpers/video-retime-export-fixtures.ts';
import { createVideoRetimeExportIntentV6 } from '../src/common/editor/video-retime-export-plan.ts';

const repositoryRoot = resolve(import.meta.dirname, '..');
const hostRoot = join(repositoryRoot, 'native/framescaper-media-host');
const sourceRoot = join(hostRoot, 'src');

test('closed media adapters authenticate canonical plans and source bytes before execution', (context) => {
	const fixture = buildContractHost(context);
	if (fixture === null) return;
	try {
		const paths = operationPaths(fixture.directory);
		const result = run(fixture.executable, renderArguments(paths));
		assert.equal(result.status, 78, result.stderr);
		assert.deepEqual(JSON.parse(result.stdout), {
			error: 'unsupported-render-subset',
			operation: 'media-render',
			planVersion: 9,
			family: 'video-transition',
		});

		const tampered = run(fixture.executable, renderArguments(paths).map(
			(value) => value === paths.planSha256 ? '00'.repeat(32) : value,
		));
		assert.equal(tampered.status, 65);
		assert.match(tampered.stderr, /plan.*digest|authenticate/iu);

		const sourceTampered = run(fixture.executable, renderArguments(paths).map(
			(value) => value === paths.sourceSha256 ? '11'.repeat(32) : value,
		));
		assert.equal(sourceTampered.status, 65);
		assert.match(sourceTampered.stderr, /source.*digest|authenticate/iu);
	} finally {
		fixture.cleanup();
	}
});

test('the closed simple-render seam admits only a fully validated identity-mapped clip', (context) => {
	const fixture = buildContractHost(context);
	if (fixture === null) return;
	try {
		const paths = operationPaths(fixture.directory);
		const planValue = simpleUnifiedPlan(paths.sourceSha256);
		const planBytes = JSON.stringify(planValue);
		writeFileSync(paths.plan, planBytes);
		const admitted = run(fixture.executable, renderArguments({
			...paths, planSha256: digest(planBytes),
		}));
		assert.equal(admitted.status, 78, admitted.stderr);
		assert.deepEqual(JSON.parse(admitted.stdout), {
			error: 'contract-build-has-no-ffmpeg', operation: 'media-render',
			subset: 'single-full-frame-clip-v1',
		});

		const forged = structuredClone(planValue);
		forged.nodes[0].sourceTimeMapping.intent.intersections[0].sourceEndTime = {
			numerator: '1', denominator: '5',
		};
		forged.nodes[0].sourceTimeMapping.intent.intersections[0].clippedSourceEndTime = {
			numerator: '1', denominator: '5',
		};
		const forgedBytes = JSON.stringify(forged);
		writeFileSync(paths.plan, forgedBytes);
		const refused = run(fixture.executable, renderArguments({
			...paths, planSha256: digest(forgedBytes),
		}));
		assert.equal(refused.status, 78, refused.stderr);
		assert.deepEqual(JSON.parse(refused.stdout), {
			error: 'unsupported-render-subset', operation: 'media-render',
			planVersion: 9, family: 'exact-source-time-compositor',
		});
	} finally {
		fixture.cleanup();
	}
});

test('decode has a dedicated bounded scratch output and never gains destination authority', (context) => {
	const fixture = buildContractHost(context);
	if (fixture === null) return;
	try {
		const paths = operationPaths(fixture.directory);
		const result = run(fixture.executable, [
			'--operation', 'media-decode', '--plan', paths.plan,
			'--plan-sha256', paths.planSha256,
			'--source', paths.source, '--source-sha256', paths.sourceSha256,
			'--source-byte-length', String(paths.sourceByteLength), '--source-role', 'original',
			'--scratch', paths.scratch, '--decode-output', paths.decodeOutput,
			'--maximum-output-bytes', '1048576', '--backend', 'native-cpu',
		]);
		assert.equal(result.status, 78, result.stderr);
		assert.deepEqual(JSON.parse(result.stdout), {
			error: 'contract-build-has-no-ffmpeg', operation: 'media-decode',
		});

		for (const replacement of [
			join(paths.destination, 'decode-outside.frames'),
			paths.source,
		]) {
			const invalid = run(fixture.executable, [
				'--operation', 'media-decode', '--plan', paths.plan,
				'--plan-sha256', paths.planSha256,
				'--source', paths.source, '--source-sha256', paths.sourceSha256,
				'--source-byte-length', String(paths.sourceByteLength), '--source-role', 'original',
				'--scratch', paths.scratch, '--decode-output', replacement,
				'--maximum-output-bytes', '1048576', '--backend', 'native-cpu',
			]);
			assert.equal(invalid.status, 64);
			assert.match(invalid.stderr, /decode output|scratch|must not exist/iu);
		}
		const leakedDestination = run(fixture.executable, [
			'--operation', 'media-decode', '--plan', paths.plan,
			'--plan-sha256', paths.planSha256,
			'--source', paths.source, '--source-sha256', paths.sourceSha256,
			'--source-byte-length', String(paths.sourceByteLength), '--source-role', 'original',
			'--scratch', paths.scratch, '--decode-output', paths.decodeOutput,
			'--destination-root', paths.destination,
			'--maximum-output-bytes', '1048576', '--backend', 'native-cpu',
		]);
		assert.equal(leakedDestination.status, 64);
	} finally {
		fixture.cleanup();
	}
});

test('image-sequence pack admission binds inventory, rate, roles, index, and every frame digest', (context) => {
	const fixture = buildContractHost(context);
	if (fixture === null) return;
	try {
		const sequence = sequencePaths(fixture.directory);
		const admitted = run(fixture.executable, sequenceArguments(sequence));
		assert.equal(admitted.status, 78, admitted.stderr);
		assert.deepEqual(JSON.parse(admitted.stdout), {
			error: 'image-sequence-licensing-unavailable', operation: 'media-decode',
			policyRow: 'codec-image-sequence-still-formats',
		});
		assert.equal(exists(sequence.decodeOutput), false);

		const alias = sequenceArguments(sequence);
		alias[alias.indexOf('image-sequence-pack')] = 'original';
		const aliasResult = run(fixture.executable, alias);
		assert.equal(aliasResult.status, 64);
		assert.match(aliasResult.stderr, /exactly one pack|inventory role/iu);

		const wrongRate = sequenceArguments(sequence);
		wrongRate[wrongRate.indexOf('--sequence-rate-num') + 1] = '25';
		const wrongRateResult = run(fixture.executable, wrongRate);
		assert.equal(wrongRateResult.status, 65);
		assert.match(wrongRateResult.stderr, /canonical plan node|authenticate/iu);

		const tamperedPack = Buffer.from(readFileSync(sequence.pack));
		tamperedPack[tamperedPack.length - 1] ^= 0xff;
		writeFileSync(sequence.pack, tamperedPack);
		const tamperedPlan = sequencePlan(digest(tamperedPack), sequence.inventorySha256);
		const tamperedPlanBytes = JSON.stringify(tamperedPlan);
		writeFileSync(sequence.plan, tamperedPlanBytes);
		const tamperedArguments = sequenceArguments({
			...sequence, packSha256: digest(tamperedPack), planSha256: digest(tamperedPlanBytes),
		});
		const tampered = run(fixture.executable, tamperedArguments);
		assert.equal(tampered.status, 64);
		assert.match(tampered.stderr, /frame payload|SHA-256|inventory/iu);
		assert.equal(exists(sequence.decodeOutput), false);
	} finally {
		fixture.cleanup();
	}
});

test('proxy admission is exactly ProRes Proxy in MOV at or below 1280 by 720', (context) => {
	const fixture = buildContractHost(context);
	if (fixture === null) return;
	try {
		const paths = operationPaths(fixture.directory);
		const base = [
			'--operation', 'media-proxy', '--plan', paths.plan,
			'--plan-sha256', paths.planSha256,
			'--source', paths.source, '--source-sha256', paths.sourceSha256,
			'--source-byte-length', String(paths.sourceByteLength), '--source-role', 'original',
			'--temporary-output', paths.temporaryOutput,
			'--destination-root', paths.destination, '--scratch', paths.scratch,
			'--maximum-output-bytes', '1048576', '--backend', 'native-cpu',
			'--proxy-recipe', 'framescaper-native-prores-proxy-mov-v1',
			'--proxy-width', '1280', '--proxy-height', '720',
		];
		const admitted = run(fixture.executable, base);
		assert.equal(admitted.status, 78, admitted.stderr);
		assert.deepEqual(JSON.parse(admitted.stdout), {
			error: 'contract-build-has-no-ffmpeg', operation: 'media-proxy',
			container: 'mov', codec: 'prores_ks', width: 1280, height: 720,
			exportAuthority: 'original',
		});
		for (const [flag, value, pattern] of [
			['--proxy-width', '1282', /1280|geometry/iu],
			['--proxy-height', '721', /720|even|geometry/iu],
			['--proxy-recipe', 'h264-mp4', /recipe|ProRes/iu],
			['--source-role', 'proxy', /original|authority/iu],
		]) {
			const index = base.indexOf(flag);
			const args = [...base];
			args[index + 1] = value;
			const refused = run(fixture.executable, args);
			assert.equal(refused.status, 64);
			assert.match(refused.stderr, pattern);
		}
	} finally {
		fixture.cleanup();
	}
});

test('filesystem grants reject symlinks, existing outputs, and paths outside exact roots', (context) => {
	if (process.platform === 'win32') {
		context.skip('Unprivileged Windows builders cannot create this symlink fixture.');
		return;
	}
	const fixture = buildContractHost(context);
	if (fixture === null) return;
	try {
		const paths = operationPaths(fixture.directory);
		const sourceLink = join(fixture.directory, 'source-link.bin');
		symlinkSync(paths.source, sourceLink);
		const linked = renderArguments(paths);
		linked[linked.indexOf(paths.source)] = sourceLink;
		assert.equal(run(fixture.executable, linked).status, 64);

		writeFileSync(paths.temporaryOutput, 'occupied');
		const occupied = run(fixture.executable, renderArguments(paths));
		assert.equal(occupied.status, 64);
		assert.match(occupied.stderr, /temporary output.*must not exist/iu);
	} finally {
		fixture.cleanup();
	}
});

test('only exact V7 through V12 plan authorities are recognized and graph gaps are typed', (context) => {
	const fixture = buildContractHost(context);
	if (fixture === null) return;
	try {
		const paths = operationPaths(fixture.directory);
		for (const version of [6, 13]) {
			const invalidPlan = join(fixture.directory, `plan-v${String(version)}.json`);
			const bytes = JSON.stringify({ version, strategy: 'unknown' });
			writeFileSync(invalidPlan, bytes);
			const args = renderArguments(paths);
			args[args.indexOf(paths.plan)] = invalidPlan;
			args[args.indexOf(paths.planSha256)] = digest(bytes);
			const refused = run(fixture.executable, args);
			assert.equal(refused.status, 65);
			assert.match(refused.stderr, /unsupported-plan-version|V7.*V12/iu);
		}
	} finally {
		fixture.cleanup();
	}
});

test('FFmpeg adapter source uses libav APIs and contains no argv or filter-string seam', () => {
	const engine = readFileSync(join(sourceRoot, 'ffmpeg_media_engine.cpp'), 'utf8');
	const simple = readFileSync(join(sourceRoot, 'ffmpeg_simple_render.cpp'), 'utf8');
	const selected = readFileSync(join(sourceRoot, 'ffmpeg_selected_v20_adapter.cpp'), 'utf8');
	const framePack = readFileSync(join(sourceRoot, 'selected_v20_frame_pack.cpp'), 'utf8');
	for (const api of [
		'avformat_open_input', 'avcodec_send_packet', 'avcodec_receive_frame',
		'sws_scale', 'avformat_alloc_output_context2', 'avcodec_send_frame',
		'av_interleaved_write_frame',
	]) assert.match(engine, new RegExp(api, 'u'));
	assert.doesNotMatch(engine, /avfilter_graph_parse|system\s*\(|popen\s*\(|execv/iu);
	assert.doesNotMatch(engine, /-vf|-filter_complex|-codec:|-c:v/iu);
	assert.match(engine, /prores_ks/u);
	assert.match(engine, /framescaper-rgba-frame-pack-v1/u);
	for (const token of [
		'single-full-frame-clip-v1', 'libx264', 'libvpx-vp9',
		'codec-policy-unavailable', 'unsupported-rate-conversion',
		'avcodec_send_frame', 'av_interleaved_write_frame',
	]) assert.match(simple, new RegExp(token, 'u'));
	assert.match(engine, /execute_simple_render_job\(job\)/u);
	assert.doesNotMatch(simple, /avfilter_graph_parse|system\s*\(|popen\s*\(|execv/iu);
	assert.doesNotMatch(simple, /-vf|-filter_complex|-codec:|-c:v/iu);
	for (const token of [
		'execute_selected_v20_frames', 'avcodec_get_supported_config', 'swr_convert',
		'avcodec_send_frame', 'av_interleaved_write_frame', 'reauthenticate_sources',
		'selected-v20-v7-keyed-rgba',
	]) assert.match(selected, new RegExp(token, 'u'));
	assert.match(framePack, /framescaper-rgba-frame-pack-v1/u);
	assert.match(framePack, /require_output_cadence/u);
	assert.doesNotMatch(selected, /avfilter_graph_parse|system\s*\(|popen\s*\(|execv/iu);
	assert.doesNotMatch(selected, /-vf|-filter_complex|-codec:|-c:v/iu);
});

function buildContractHost(context) {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		return null;
	}
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-media-adapters-'));
	const executable = join(directory, 'framescaper-media-host');
	const files = [
		'media_host.cpp', 'image_sequence_pack.cpp', 'legacy_plan_semantics.cpp',
		'legacy_plan_v8_filter_semantics.cpp', 'media_file_grants.cpp', 'media_plan.cpp', 'sha256.cpp',
		'strict_json.cpp',
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
	const plan = join(directory, 'plan.json');
	const planBytes = JSON.stringify(unifiedPlan(sourceSha256));
	writeFileSync(plan, planBytes);
	return {
		scratch, destination, source, sourceSha256,
		sourceByteLength: readFileSync(source).byteLength, plan,
		planSha256: digest(planBytes),
		decodeOutput: join(scratch, 'decode.frames'),
		temporaryOutput: join(destination, 'export.tmp'),
	};
}

function sequencePaths(directory) {
	const scratch = join(directory, 'sequence-scratch');
	mkdirSync(scratch);
	const frames = [Buffer.from('png-frame-one'), Buffer.from('png-frame-two')];
	const entries = frames.map((bytes, index) => ({
		fileName: `plate.${String(index + 1).padStart(4, '0')}.png`,
		frameNumber: index + 1, byteLength: bytes.byteLength, sha256: digest(bytes),
	}));
	const inventoryBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, entries }));
	const inventorySha256 = digest(inventoryBytes);
	const inventory = join(directory, 'sequence.inventory.json');
	writeFileSync(inventory, inventoryBytes);
	const packBytes = sequencePack(frames, entries, inventoryBytes.byteLength, inventorySha256, 24, 1);
	const packSha256 = digest(packBytes);
	const pack = join(directory, 'sequence.pack');
	writeFileSync(pack, packBytes);
	const planValue = sequencePlan(packSha256, inventorySha256);
	const planBytes = JSON.stringify(planValue);
	const plan = join(directory, 'sequence-plan.json');
	writeFileSync(plan, planBytes);
	return {
		scratch, frames, entries, inventory, inventoryBytes, inventorySha256,
		pack, packBytes, packSha256, plan, planSha256: digest(planBytes),
		decodeOutput: join(scratch, 'decoded-sequence.frames'),
	};
}

function sequenceArguments(paths) {
	return [
		'--operation', 'media-decode', '--plan', paths.plan, '--plan-sha256', paths.planSha256,
		'--source', paths.pack, '--source-sha256', paths.packSha256,
		'--source-byte-length', String(readFileSync(paths.pack).byteLength),
		'--source-role', 'image-sequence-pack',
		'--source', paths.inventory, '--source-sha256', paths.inventorySha256,
		'--source-byte-length', String(paths.inventoryBytes.byteLength),
		'--source-role', 'image-sequence-inventory',
		'--sequence-profile', 'decode-png-sequence',
		'--sequence-rate-num', '24', '--sequence-rate-den', '1',
		'--scratch', paths.scratch, '--decode-output', paths.decodeOutput,
		'--maximum-output-bytes', '1048576', '--backend', 'native-cpu',
	];
}

function sequencePack(frames, entries, inventoryByteLength, inventorySha256, rateNum, rateDen) {
	const headerBytes = 128;
	const indexBytes = 64;
	const payloadOffset = headerBytes + entries.length * indexBytes;
	const totalBytes = payloadOffset + frames.reduce((total, frame) => total + frame.byteLength, 0);
	const output = Buffer.alloc(totalBytes);
	output.write('FSISPK01', 0, 'ascii');
	output.writeUInt32LE(headerBytes, 8);
	output.writeUInt32LE(indexBytes, 12);
	output.writeUInt32LE(1, 16);
	output.writeBigUInt64LE(BigInt(inventoryByteLength), 24);
	output.writeUInt32LE(entries.length, 32);
	output.writeUInt32LE(rateNum, 36);
	output.writeUInt32LE(rateDen, 40);
	output.writeBigUInt64LE(BigInt(headerBytes), 48);
	output.writeBigUInt64LE(BigInt(payloadOffset), 56);
	output.writeBigUInt64LE(BigInt(totalBytes), 64);
	Buffer.from(inventorySha256, 'hex').copy(output, 72);
	let payload = payloadOffset;
	for (const [index, entry] of entries.entries()) {
		const offset = headerBytes + index * indexBytes;
		output.writeUInt32LE(entry.frameNumber, offset);
		output.writeBigUInt64LE(BigInt(payload), offset + 8);
		output.writeBigUInt64LE(BigInt(entry.byteLength), offset + 16);
		Buffer.from(entry.sha256, 'hex').copy(output, offset + 24);
		frames[index].copy(output, payload);
		payload += entry.byteLength;
	}
	return output;
}

function sequencePlan(packSha256, inventorySha256) {
	const plan = structuredClone(unifiedExactPlanFixture(11));
	const source = plan.sources[0];
	source.storageKey = `image-sequence-pack-sha256:${packSha256}`;
	source.mimeType = 'application/vnd.soundscaper.image-sequence-pack';
	source.contentSha256 = packSha256;
	source.timing = { kind: 'cfr', frameCount: 2, rate: { num: 24, den: 1 } };
	const professional = plan.nodes.find(({ kind }) => kind === 'professional-media');
	professional.imageSequence.frameCount = 2;
	professional.imageSequence.frameRate = { num: 24, den: 1 };
	professional.imageSequence.firstFrameNumber = 1;
	professional.imageSequence.lastFrameNumber = 2;
	professional.imageSequence.inventory.storageKey = `image-sequence-inventory-sha256:${inventorySha256}`;
	professional.imageSequence.inventory.sha256 = inventorySha256;
	professional.imageSequence.inventory.byteLength = Buffer.byteLength(JSON.stringify({
		schemaVersion: 1,
		entries: [
			{ fileName: 'plate.0001.png', frameNumber: 1, byteLength: 13, sha256: digest('png-frame-one') },
			{ fileName: 'plate.0002.png', frameNumber: 2, byteLength: 13, sha256: digest('png-frame-two') },
		],
	}));
	professional.imageSequence.inventory.frameCount = 2;
	professional.imageSequence.inventory.firstFrameNumber = 1;
	professional.imageSequence.inventory.lastFrameNumber = 2;
	professional.imageSequence.sourcePack.storageKey = source.storageKey;
	professional.imageSequence.sourcePack.sha256 = packSha256;
	professional.imageSequence.sourcePack.byteLength = 270;
	professional.proxyAttachment = null;
	plan.nodes = [professional];
	return createUnifiedExactRenderPlan(plan);
}

function exists(path) {
	try { readFileSync(path); return true; } catch { return false; }
}

function renderArguments(paths) {
	return [
		'--operation', 'media-render', '--plan', paths.plan,
		'--plan-sha256', paths.planSha256,
		'--source', paths.source, '--source-sha256', paths.sourceSha256,
		'--source-byte-length', String(paths.sourceByteLength), '--source-role', 'original',
		'--temporary-output', paths.temporaryOutput,
		'--destination-root', paths.destination, '--scratch', paths.scratch,
		'--maximum-output-bytes', '1048576', '--backend', 'native-cpu',
	];
}

function unifiedPlan(sourceSha256) {
	const plan = structuredClone(unifiedExactPlanFixture(9));
	plan.sources[0].contentSha256 = sourceSha256;
	return createUnifiedExactRenderPlan(plan);
}

function simpleUnifiedPlan(sourceSha256) {
	const rate = Object.freeze({ num: 24, den: 1 });
	const clipId = 'clip-1';
	const intent = createVideoRetimeExportIntentV6(baseInput({
		sampleStart: 0,
		sampleDuration: 4,
		sampleRate: 24,
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
		version: 9,
		strategy: 'framescaper-unified-exact-v1',
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
			frameRate: rate, frameCount: 4,
			canvas: {
				width: 64, height: 36, fit: 'contain', pixelFormat: 'yuv420p',
				backgroundColor: '#000000',
			},
			includeAudio: false, audioLayout: null,
		},
		sources: [{
			inputIndex: 0, nodeId: 'source-node-1', sourceId: 'source-1',
			storageKey: 'media/source-1', mimeType: 'video/quicktime', contentSha256: sourceSha256,
			timing: { kind: 'cfr', frameCount: 4, rate },
		}],
		nodes: [{
			kind: 'clip', nodeId: 'clip-node-1', clipId, trackId: 'track-1',
			sourceNodeId: 'source-node-1', sequenceStartFrame: 0, sequenceFrameCount: 4,
			sourceInFrame: 0, sourceFrameCount: 4,
			sourceTimeMapping: { kind: 'video-retime-export-intent-v6', intent },
		}],
	});
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function run(executable, args) {
	return spawnSync(executable, args, { encoding: 'utf8' });
}
