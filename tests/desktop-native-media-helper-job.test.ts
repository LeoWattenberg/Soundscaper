/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { FramescaperMediaHostDescriptor } from '../desktop/framescaper-media-host-payload.ts';
import {
	receiveHelperDataPlaneFile,
	sendHelperDataPlaneFile,
	type HelperDataPlaneIoPort,
} from '../desktop/helper-data-plane-io.ts';
import type { HelperDataPlaneBinding } from '../desktop/helper-data-plane.ts';
import {
	createNativeMediaHelperJobRunner,
	nativeMediaHostArguments,
	type NativeMediaHostInvocation,
} from '../desktop/native-media-helper-job.ts';
import { canonicalizeNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { nativeQueueKeyedPlanV7 } from './helpers/native-queue-plan-fixture.ts';

const OUTPUT_BYTES = Buffer.from('encoded-output');

test('the CLI adapter emits only finalized closed arguments, with a role per source', () => {
	const invocation: NativeMediaHostInvocation = {
		executablePath: '/runtime/framescaper-media-host', operation: 'media-proxy',
		plan: { path: '/scratch/plan.json', sha256: '1'.repeat(64) },
		sources: [
			{ path: '/media/a.mov', sha256: '2'.repeat(64), byteLength: 2_048, role: 'original' },
			{ path: '/media/b.wav', sha256: '3'.repeat(64), byteLength: 1_024, role: 'original' },
		],
		backend: 'native-cpu', maximumOutputBytes: 4_096,
		scratchPath: '/scratch/job', decodeOutputPath: null,
		destinationRoot: '/output', temporaryOutputPath: '/output/.proxy.tmp',
		proxyRecipe: {
			id: 'framescaper-native-prores-proxy-mov-v1', width: 960, height: 540,
		},
		imageSequence: null,
	};
	assert.deepEqual(nativeMediaHostArguments(invocation), [
		'--operation', 'media-proxy',
		'--plan', '/scratch/plan.json', '--plan-sha256', '1'.repeat(64),
		'--source', '/media/a.mov', '--source-sha256', '2'.repeat(64),
		'--source-byte-length', '2048', '--source-role', 'original',
		'--source', '/media/b.wav', '--source-sha256', '3'.repeat(64),
		'--source-byte-length', '1024', '--source-role', 'original',
		'--backend', 'native-cpu',
		'--maximum-output-bytes', '4096', '--scratch', '/scratch/job',
		'--destination-root', '/output', '--temporary-output', '/output/.proxy.tmp',
		'--proxy-recipe', 'framescaper-native-prores-proxy-mov-v1',
		'--proxy-width', '960', '--proxy-height', '540',
	]);
	assert.deepEqual(nativeMediaHostArguments({
		...invocation, operation: 'probe-video-source', plan: null,
		sources: [invocation.sources[0]!],
		maximumOutputBytes: 0, scratchPath: null, destinationRoot: null,
		temporaryOutputPath: null, proxyRecipe: null, imageSequence: null,
	}), [
		'--operation', 'probe-video-source',
		'--source', '/media/a.mov', '--source-sha256', '2'.repeat(64),
	]);
	assert.deepEqual(nativeMediaHostArguments({
		...invocation, operation: 'media-decode',
		sources: [
			{ path: '/media/plate.pack', sha256: '4'.repeat(64), byteLength: 8_192, role: 'image-sequence-pack' },
			{ path: '/media/plate.inventory.json', sha256: '5'.repeat(64), byteLength: 2_048, role: 'image-sequence-inventory' },
		],
		decodeOutputPath: '/scratch/job/decoded-output.bin',
		destinationRoot: null, temporaryOutputPath: null, proxyRecipe: null,
		imageSequence: {
			kind: 'native-image-sequence-decode-v1',
			profileId: 'decode-png-sequence', frameRate: { num: 24_000, den: 1_001 },
		},
	}), [
		'--operation', 'media-decode',
		'--plan', '/scratch/plan.json', '--plan-sha256', '1'.repeat(64),
		'--source', '/media/plate.pack', '--source-sha256', '4'.repeat(64),
		'--source-byte-length', '8192', '--source-role', 'image-sequence-pack',
		'--source', '/media/plate.inventory.json', '--source-sha256', '5'.repeat(64),
		'--source-byte-length', '2048', '--source-role', 'image-sequence-inventory',
		'--backend', 'native-cpu', '--maximum-output-bytes', '4096',
		'--scratch', '/scratch/job', '--decode-output', '/scratch/job/decoded-output.bin',
		'--sequence-profile', 'decode-png-sequence',
		'--sequence-rate-num', '24000', '--sequence-rate-den', '1001',
	]);
});

test('the helper spools a canonical plan, verifies every identity/digest, and invokes only the closed host shape', async () => {
	const harness = await jobHarness();
	try {
		const outputRoot = join(harness.root, 'output');
		const scratchRoot = join(harness.root, 'scratch');
		await Promise.all([
			import('node:fs/promises').then(({ mkdir }) => mkdir(outputRoot)),
			import('node:fs/promises').then(({ mkdir }) => mkdir(scratchRoot)),
		]);
		const plan = planBinding(harness.planBytes);
		const [planHost, planHelper] = portPair();
		const outputPath = join(outputRoot, '.movie.framescaper.tmp');
		const invocations: NativeMediaHostInvocation[] = [];
		const runner = createNativeMediaHelperJobRunner({
			descriptor: harness.descriptor,
			invokeHost: (value) => {
				invocations.push(value);
				return processResult('media-render', writeFile(outputPath, OUTPUT_BYTES));
			},
		});
		const completion = runner.run({
			kind: 'media-render',
			grant: {
				executable: executableGrant(harness.descriptor), plan,
				sources: [await fileInput(harness.sourcePath)],
				output: {
					rootPath: outputRoot, rootIdentity: await identity(outputRoot),
					temporaryPath: outputPath, finalPath: join(outputRoot, 'movie.mov'),
					maximumBytes: 1_024,
				},
				scratch: {
					rootPath: scratchRoot, rootIdentity: await identity(scratchRoot),
					reservationId: 'ef'.repeat(20), maximumBytes: 4_096,
				},
			},
			ports: [planHelper],
		});
		const [result] = await Promise.all([
			completion.completion,
			sendHelperDataPlaneFile({ binding: plan, port: planHost, path: harness.planPath }),
		]);
		assert.deepEqual(result, {
			output: {
				temporaryPath: outputPath, byteLength: OUTPUT_BYTES.byteLength,
				sha256: digest(OUTPUT_BYTES), identity: await identity(outputPath),
			},
		});
		const admittedInvocation = invocations[0]!;
		assert.deepEqual({
			operation: admittedInvocation.operation,
			planSha256: admittedInvocation.plan?.sha256,
			sourceRoles: admittedInvocation.sources.map(({ role }) => role),
			backend: admittedInvocation.backend,
			maximumOutputBytes: admittedInvocation.maximumOutputBytes,
			destinationRoot: admittedInvocation.destinationRoot,
			temporaryOutputPath: admittedInvocation.temporaryOutputPath,
		}, {
			operation: 'media-render', planSha256: plan.sha256, sourceRoles: ['original'],
			backend: 'native-cpu', maximumOutputBytes: 1_024,
			destinationRoot: outputRoot, temporaryOutputPath: outputPath,
		});
		await assert.rejects(stat(join(scratchRoot, 'ef'.repeat(20))), /ENOENT/u);
	} finally {
		await harness.dispose();
	}
});

test('decode output is helper-spooled, exact-bound, and streamed over its transferred output port', async () => {
	const harness = await jobHarness();
	try {
		const scratchRoot = join(harness.root, 'scratch');
		await import('node:fs/promises').then(({ mkdir }) => mkdir(scratchRoot));
		const plan = planBinding(harness.planBytes);
		const output = dataBinding('helper-to-host', OUTPUT_BYTES);
		const [planHost, planHelper] = portPair();
		const [outputHost, outputHelper] = portPair();
		const receivedPath = join(harness.root, 'received.bin');
		let decodeOutputPath = '';
		const runner = createNativeMediaHelperJobRunner({
			descriptor: harness.descriptor,
			invokeHost: (invocation) => {
				decodeOutputPath = invocation.decodeOutputPath ?? '';
				return processResult('media-decode', writeFile(decodeOutputPath, OUTPUT_BYTES));
			},
		});
		const job = runner.run({
			kind: 'media-decode',
			grant: {
				executable: executableGrant(harness.descriptor), plan,
				sources: [await fileInput(harness.sourcePath)], output,
				scratch: {
					rootPath: scratchRoot, rootIdentity: await identity(scratchRoot),
					reservationId: 'cd'.repeat(20), maximumBytes: 4_096,
				},
			},
			ports: [planHelper, outputHelper],
		});
		const receive = receiveHelperDataPlaneFile({ binding: output, port: outputHost, path: receivedPath });
		const [jobResult, received] = await Promise.all([
			job.completion,
			receive,
			sendHelperDataPlaneFile({ binding: plan, port: planHost, path: harness.planPath }),
		]);
		assert.deepEqual(jobResult, { output: completion(output) });
		assert.deepEqual(received, completion(output));
		assert.deepEqual(await readFile(receivedPath), OUTPUT_BYTES);
		assert.match(decodeOutputPath, /cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd/u);
		await assert.rejects(stat(decodeOutputPath), /ENOENT/u);
	} finally {
		await harness.dispose();
	}
});

test('a changed source, swapped executable, wrong port count, or oversized scratch demand fails before execution', async () => {
	const harness = await jobHarness();
	try {
		const scratchRoot = join(harness.root, 'scratch');
		const outputRoot = join(harness.root, 'output');
		const { mkdir } = await import('node:fs/promises');
		await Promise.all([mkdir(scratchRoot), mkdir(outputRoot)]);
		let invocations = 0;
		const runner = createNativeMediaHelperJobRunner({
			descriptor: harness.descriptor,
			invokeHost: () => { invocations += 1; return processResult('media-render'); },
		});
		const plan = planBinding(harness.planBytes);
		const grant = {
			executable: executableGrant(harness.descriptor), plan,
			sources: [{ ...(await fileInput(harness.sourcePath)), sha256: '0'.repeat(64) }],
			output: {
				rootPath: outputRoot, rootIdentity: await identity(outputRoot),
				temporaryPath: join(outputRoot, '.bad.tmp'), finalPath: join(outputRoot, 'bad.mov'),
				maximumBytes: 1_024,
			},
			scratch: {
				rootPath: scratchRoot, rootIdentity: await identity(scratchRoot),
				reservationId: 'ab'.repeat(20), maximumBytes: 1,
			},
		};
		assert.throws(() => runner.run({ kind: 'media-render', grant, ports: [] }), /transferred MessagePort/u);
		const [, helper] = portPair();
		const job = runner.run({ kind: 'media-render', grant, ports: [helper] });
		await assert.rejects(job.completion, /scratch grant|digest/u);
		assert.equal(invocations, 0);
	} finally {
		await harness.dispose();
	}
});

test('a successful exit with a forged output digest is rejected and its temporary output is removed', async () => {
	const harness = await jobHarness();
	try {
		const outputRoot = join(harness.root, 'output');
		const scratchRoot = join(harness.root, 'scratch');
		const { mkdir } = await import('node:fs/promises');
		await Promise.all([mkdir(outputRoot), mkdir(scratchRoot)]);
		const outputPath = join(outputRoot, '.forged.tmp');
		const plan = planBinding(harness.planBytes);
		const [planHost, planHelper] = portPair();
		const runner = createNativeMediaHelperJobRunner({
			descriptor: harness.descriptor,
			invokeHost: () => processResult(
				'media-render', writeFile(outputPath, OUTPUT_BYTES), '0'.repeat(64),
			),
		});
		const job = runner.run({
			kind: 'media-render',
			grant: {
				executable: executableGrant(harness.descriptor), plan,
				sources: [await fileInput(harness.sourcePath)],
				output: {
					rootPath: outputRoot, rootIdentity: await identity(outputRoot),
					temporaryPath: outputPath, finalPath: join(outputRoot, 'forged.mov'),
					maximumBytes: 1_024,
				},
				scratch: {
					rootPath: scratchRoot, rootIdentity: await identity(scratchRoot),
					reservationId: 'bc'.repeat(20), maximumBytes: 4_096,
				},
			},
			ports: [planHelper],
		});
		await assert.rejects(Promise.all([
			job.completion,
			sendHelperDataPlaneFile({ binding: plan, port: planHost, path: harness.planPath }),
		]), /does not match the independently inspected output/u);
		await assert.rejects(stat(outputPath), /ENOENT/u);
	} finally {
		await harness.dispose();
	}
});

test('a proxy control result cannot substitute geometry outside its authenticated recipe grant', async () => {
	const harness = await jobHarness();
	try {
		const outputRoot = join(harness.root, 'output');
		const scratchRoot = join(harness.root, 'scratch');
		const { mkdir } = await import('node:fs/promises');
		await Promise.all([mkdir(outputRoot), mkdir(scratchRoot)]);
		const outputPath = join(outputRoot, '.proxy.tmp');
		const plan = planBinding(harness.planBytes);
		const [planHost, planHelper] = portPair();
		const runner = createNativeMediaHelperJobRunner({
			descriptor: harness.descriptor,
			invokeHost: () => proxyProcessResult(writeFile(outputPath, OUTPUT_BYTES), 1_280, 720),
		});
		const job = runner.run({
			kind: 'media-proxy',
			grant: {
				executable: executableGrant(harness.descriptor), plan,
				source: await fileInput(harness.sourcePath),
				proxyRecipe: {
					id: 'framescaper-native-prores-proxy-mov-v1', width: 960, height: 540,
				},
				output: {
					rootPath: outputRoot, rootIdentity: await identity(outputRoot),
					temporaryPath: outputPath, finalPath: join(outputRoot, 'proxy.mov'),
					maximumBytes: 1_024,
				},
				scratch: {
					rootPath: scratchRoot, rootIdentity: await identity(scratchRoot),
					reservationId: 'bd'.repeat(20), maximumBytes: 4_096,
				},
			},
			ports: [planHelper],
		});
		await assert.rejects(Promise.all([
			job.completion,
			sendHelperDataPlaneFile({ binding: plan, port: planHost, path: harness.planPath }),
		]), /does not match its exact granted geometry/u);
		await assert.rejects(stat(outputPath), /ENOENT/u);
	} finally {
		await harness.dispose();
	}
});

async function jobHarness() {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-media-job-'));
	const executablePath = join(root, 'framescaper-media-host');
	const sourcePath = join(root, 'source.mov');
	const planPath = join(root, 'plan.json');
	const executableBytes = Buffer.from('synthetic executable');
	const sourceBytes = Buffer.from('source media');
	const planBytes = Buffer.from(canonicalizeNativeMediaPlan(nativeQueueKeyedPlanV7()));
	await Promise.all([
		writeFile(executablePath, executableBytes, { mode: 0o700 }),
		writeFile(sourcePath, sourceBytes),
		writeFile(planPath, planBytes),
	]);
	const executableIdentity = await identity(executablePath);
	const descriptor: FramescaperMediaHostDescriptor = Object.freeze({
		target: 'linux-x64', runtime: 'linux-x64', path: executablePath,
		byteLength: executableBytes.byteLength, sha256: digest(executableBytes),
		hostVersion: '1.0.0', ffmpegVersion: '9.0.1', identity: executableIdentity,
	});
	return {
		root, descriptor, sourcePath, planPath, planBytes,
		dispose: () => rm(root, { recursive: true, force: true }),
	};
}

function executableGrant(descriptor: FramescaperMediaHostDescriptor) {
	return {
		role: 'ffmpeg' as const, path: descriptor.path, bytes: descriptor.byteLength,
		sha256: descriptor.sha256, identity: descriptor.identity,
	};
}

async function fileInput(path: string) {
	const bytes = await readFile(path);
	return {
		type: 'file' as const, role: 'original' as const, path, bytes: bytes.byteLength,
		sha256: digest(bytes), identity: await identity(path),
	};
}

function planBinding(bytes: Uint8Array): HelperDataPlaneBinding {
	return dataBinding('host-to-helper', bytes, '12'.repeat(20));
}

function dataBinding(
	direction: HelperDataPlaneBinding['direction'],
	bytes: Uint8Array,
	streamId = '34'.repeat(20),
): HelperDataPlaneBinding {
	return Object.freeze({
		dataPlaneVersion: 1, transport: 'message-port', streamId, direction,
		byteLength: bytes.byteLength, sha256: digest(bytes),
		maximumChunkBytes: 7, maximumInFlightChunks: 2,
	});
}

function completion(binding: HelperDataPlaneBinding) {
	return { streamId: binding.streamId, byteLength: binding.byteLength, sha256: binding.sha256 };
}

async function identity(path: string) {
	const details = await stat(path);
	return Object.freeze({ dev: details.dev, ino: details.ino });
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function processResult(
	operation: 'media-decode' | 'media-render',
	before: Promise<unknown> = Promise.resolve(),
	sha256 = digest(OUTPUT_BYTES),
) {
	const output = operation === 'media-decode'
		? {
			contractVersion: 1, operation, framePack: 'framescaper-rgba-frame-pack-v1',
			frameCount: 1, width: 2, height: 2,
			byteLength: OUTPUT_BYTES.byteLength, sha256,
		}
		: {
			contractVersion: 1, operation,
			byteLength: OUTPUT_BYTES.byteLength, sha256,
		};
	return {
		completion: before.then(() => ({ exitCode: 0, stdout: JSON.stringify(output), stderr: '' })),
		cancel: async () => undefined,
	};
}

function proxyProcessResult(before: Promise<unknown>, width: number, height: number) {
	return {
		completion: before.then(() => ({
			exitCode: 0,
			stdout: JSON.stringify({
				contractVersion: 1, operation: 'media-proxy', container: 'mov',
				codec: 'prores_ks', profile: 'proxy', width, height,
				exportAuthority: 'original', byteLength: OUTPUT_BYTES.byteLength,
				sha256: digest(OUTPUT_BYTES),
			}),
			stderr: '',
		})),
		cancel: async () => undefined,
	};
}

class Port extends EventEmitter implements HelperDataPlaneIoPort {
	peer: Port | null = null;
	readonly pending: unknown[] = [];
	started = false;
	postMessage(message: unknown): void { queueMicrotask(() => this.peer?.accept(message)); }
	start(): void {
		this.started = true;
		for (const message of this.pending.splice(0)) this.emit('message', { data: message });
	}
	close(): void {}
	accept(message: unknown): void {
		if (!this.started) this.pending.push(message);
		else this.emit('message', { data: message });
	}
}

function portPair(): readonly [Port, Port] {
	const left = new Port();
	const right = new Port();
	left.peer = right;
	right.peer = left;
	return [left, right] as const;
}
