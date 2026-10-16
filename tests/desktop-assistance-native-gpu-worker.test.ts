/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createAssistanceLlamaCppWorkerSpawnerV1,
	type AssistanceLlamaCppSpawn,
} from '../desktop/assistance-llama-cpp-worker.ts';
import {
	createAssistanceWhisperCppWorkerSpawnerV1,
	type AssistanceWhisperCppSpawn,
} from '../desktop/assistance-whisper-cpp-worker.ts';
import {
	NativeGpuTestChild,
	nativeGpuWorkerFixture,
	VULKAN_TARGETS,
	type NativeFamily,
} from './helpers/desktop-assistance-native-gpu-worker-fixture.ts';

const FAMILIES = ['whisper-cpp', 'llama-cpp'] as const;

function workerSpawner(family: NativeFamily, spawn: AssistanceLlamaCppSpawn | AssistanceWhisperCppSpawn) {
	return family === 'whisper-cpp'
		? createAssistanceWhisperCppWorkerSpawnerV1({ spawn: spawn as AssistanceWhisperCppSpawn, terminationGraceMs: 5 })
		: createAssistanceLlamaCppWorkerSpawnerV1({ spawn: spawn as AssistanceLlamaCppSpawn });
}

for (const family of FAMILIES) {
	for (const target of VULKAN_TARGETS) {
		test(`${family} selects its authenticated Vulkan companion on ${target}`, async (context) => {
			const fixture = await nativeGpuWorkerFixture(context, family, target);
			const seen: Array<{ executable: string; args: readonly string[] }> = [];
			const spawn: AssistanceLlamaCppSpawn = (executable, args) => {
				seen.push({ executable, args });
				const child = new NativeGpuTestChild();
				queueMicrotask(() => { child.stdout.end(fixture.body); child.emit('close', 0, null); });
				return child;
			};
			await workerSpawner(family, spawn)(fixture.job, { onProgress: () => undefined }).completion;
			assert.equal(seen.length, 1);
			assert.equal(seen[0]!.executable, fixture.companion);
			assert.equal(seen[0]!.args.includes('--no-gpu'), false);
			assert.equal(seen[0]!.args.includes('--device'), false);
			assert.ok((await readFile(fixture.output)).byteLength > 0);
		});
	}

	test(`${family} retries the CPU executable after the Vulkan device process exits`, async (context) => {
		const fixture = await nativeGpuWorkerFixture(context, family);
		const seen: Array<{ executable: string; args: readonly string[] }> = [];
		let gpuClosed = false;
		const spawn: AssistanceLlamaCppSpawn = (executable, args) => {
			if (seen.length > 0) assert.equal(gpuClosed, true);
			seen.push({ executable, args });
			const child = new NativeGpuTestChild();
			const gpu = seen.length === 1;
			queueMicrotask(() => {
				child.stdout.end(gpu ? 'discarded GPU partial output' : fixture.body);
				if (gpu) gpuClosed = true;
				child.emit('close', gpu ? 1 : 0, null);
			});
			return child;
		};
		await workerSpawner(family, spawn)(fixture.job, { onProgress: () => undefined }).completion;
		assert.deepEqual(seen.map(({ executable }) => executable), [fixture.companion, fixture.job.descriptor.entrypoint]);
		assert.equal(seen[1]!.args.includes(family === 'whisper-cpp' ? '--no-gpu' : '--device'), true);
	});

	for (const code of ['ENOENT', 'ELIBBAD']) {
		for (const event of ['throw', 'error'] as const) {
			test(`${family} safely retries CPU when the Vulkan OS loader reports ${code} through ${event}`, async (context) => {
				const fixture = await nativeGpuWorkerFixture(context, family);
				const seen: string[] = [];
				const spawn: AssistanceLlamaCppSpawn = (executable) => {
					seen.push(executable);
					const child = new NativeGpuTestChild();
					if (seen.length === 1) {
						const error = Object.assign(new Error('OS loader failed'), { code });
						if (event === 'throw') throw error;
						queueMicrotask(() => { child.emit('error', error); child.emit('close', -1, null); });
					} else {
						queueMicrotask(() => { child.stdout.end(fixture.body); child.emit('close', 0, null); });
					}
					return child;
				};
				await workerSpawner(family, spawn)(fixture.job, { onProgress: () => undefined }).completion;
				assert.deepEqual(seen, [fixture.companion, fixture.job.descriptor.entrypoint]);
			});
		}
	}

	for (const code of ['EACCES', 'EIO', undefined]) {
		for (const event of ['throw', 'error'] as const) {
			test(`${family} preserves unexpected Vulkan spawn failure (${code ?? 'unknown'}, ${event})`, async (context) => {
				const fixture = await nativeGpuWorkerFixture(context, family);
				let starts = 0;
				const spawn: AssistanceLlamaCppSpawn = () => {
					starts += 1;
					const error = Object.assign(new Error('unexpected spawn failure'), { code });
					if (event === 'throw') throw error;
					const child = new NativeGpuTestChild();
					queueMicrotask(() => { child.emit('error', error); child.emit('close', -1, null); });
					return child;
				};
				await assert.rejects(workerSpawner(family, spawn)(fixture.job, {
					onProgress: () => undefined,
				}).completion, /could not be started|failed to execute/iu);
				assert.equal(starts, 1);
				assert.equal((await readFile(fixture.output)).byteLength, 0);
			});
		}
	}

	test(`${family} never retries output validation and bound failures on CPU`, async (context) => {
		for (const body of ['{invalid JSON', 'x'.repeat(64 * 1024 + 1)]) {
			const fixture = await nativeGpuWorkerFixture(context, family);
			let starts = 0;
			const spawn: AssistanceLlamaCppSpawn = () => {
				starts += 1;
				const child = new NativeGpuTestChild();
				queueMicrotask(() => { child.stdout.end(body); child.emit('close', 0, null); });
				return child;
			};
			await assert.rejects(workerSpawner(family, spawn)(fixture.job, {
				onProgress: () => undefined,
			}).completion, /malformed.*JSON|failed closed review|output bound/iu);
			assert.equal(starts, 1);
			assert.equal((await readFile(fixture.output)).byteLength, 0);
		}
	});

	test(`${family} authenticates input bytes before starting a Vulkan process`, async (context) => {
		const fixture = await nativeGpuWorkerFixture(context, family);
		const grant = fixture.job.grant;
		const job = { ...fixture.job, grant: { ...grant,
			inputs: grant.inputs.map((input) => ({ ...input, sha256: '9'.repeat(64) })) } };
		let starts = 0;
		const spawn: AssistanceLlamaCppSpawn = () => { starts += 1; return new NativeGpuTestChild(); };
		await assert.rejects(workerSpawner(family, spawn)(job, { onProgress: () => undefined }).completion);
		assert.equal(starts, 0);
	});

	test(`${family} cancellation of the Vulkan companion never retries on CPU`, async (context) => {
		const fixture = await nativeGpuWorkerFixture(context, family);
		let started: (() => void) | undefined;
		const startedPromise = new Promise<void>((resolve) => { started = resolve; });
		const children: NativeGpuTestChild[] = [];
		const spawn: AssistanceLlamaCppSpawn = () => {
			const child = new NativeGpuTestChild();
			children.push(child);
			started?.();
			return child;
		};
		const worker = workerSpawner(family, spawn)(fixture.job, { onProgress: () => undefined });
		await startedPromise;
		await worker.terminate();
		await assert.rejects(worker.completion, /abort|terminated|cancel/iu);
		assert.equal(children.length, 1);
		assert.deepEqual(children[0]!.signals, ['SIGTERM']);
	});

	test(`${family} never overlaps a Vulkan child needing SIGKILL with CPU fallback`, async (context) => {
		const fixture = await nativeGpuWorkerFixture(context, family);
		let starts = 0;
		let gpuClosed = false;
		const signals: NodeJS.Signals[] = [];
		const spawn: AssistanceLlamaCppSpawn = () => {
			starts += 1;
			const child = new NativeGpuTestChild();
			if (starts === 1) {
				child.kill = (signal: NodeJS.Signals = 'SIGTERM') => {
					signals.push(signal);
					assert.equal(starts, 1);
					if (signal === 'SIGKILL') queueMicrotask(() => {
						assert.equal(starts, 1);
						gpuClosed = true;
						child.emit('close', null, signal);
					});
					return true;
				};
				queueMicrotask(() => child.emit('error', Object.assign(new Error('loader failed'), { code: 'ELIBBAD' })));
			} else {
				assert.equal(gpuClosed, true);
				queueMicrotask(() => { child.stdout.end(fixture.body); child.emit('close', 0, null); });
			}
			return child;
		};
		const worker = workerSpawner(family, spawn)(fixture.job, { onProgress: () => undefined });
		if (family === 'whisper-cpp') {
			await assert.rejects(worker.completion, /force-terminated without an observed exit/iu);
			assert.equal(starts, 1);
		} else {
			await worker.completion;
			assert.equal(starts, 2);
		}
		assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
	});
}
