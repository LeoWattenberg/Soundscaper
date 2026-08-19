/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	runFfmpegMediaFileOperation,
	type FfmpegMediaFileLease,
} from '../src/common/editor/ffmpeg-media-file-operation.ts';

function createHost(options: { execLogs?: readonly (readonly string[])[] } = {}) {
	const files = new Map<string, Uint8Array | string>();
	const calls: string[] = [];
	let terminated = 0;
	let listener: ((entry: { message?: string }) => void) | null = null;
	let execIndex = 0;
	const instance = {
		async writeFile(path: string, data: Uint8Array | string) { files.set(path, data); calls.push(`write:${path}`); },
		async readFile(path: string) {
			calls.push(`read:${path}`);
			const value = files.get(path);
			if (value === undefined) throw new Error(`missing ${path}`);
			return typeof value === 'string' ? new TextEncoder().encode(value) : value;
		},
		async deleteFile(path: string) { files.delete(path); calls.push(`delete:${path}`); },
		async exec(args: readonly string[]) {
			calls.push(`exec:${args.join(' ')}`);
			for (const line of options.execLogs?.[execIndex] ?? []) listener?.({ message: line });
			execIndex += 1;
			return 0;
		},
		on(_event: string, handler: (entry: { message?: string }) => void) { listener = handler; },
		off() { listener = null; },
	};
	return {
		files, calls,
		terminatedCount: () => terminated,
		hasListener: () => listener !== null,
		host: {
			run: <Output>(operation: (value: never) => Output | PromiseLike<Output>) => (
				Promise.resolve(operation(instance as never))
			),
			terminateRuntime: () => { terminated += 1; },
		},
	};
}

test('each exec answers with only what it printed', async () => {
	// A caller parsing a keyframe index must not read an earlier run's output as
	// its own; the probe pass and the cut pass both log, and they log alike.
	const harness = createHost({ execLogs: [['first a', 'first b'], ['second a']] });
	const seen = await runFfmpegMediaFileOperation(harness.host, async (lease: FfmpegMediaFileLease) => {
		const one = await lease.exec(['-i', 'a']);
		const two = await lease.exec(['-i', 'b']);
		return [one, two];
	});

	assert.deepEqual(seen[0]!.logs, ['first a', 'first b']);
	assert.deepEqual(seen[1]!.logs, ['second a'], 'the second exec does not inherit the first run’s lines');
	assert.equal(seen[0]!.exitCode, 0);
});

test('written paths are distinct, readable, and the caller deletes its own', async () => {
	const harness = createHost();
	const paths = await runFfmpegMediaFileOperation(harness.host, async (lease) => {
		const first = await lease.writeInput(Uint8Array.of(1, 2, 3));
		const second = await lease.writeInput(Uint8Array.of(4));
		await lease.writeText('list.txt', 'file first\n');
		assert.deepEqual(await lease.readOutput(first), Uint8Array.of(1, 2, 3));
		await lease.deletePath(second);
		return [first, second];
	});

	assert.notEqual(paths[0], paths[1], 'two writes never collide');
	// Nothing is swept up on the way out: the caller that wrote the parts knows
	// their names and the order to remove them in.
	assert.equal(harness.files.has(paths[0]!), true);
	assert.equal(harness.files.has(paths[1]!), false);
	assert.equal(harness.files.has('list.txt'), true);
});

test('the log listener is released however the operation ends', async () => {
	const harness = createHost();
	await runFfmpegMediaFileOperation(harness.host, async () => undefined);
	assert.equal(harness.hasListener(), false);

	await assert.rejects(
		runFfmpegMediaFileOperation(harness.host, async () => { throw new Error('boom'); }),
		/boom/,
	);
	assert.equal(harness.hasListener(), false, 'a failed operation must not leave a listener behind');
});

test('an abort takes the runtime away rather than merely rejecting', async () => {
	// An exec that has already started cannot be called back, so a half-run
	// FFmpeg would hold the lease and block everything queued behind it.
	const harness = createHost();
	const controller = new AbortController();
	await runFfmpegMediaFileOperation(harness.host, async () => {
		controller.abort();
	}, { signal: controller.signal });
	assert.equal(harness.terminatedCount(), 1);

	// And an operation handed an already-aborted signal never starts at all.
	const already = new AbortController();
	already.abort();
	await assert.rejects(
		runFfmpegMediaFileOperation(harness.host, async () => 'ran', { signal: already.signal }),
		(error: Error) => error.name === 'AbortError',
	);
});
