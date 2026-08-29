/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { conformFfmpegVideoToCfr } from '../src/common/editor/ffmpeg-cfr-ingest.ts';

test('CFR fallback materializes new media bytes at the exact requested rational rate', async () => {
	const events: string[] = [];
	let args: readonly string[] = [];
	const output = await conformFfmpegVideoToCfr({
		file: new Blob([Uint8Array.of(1, 2, 3)], { type: 'video/webm' }),
		rate: { num: 30_000, den: 1_001 },
		workerFsType: () => 'WORKERFS',
		terminateRuntime() { events.push('terminate'); },
		async run(task) {
			return task({
				async createDir() { events.push('mkdir'); },
				async mount() { events.push('mount'); },
				async unmount() { events.push('unmount'); },
				async deleteDir() { events.push('rmdir'); },
				async writeFile() { throw new Error('whole input write'); },
				async readFile() { events.push('read'); return Uint8Array.of(9, 8, 7); },
				async deleteFile(path) { events.push(`delete:${path}`); },
				async exec(value) { args = value; events.push('exec'); return 0; },
			});
		},
	});

	assert.equal(output.type, 'video/mp4');
	assert.deepEqual([...new Uint8Array(await output.arrayBuffer())], [9, 8, 7]);
	assert.ok(args.includes('fps=fps=30000/1001'));
	assert.deepEqual(events.slice(0, 4), ['mkdir', 'mount', 'exec', 'read']);
	assert.ok(events.includes('unmount'));
	assert.ok(events.includes('rmdir'));
});

test('CFR fallback never publishes an empty or failed FFmpeg output', async () => {
	await assert.rejects(conformFfmpegVideoToCfr({
		file: new Blob(['video']),
		rate: { num: 25, den: 1 },
		workerFsType: () => null,
		terminateRuntime() {},
		async run(task) {
			return task({
				async createDir() {}, async mount() {}, async unmount() {}, async deleteDir() {},
				async writeFile() {}, async readFile() { return new Uint8Array(); }, async deleteFile() {},
				async exec() { return 0; },
			});
		},
	}), /no media bytes/iu);
});

test('CFR fallback refuses cancellation received while its runtime lease is queued', async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	let taskCalls = 0;
	let runtimeCalls = 0;
	let terminationCalls = 0;
	const controller = new AbortController();
	const reason = new DOMException('queued CFR cancelled', 'AbortError');
	const operation = conformFfmpegVideoToCfr({
		file: new Blob(['video']),
		rate: { num: 25, den: 1 },
		workerFsType: () => null,
		terminateRuntime() { terminationCalls += 1; },
		async run(task, beforeLoad) {
			await gate;
			beforeLoad?.();
			taskCalls += 1;
			return task({
				async createDir() { runtimeCalls += 1; }, async mount() { runtimeCalls += 1; },
				async unmount() { runtimeCalls += 1; }, async deleteDir() { runtimeCalls += 1; },
				async writeFile() { runtimeCalls += 1; },
				async readFile() { runtimeCalls += 1; return Uint8Array.of(1); },
				async deleteFile() { runtimeCalls += 1; }, async exec() { runtimeCalls += 1; return 0; },
			});
		},
		signal: controller.signal,
	});

	controller.abort(reason);
	release();
	await assert.rejects(operation, (error: unknown) => error === reason);
	assert.equal(taskCalls, 0, 'queued cancellation is refused before acquiring a runtime lease');
	assert.equal(runtimeCalls, 0);
	assert.equal(terminationCalls, 0, 'queued cancellation has no active runtime to terminate');
});
