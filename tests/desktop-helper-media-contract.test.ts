/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_IN_FLIGHT_CHUNKS_MAXIMUM,
	HELPER_CONTRACT_VERSION,
	HELPER_JOB_KINDS,
	HELPER_JOB_RESOURCE_HARD_LIMITS,
	HelperContractViolationError,
	HelperDataPlaneReceiver,
	HelperDataPlaneSender,
	type HelperDataPlaneBinding,
	type HelperDataPlaneOutputReservation,
	helperJobGrantResourceUsage,
	normalizeHelperResourcePolicy,
	validateHelperDataPlaneBinding,
	validateHelperDataPlaneMessage,
	validateHelperDataPlaneOutputReservation,
	validateHelperHostMessage,
	validateHelperJobResult,
} from '../desktop/helper-contract.ts';
import {
	createHarness,
	settled,
	supervisionCause,
} from './helpers/helper-supervisor-double.ts';
import { createOfxHostInvocationV1 } from '../src/common/editor/native-ofx-host-contract.ts';

const JOB_ID = 'ab'.repeat(20);
const STREAM_ID = 'cd'.repeat(20);
const SHA256 = '1'.repeat(64);
const IDENTITY = Object.freeze({ dev: 4, ino: 18 });

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function binding(
	direction: 'host-to-helper' | 'helper-to-host',
	bytes = new Uint8Array([1, 2, 3, 4]),
	overrides: Readonly<Record<string, unknown>> = {},
): HelperDataPlaneBinding {
	return {
		dataPlaneVersion: 1,
		transport: 'message-port',
		streamId: STREAM_ID,
		direction,
		byteLength: bytes.byteLength,
		sha256: digest(bytes),
		maximumChunkBytes: 2,
		maximumInFlightChunks: 1,
		...overrides,
	} as HelperDataPlaneBinding;
}

function outputReservation(
	streamId: string,
	exactByteLength: number | null,
	maximumByteLength = exactByteLength ?? 4_096,
): HelperDataPlaneOutputReservation {
	return {
		dataPlaneVersion: 1, transport: 'message-port', streamId,
		direction: 'helper-to-host', exactByteLength, maximumByteLength,
		maximumChunkBytes: Math.max(1, Math.min(maximumByteLength, 16 * 1024 * 1024)),
		maximumInFlightChunks: 1,
	};
}

const EXECUTABLE = Object.freeze({
	role: 'ffmpeg',
	path: '/app/runtime/framescaper/ffmpeg',
	bytes: 32_768,
	sha256: SHA256,
	identity: IDENTITY,
});

const SOURCE = Object.freeze({
	type: 'file',
	role: 'original',
	path: '/media/source.mov',
	bytes: 2_048,
	sha256: '2'.repeat(64),
	identity: { dev: 4, ino: 19 },
});

const IMAGE_SEQUENCE = Object.freeze({
	kind: 'native-image-sequence-decode-v1',
	profileId: 'decode-png-sequence',
	frameRate: Object.freeze({ num: 24, den: 1 }),
});

const OUTPUT = Object.freeze({
	rootPath: '/exports',
	rootIdentity: { dev: 4, ino: 20 },
	temporaryPath: '/exports/.movie.mov.framescaper-abcd.tmp',
	finalPath: '/exports/movie.mov',
	maximumBytes: 4_096,
});

const SCRATCH = Object.freeze({
	rootPath: '/scratch/framescaper',
	rootIdentity: { dev: 4, ino: 21 },
	reservationId: JOB_ID,
	maximumBytes: 8_192,
});

const PLAN = Object.freeze(binding('host-to-helper', undefined, { streamId: 'ef'.repeat(20) }));
const STREAM_OUTPUT = Object.freeze(binding('helper-to-host'));
const OFX_OUTPUT_RESERVATION = Object.freeze(outputReservation(STREAM_ID, 4));
const OFX_DESCRIPTOR_RESERVATION = Object.freeze(outputReservation(STREAM_ID, null));
const OFX_INPUT_FRAME = Object.freeze(binding('host-to-helper', undefined, {
	streamId: 'ac'.repeat(20),
}));
const OFX_FRAME_LAYOUT = Object.freeze({
	pixelFormat: 'rgba8' as const, width: 1, height: 1, rowBytes: 4,
});
const OFX_INVOCATION = createOfxHostInvocationV1({
	invocationId: 'ofx-helper-contract',
	unifiedPlanVersion: 12,
	unifiedPlanSha256: PLAN.sha256,
	nodeId: 'openfx-node',
	instanceId: 'ofx-instance-1',
	pluginId: 'net.example.Blur',
	pluginBinarySha256: SHA256,
	context: 'filter',
	action: 'render',
	stateSha256: '3'.repeat(64),
	inputFrameStreamIds: [OFX_INPUT_FRAME.streamId],
	outputFrameStreamId: OFX_OUTPUT_RESERVATION.streamId,
	outputOrdinal: 3,
	requestedBackend: 'cpu',
	abortSignalId: 'abort-ofx-helper-contract',
});
const PLAN_PORT = Object.freeze({ postMessage() {}, close() {} });
const PLAN_TRANSFER = Object.freeze([{ streamId: PLAN.streamId, port: PLAN_PORT }]);

const MEDIA_JOBS = Object.freeze([
	{
		kind: 'media-decode',
		grant: {
			executable: EXECUTABLE,
			plan: PLAN,
			sources: [SOURCE],
			output: STREAM_OUTPUT,
			scratch: SCRATCH,
		},
	},
	{
		kind: 'media-encode',
		grant: {
			executable: EXECUTABLE,
			backend: 'native-cpu',
			plan: PLAN,
			sources: [SOURCE],
			output: OUTPUT,
			scratch: SCRATCH,
		},
	},
	{
		kind: 'media-render',
		grant: {
			executable: EXECUTABLE,
			backend: 'native-cpu',
			plan: PLAN,
			sources: [SOURCE],
			output: OUTPUT,
			scratch: SCRATCH,
		},
	},
	{
		kind: 'media-proxy',
		grant: {
			executable: EXECUTABLE,
			plan: PLAN,
			source: SOURCE,
			proxyRecipe: {
				id: 'framescaper-native-prores-proxy-mov-v1', width: 960, height: 540,
			},
			output: OUTPUT,
			scratch: SCRATCH,
		},
	},
	{
		kind: 'ofx-scan',
		grant: {
			executable: { ...EXECUTABLE, role: 'ofx-scanner' },
			pluginBinary: {
				...EXECUTABLE,
				role: 'ofx-plugin',
				path: '/plugins/example.ofx.bundle/Contents/Linux-x86-64/example.ofx',
			},
			descriptor: OFX_DESCRIPTOR_RESERVATION,
			scratch: SCRATCH,
		},
	},
	{
		kind: 'ofx-host',
		grant: {
			executable: { ...EXECUTABLE, role: 'ofx-host' },
			pluginBinary: {
				...EXECUTABLE,
				role: 'ofx-plugin',
				path: '/plugins/example.ofx.bundle/Contents/Linux-x86-64/example.ofx',
			},
			invocation: OFX_INVOCATION,
			plan: PLAN,
			inputs: [{
				name: 'Source', sourceRef: 'source-1', ...OFX_FRAME_LAYOUT, frame: OFX_INPUT_FRAME,
			}],
			output: { ...OFX_FRAME_LAYOUT, frame: OFX_OUTPUT_RESERVATION },
			scratch: SCRATCH,
		},
	},
] as const);

function resourcePolicy(kind: (typeof MEDIA_JOBS)[number]['kind']) {
	return normalizeHelperResourcePolicy(undefined, kind);
}

test('helper contract v1 closes the six native media and OFX job families', () => {
	assert.deepEqual(HELPER_JOB_KINDS, [
		'probe-video-source',
		'audio-device',
		'plugin-scan',
		'plugin-host',
		'media-decode',
		'media-encode',
		'media-render',
		'media-proxy',
		'ofx-scan',
		'ofx-host',
		'assistance-speech',
	]);
	assert.equal((HELPER_JOB_KINDS as readonly string[]).includes('watch'), false,
		'watch reconciliation remains main-owned');
	for (const job of MEDIA_JOBS) {
		const admitted = validateHelperHostMessage({
			contractVersion: 1,
			type: 'job',
			jobId: JOB_ID,
			kind: job.kind,
			jobContractVersion: 1,
			grant: structuredClone(job.grant),
			resourcePolicy: resourcePolicy(job.kind),
		});
		assert.equal(admitted.type, 'job');
		assert.equal(admitted.type === 'job' ? admitted.kind : null, job.kind);
		const usage = helperJobGrantResourceUsage(job.kind, job.grant);
		assert.ok(usage.inputBytes > 0);
		assert.ok(usage.scratchBytes > 0);
		assert.ok(usage.dataPlaneBytes > 0);
	}
});

test('new job grants admit only exact executable, input, output, root, and scratch authority', () => {
	const encode = MEDIA_JOBS[1];
	for (const grant of [
		{ ...encode.grant, allowChildProcesses: true },
		{ ...encode.grant, executable: { ...EXECUTABLE, role: 'ofx-host' } },
		{ ...encode.grant, executable: { ...EXECUTABLE, sha256: 'A'.repeat(64) } },
		{ ...encode.grant, sources: [{ ...SOURCE, path: 'relative.mov' }] },
		{ ...encode.grant, sources: [{ ...SOURCE, sha256: 'A'.repeat(64) }] },
		{ ...encode.grant, output: { ...OUTPUT, temporaryPath: '/other/output.tmp' } },
		{ ...encode.grant, output: { ...OUTPUT, finalPath: '/exports/nested/movie.mov' } },
		{ ...encode.grant, scratch: { ...SCRATCH, reservationId: 'not-an-id' } },
		{ ...encode.grant, plan: { ...PLAN, direction: 'helper-to-host' } },
	]) {
		assert.throws(() => validateHelperHostMessage({
			contractVersion: 1,
			type: 'job',
			jobId: JOB_ID,
			kind: encode.kind,
			jobContractVersion: 1,
			grant,
			resourcePolicy: resourcePolicy(encode.kind),
		}), (error: unknown) => error instanceof HelperContractViolationError && error.code === 'unsafe-grant');
	}
});

test('OpenFX helper grants authenticate the invocation and exact named frame streams', () => {
	const host = MEDIA_JOBS[5];
	const wrongInput = Object.freeze(binding('host-to-helper', undefined, {
		streamId: 'ad'.repeat(20),
	}));
	for (const grant of [
		{ ...host.grant, pluginBinary: { ...host.grant.pluginBinary, sha256: '4'.repeat(64) } },
		{ ...host.grant, invocation: { ...OFX_INVOCATION, outputFrameStreamId: 'ae'.repeat(20) } },
		{ ...host.grant, inputs: [{ ...host.grant.inputs[0], frame: wrongInput }] },
		{ ...host.grant, inputs: [{ ...host.grant.inputs[0], name: 'Source/../../path' }] },
		{ ...host.grant, inputs: [{ ...host.grant.inputs[0], sourceRef: '/media/source.mov' }] },
		{ ...host.grant, inputs: [{ ...host.grant.inputs[0], width: 0 }] },
		{ ...host.grant, inputs: [{ ...host.grant.inputs[0], rowBytes: 3 }] },
		{ ...host.grant, inputs: [{ ...host.grant.inputs[0], height: 2 }] },
		{ ...host.grant, output: { ...host.grant.output, pixelFormat: 'bgra8' } },
		{ ...host.grant, output: { ...host.grant.output, rowBytes: 8 } },
		{ ...host.grant, output: {
			...host.grant.output, frame: { ...host.grant.output.frame, sha256: SHA256 },
		} },
		{ ...host.grant, plan: { ...PLAN, streamId: OFX_INPUT_FRAME.streamId } },
	]) {
		assert.throws(() => validateHelperHostMessage({
			contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'ofx-host', jobContractVersion: 1, grant,
			resourcePolicy: resourcePolicy('ofx-host'),
		}), (error: unknown) => error instanceof HelperContractViolationError
			&& error.code === 'unsafe-grant');
	}
});

test('image-sequence decode grants require exact per-input pack and inventory roles', () => {
	const pack = Object.freeze({
		...SOURCE, role: 'image-sequence-pack', path: '/media/sequence.pack',
		bytes: 4_096, sha256: '3'.repeat(64), identity: { dev: 4, ino: 23 },
	});
	const inventory = Object.freeze({
		...SOURCE, role: 'image-sequence-inventory', path: '/media/sequence.inventory.json',
		bytes: 1_024, sha256: '4'.repeat(64), identity: { dev: 4, ino: 24 },
	});
	const grant = {
		...MEDIA_JOBS[0].grant,
		sources: [pack, inventory],
		output: Object.freeze(outputReservation('bd'.repeat(20), 4_096)),
		imageSequence: IMAGE_SEQUENCE,
	};
	assert.deepEqual(validateHelperHostMessage({
		contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'media-decode', jobContractVersion: 1, grant,
		resourcePolicy: resourcePolicy('media-decode'),
	}).type, 'job');
	for (const sources of [
		[{ ...pack, role: 'original' }, inventory],
		[pack, { ...inventory, role: 'image-sequence-pack' }],
		[pack],
		[pack, { ...inventory, type: 'stream', binding: PLAN }],
	]) {
		assert.throws(() => validateHelperHostMessage({
			contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'media-decode', jobContractVersion: 1,
			grant: { ...grant, sources }, resourcePolicy: resourcePolicy('media-decode'),
		}), HelperContractViolationError);
	}
	assert.throws(() => validateHelperHostMessage({
		contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'media-decode', jobContractVersion: 1,
		grant: { ...MEDIA_JOBS[0].grant, sources: [pack] },
		resourcePolicy: resourcePolicy('media-decode'),
	}), HelperContractViolationError, 'pack roles cannot alias an ordinary decode');
	assert.throws(() => validateHelperHostMessage({
		contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'media-decode', jobContractVersion: 1,
		grant: { ...grant, imageSequence: { ...IMAGE_SEQUENCE, frameRate: { num: 48, den: 2 } } },
		resourcePolicy: resourcePolicy('media-decode'),
	}), HelperContractViolationError, 'the exact rational rate is canonical and reduced');
});

test('selected V20 media file grants admit one ordered RGBA carrier and staged mix only', () => {
	const carrier = Object.freeze({
		...SOURCE, role: 'evaluated-rgba-frame-pack', path: '/scratch/evaluated.frames',
		bytes: 8_192, sha256: '5'.repeat(64), identity: { dev: 4, ino: 25 },
	});
	const audio = Object.freeze({
		...SOURCE, role: 'staged-audio-mix', path: '/scratch/audio-mix.wav',
		bytes: 4_096, sha256: '6'.repeat(64), identity: { dev: 4, ino: 26 },
	});
	const render = MEDIA_JOBS[2];
	for (const sources of [[SOURCE, carrier], [SOURCE, carrier, audio], [SOURCE, audio]]) {
		assert.equal(validateHelperHostMessage({
			contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'media-render', jobContractVersion: 1,
			grant: { ...render.grant, sources }, resourcePolicy: resourcePolicy('media-render'),
		}).type, 'job');
	}
	assert.equal(validateHelperHostMessage({
		contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'media-render', jobContractVersion: 1,
		grant: { ...render.grant, backend: 'vaapi' }, resourcePolicy: resourcePolicy('media-render'),
	}).type, 'job');
	for (const backend of [undefined, 'web-core', 'd3d11va', 'nvdec']) {
		assert.throws(() => validateHelperHostMessage({
			contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'media-render', jobContractVersion: 1,
			grant: { ...render.grant, backend }, resourcePolicy: resourcePolicy('media-render'),
		}), HelperContractViolationError);
	}
	for (const sources of [
		[carrier, SOURCE], [SOURCE, carrier, carrier], [SOURCE, audio, carrier], [SOURCE, audio, audio],
	]) {
		assert.throws(() => validateHelperHostMessage({
			contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'media-render', jobContractVersion: 1,
			grant: { ...render.grant, sources }, resourcePolicy: resourcePolicy('media-render'),
		}), HelperContractViolationError);
	}
	assert.throws(() => validateHelperHostMessage({
		contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'media-decode', jobContractVersion: 1,
		grant: { ...MEDIA_JOBS[0].grant, sources: [carrier] },
		resourcePolicy: resourcePolicy('media-decode'),
	}), HelperContractViolationError);
});

test('new job resource policies are kind-specific, lower-only, and carry no broad authority', () => {
	for (const job of MEDIA_JOBS) {
		const policy = resourcePolicy(job.kind);
		const hard = HELPER_JOB_RESOURCE_HARD_LIMITS[job.kind];
		assert.equal(policy.maximumInputBytes, hard.maximumInputBytes);
		assert.equal(policy.maximumOutputBytes, hard.maximumOutputBytes);
		assert.equal(policy.maximumScratchBytes, hard.maximumScratchBytes);
		assert.equal(policy.maximumDataPlaneBytes, hard.maximumDataPlaneBytes);
		assert.equal(policy.maximumInFlightChunks, hard.maximumInFlightChunks);
		assert.equal(policy.allowNetwork, false);
		assert.equal(policy.allowChildProcesses, false);
		assert.equal(policy.allowOutputFiles, false);
	}
	assert.throws(() => normalizeHelperResourcePolicy({
		maximumOutputBytes: HELPER_JOB_RESOURCE_HARD_LIMITS['media-render'].maximumOutputBytes + 1,
	}, 'media-render'), RangeError);
	assert.throws(() => normalizeHelperResourcePolicy({
		maximumInFlightChunks: HELPER_DATA_IN_FLIGHT_CHUNKS_MAXIMUM + 1,
	}, 'media-render'), RangeError);
	assert.throws(() => normalizeHelperResourcePolicy({
		allowChildProcesses: true as false,
	}, 'media-render'), RangeError);
});

test('new job results are closed and correlated with their exact grants', () => {
	const completion = {
		streamId: STREAM_ID,
		byteLength: STREAM_OUTPUT.byteLength,
		sha256: STREAM_OUTPUT.sha256,
	};
	const reservedCompletion = { ...completion, sha256: '9'.repeat(64) };
	const file = {
		temporaryPath: OUTPUT.temporaryPath,
		byteLength: 3_000,
		sha256: '2'.repeat(64),
		identity: { dev: 4, ino: 22 },
	};
	const results = [
		{ output: completion },
		{ output: file },
		{ output: file },
		{ output: file },
		{ descriptor: reservedCompletion },
		{ output: reservedCompletion },
	] as const;
	for (const [index, job] of MEDIA_JOBS.entries()) {
		assert.deepEqual(validateHelperJobResult(job.kind, results[index], job.grant as never), results[index]);
		assert.throws(() => validateHelperJobResult(job.kind, {
			...results[index],
			extra: true,
		}, job.grant as never), HelperContractViolationError);
	}
	assert.throws(() => validateHelperJobResult('media-decode', {
		output: { ...completion, streamId: JOB_ID },
	}, MEDIA_JOBS[0].grant), HelperContractViolationError);
	assert.throws(() => validateHelperJobResult('media-encode', {
		output: { ...file, temporaryPath: OUTPUT.finalPath },
	}, MEDIA_JOBS[1].grant), HelperContractViolationError);
	assert.throws(() => validateHelperJobResult('media-proxy', {
		output: { ...file, byteLength: OUTPUT.maximumBytes + 1 },
	}, MEDIA_JOBS[3].grant), HelperContractViolationError);
});

test('OpenFX output reservations bind bounds before work and digest only completed bytes', () => {
	assert.deepEqual(
		validateHelperDataPlaneOutputReservation(OFX_OUTPUT_RESERVATION),
		OFX_OUTPUT_RESERVATION,
	);
	for (const candidate of [
		{ ...OFX_OUTPUT_RESERVATION, direction: 'host-to-helper' },
		{ ...OFX_OUTPUT_RESERVATION, sha256: SHA256 },
		{ ...OFX_OUTPUT_RESERVATION, exactByteLength: 5 },
		{ ...OFX_OUTPUT_RESERVATION, maximumByteLength: 3 },
	]) {
		assert.throws(
			() => validateHelperDataPlaneOutputReservation(candidate),
			HelperContractViolationError,
		);
	}
});

test('supervision enforces native resource use and mandatory correlated result admission', async () => {
	const encode = MEDIA_JOBS[1];
	const limited = createHarness({ kinds: [encode.kind] });
	await assert.rejects(limited.supervisor.runJob({
		kind: encode.kind,
		grant: encode.grant,
		resourcePolicy: { maximumOutputBytes: 1_024 },
		dataPlaneTransfers: PLAN_TRANSFER,
	}), (error: unknown) => supervisionCause(error) === 'resource-violation');
	assert.equal(limited.channels.length, 0, 'resource refusal must happen before a helper spawn');

	const harness = createHarness({ kinds: [encode.kind] });
	const job = harness.supervisor.runJob({
		kind: encode.kind, grant: encode.grant, dataPlaneTransfers: PLAN_TRANSFER,
	});
	await settled();
	const channel = harness.latest();
	const posted = channel.posted[0];
	assert.equal(posted.type, 'job');
	channel.receive({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'result',
		jobId: posted.type === 'job' ? posted.jobId : '',
		result: {
			output: {
				temporaryPath: OUTPUT.finalPath,
				byteLength: 100,
				sha256: '2'.repeat(64),
				identity: { dev: 4, ino: 22 },
			},
		},
	});
	await assert.rejects(job, (error: unknown) => supervisionCause(error) === 'malformed-message');
	assert.equal(channel.killed, 1);
});

test('the MessagePort data plane binds exact length and digest under sequence and backpressure', () => {
	const bytes = new Uint8Array([1, 2, 3, 4]);
	const admittedBinding = validateHelperDataPlaneBinding(binding('host-to-helper', bytes));
	const sender = new HelperDataPlaneSender(admittedBinding);
	const receiver = new HelperDataPlaneReceiver(admittedBinding);

	const first = sender.createChunk(bytes.subarray(0, 2));
	assert.equal(first.sequence, 0);
	assert.throws(() => sender.createChunk(bytes.subarray(2)), /backpressure/iu);
	const firstAck = receiver.acceptChunk(first);
	sender.acceptAck(firstAck);
	const second = sender.createChunk(bytes.subarray(2));
	assert.equal(second.sequence, 1);
	sender.acceptAck(receiver.acceptChunk(second));
	const complete = sender.complete();
	assert.deepEqual(receiver.acceptComplete(complete), {
		streamId: STREAM_ID,
		byteLength: bytes.byteLength,
		sha256: digest(bytes),
	});
});

test('the data plane rejects oversize, reordered, tampered, and post-cancellation traffic', () => {
	const bytes = new Uint8Array([1, 2, 3, 4]);
	const admittedBinding = validateHelperDataPlaneBinding(binding('host-to-helper', bytes));
	assert.equal(admittedBinding.maximumChunkBytes, 2);
	assert.equal(HELPER_DATA_CHUNK_MAXIMUM_BYTES, 16 * 1024 * 1024);
	assert.throws(() => validateHelperDataPlaneBinding({
		...admittedBinding,
		maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES + 1,
	}), HelperContractViolationError);
	assert.throws(() => validateHelperDataPlaneMessage({
		dataPlaneVersion: 1,
		type: 'chunk',
		streamId: STREAM_ID,
		sequence: 0,
		offset: 0,
		bytes: new Uint8Array(HELPER_DATA_CHUNK_MAXIMUM_BYTES + 1),
	}), (error: unknown) => error instanceof HelperContractViolationError && error.code === 'oversized');
	let accessorInvoked = false;
	const hostile = { dataPlaneVersion: 1, streamId: STREAM_ID };
	Object.defineProperty(hostile, 'type', {
		enumerable: true,
		get() {
			accessorInvoked = true;
			return 'cancel';
		},
	});
	assert.throws(() => validateHelperDataPlaneMessage(hostile), HelperContractViolationError);
	assert.equal(accessorInvoked, false);

	const sender = new HelperDataPlaneSender(admittedBinding);
	const receiver = new HelperDataPlaneReceiver(admittedBinding);
	const first = sender.createChunk(bytes.subarray(0, 2));
	assert.throws(() => receiver.acceptChunk({ ...first, sequence: 1 }), /sequence/iu);
	assert.throws(() => receiver.acceptChunk({ ...first, offset: 1 }), /offset/iu);
	receiver.acceptChunk(first);
	const cancel = sender.cancel('host-abort');
	receiver.acceptCancel(cancel);
	assert.throws(() => sender.createChunk(bytes.subarray(2)), /cancel/iu);
	assert.throws(() => receiver.acceptChunk({ ...first, sequence: 1, offset: 2 }), /cancel/iu);
	const remoteSender = new HelperDataPlaneSender(admittedBinding);
	const remoteReceiver = new HelperDataPlaneReceiver(admittedBinding);
	remoteSender.acceptCancel(remoteReceiver.cancel('helper-abort'));
	assert.throws(() => remoteSender.createChunk(bytes), /cancel/iu);

	const tamperedBinding = validateHelperDataPlaneBinding({
		...binding('host-to-helper', bytes),
		sha256: 'f'.repeat(64),
	});
	const tamperedSender = new HelperDataPlaneSender(tamperedBinding);
	const tamperedReceiver = new HelperDataPlaneReceiver(tamperedBinding);
	const a = tamperedSender.createChunk(bytes.subarray(0, 2));
	tamperedSender.acceptAck(tamperedReceiver.acceptChunk(a));
	const b = tamperedSender.createChunk(bytes.subarray(2));
	tamperedSender.acceptAck(tamperedReceiver.acceptChunk(b));
	assert.throws(() => tamperedSender.complete(), /digest/iu);
});
