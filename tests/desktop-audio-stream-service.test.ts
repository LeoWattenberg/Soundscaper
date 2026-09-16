/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopAudioStreamService } from '../desktop/desktop-audio-stream-service.ts';
import type { DesktopAudioStreamPlan } from '../desktop/desktop-audio-stream-contract.ts';

const plan: DesktopAudioStreamPlan = { schemaVersion: 1, frameCount: 12,
	tuple: { operation: 'audio-encode', format: 'mp3', sampleRate: 48_000, channelCount: 2,
		settings: { bitrateKbps: 192 } }, maximumOutputBytes: 1000 };

test('desktop stream service stages bounded PCM and returns bounded file ranges with owner fencing', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'audio-stream-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const owner = {}; const other = {};
	const service = createDesktopAudioStreamService({ scratchRoot: root,
		capabilities: async (query) => ({ schemaVersion: 2, capabilities: query.operations.map((tuple) => ({
			...tuple, available: true, provider: 'bundled', reason: null })) }),
		execute: async (job) => { await writeFile(job.outputPath, new Uint8Array([1, 2, 3, 4]), { flag: 'wx' }); return 4; } });
	context.after(() => service.dispose());
	const begun = await service.command(owner, { type: 'begin', plan }) as { operationId: string };
	await assert.rejects(() => service.command(other, { type: 'stat', ...begun }), /owner/u);
	await assert.rejects(() => service.command(owner, { type: 'write', ...begun, offset: 1, bytes: new Uint8Array(8) }), /offset/u);
	await assert.rejects(() => service.command(owner, { type: 'execute', ...begun }), /complete/u);
	assert.deepEqual(await service.command(owner, { type: 'write', ...begun, offset: 0, bytes: new Uint8Array(96) }), { offset: 96 });
	assert.deepEqual(await service.command(owner, { type: 'execute', ...begun }), { byteLength: 4 });
	assert.deepEqual(await service.command(owner, { type: 'read', ...begun, offset: 1, maximumBytes: 2 }), new Uint8Array([2, 3]));
	assert.deepEqual(await service.command(owner, { type: 'stat', ...begun }), { byteLength: 4 });
	assert.equal(await service.command(owner, { type: 'delete', ...begun }), true);
});

test('desktop stream service rejects oversized work and unsupported provider selection before staging', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'audio-stream-bounds-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const service = createDesktopAudioStreamService({ scratchRoot: root,
		capabilities: async (query) => ({ schemaVersion: 2, capabilities: query.operations.map((tuple) => ({
			...tuple, available: true, provider: 'operating-system', reason: null })) }),
		execute: async () => { throw new Error('must not execute'); } });
	context.after(() => service.dispose());
	await assert.rejects(() => service.command({}, { type: 'begin', plan: { ...plan, frameCount: 3600 * 48000 + 1 } }), /bound/u);
	await assert.rejects(() => service.command({}, { type: 'begin', plan }), /bundled/u);
});

test('native scratch admission reserves exact PCM plus encoded maximum before creating a session', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'audio-stream-quota-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	let capabilities = 0;
	const service = createDesktopAudioStreamService({ scratchRoot: root, availableScratchBytes: async () => 1095n,
		capabilities: async (query) => { capabilities++; return { schemaVersion: 2, capabilities: query.operations.map((tuple) => ({
			...tuple, available: true, provider: 'bundled', reason: null })) }; }, execute: async () => 1 });
	context.after(() => service.dispose());
	await assert.rejects(() => service.command({}, { type: 'begin', plan }), /scratch storage/u);
	assert.equal(capabilities, 0);
});

function deferred<Value>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; }); return { promise, resolve };
}
const nextTurn = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

test('owner revocation during free-space admission prevents late session publication', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'audio-stream-begin-race-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const admission = deferred<bigint>(); const owner = {};
	const service = createDesktopAudioStreamService({ scratchRoot: root, availableScratchBytes: () => admission.promise,
		capabilities: async (query) => ({ schemaVersion: 2, capabilities: query.operations.map((tuple) => ({
			...tuple, available: true, provider: 'bundled', reason: null })) }), execute: async () => 1 });
	context.after(() => service.dispose());
	const beginning = service.command(owner, { type: 'begin', plan }); void beginning.catch(() => undefined);
	assert.equal(await service.revokeOwner(owner), false); admission.resolve(1096n);
	await assert.rejects(beginning, /owner stopped/u);
});

test('pending beginnings reserve capacity and deleted sessions release their scratch reservation', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'audio-stream-capacity-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const admission = deferred<bigint>(); const owners = [{}, {}, {}];
	const service = createDesktopAudioStreamService({ scratchRoot: root, availableScratchBytes: () => admission.promise,
		capabilities: async (query) => ({ schemaVersion: 2, capabilities: query.operations.map((tuple) => ({
			...tuple, available: true, provider: 'bundled', reason: null })) }), execute: async () => 1 });
	context.after(() => service.dispose());
	const first = service.command(owners[0]!, { type: 'begin', plan }); const second = service.command(owners[1]!, { type: 'begin', plan });
	await assert.rejects(() => service.command(owners[2]!, { type: 'begin', plan }), /session limit/u);
	admission.resolve(2192n); await Promise.all([first, second]);
	assert.equal(await service.revokeOwner(owners[0]!), true);
	assert.ok(await service.command(owners[2]!, { type: 'begin', plan }));
});

test('status reports monotonic utility frames while owner cleanup waits in-flight execution', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'audio-stream-progress-cleanup-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const entered = deferred<void>(); const exited = deferred<void>(); const owner = {};
	let aborted = false;
	const service = createDesktopAudioStreamService({ scratchRoot: root,
		capabilities: async (query) => ({ schemaVersion: 2, capabilities: query.operations.map((tuple) => ({
			...tuple, available: true, provider: 'bundled', reason: null })) }),
		execute: async (_job, signal, onProgress) => {
			onProgress?.(6); onProgress?.(3); entered.resolve();
			signal.addEventListener('abort', () => { aborted = true; }, { once: true });
			await exited.promise; if (signal.aborted) throw signal.reason; return 1;
		} });
	context.after(() => service.dispose());
	const begun = await service.command(owner, { type: 'begin', plan }) as { operationId: string };
	await service.command(owner, { type: 'write', ...begun, offset: 0, bytes: new Uint8Array(96) });
	const execution = service.command(owner, { type: 'execute', ...begun }); void execution.catch(() => undefined); await entered.promise;
	assert.deepEqual(await service.command(owner, { type: 'status', ...begun }), { frames: 6, frameCount: 12 });
	let cleaned = false; const cleanup = service.revokeOwner(owner).then((result) => { cleaned = true; return result; });
	await nextTurn(); assert.equal(aborted, true); assert.equal(cleaned, false);
	exited.resolve(); assert.equal(await cleanup, true); await assert.rejects(execution, /session stopped/u);
});

test('delete fences new commands immediately while the executing child still owns scratch', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'audio-stream-delete-fence-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const entered = deferred<void>(); const exited = deferred<void>(); const owner = {}; let removals = 0;
	const service = createDesktopAudioStreamService({ scratchRoot: root,
		capabilities: async (query) => ({ schemaVersion: 2, capabilities: query.operations.map((tuple) => ({
			...tuple, available: true, provider: 'bundled', reason: null })) }),
		removeScratch: async (directory) => { removals++; await rm(directory, { recursive: true, force: true }); },
		execute: async (_job, signal) => { entered.resolve(); await exited.promise; throw signal.reason; } });
	context.after(() => service.dispose());
	const begun = await service.command(owner, { type: 'begin', plan }) as { operationId: string };
	await service.command(owner, { type: 'write', ...begun, offset: 0, bytes: new Uint8Array(96) });
	const execution = service.command(owner, { type: 'execute', ...begun }); void execution.catch(() => undefined); await entered.promise;
	const deletion = service.command(owner, { type: 'delete', ...begun });
	await assert.rejects(() => service.command(owner, { type: 'status', ...begun }), /session stopped/u);
	await assert.rejects(() => service.command(owner, { type: 'write', ...begun, offset: 96, bytes: new Uint8Array(1) }), /session stopped/u);
	assert.equal(removals, 0); exited.resolve(); await assert.rejects(execution, /session stopped/u);
	assert.equal(await deletion, true); assert.equal(removals, 1);
});

test('failed scratch deletion retains capacity and quota until cleanup succeeds on retry', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'audio-stream-delete-retry-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const owner = {}; const cleanupError = new Error('scratch removal failed'); let failRemoval = true;
	const service = createDesktopAudioStreamService({ scratchRoot: root, availableScratchBytes: async () => 1096n,
		capabilities: async (query) => ({ schemaVersion: 2, capabilities: query.operations.map((tuple) => ({
			...tuple, available: true, provider: 'bundled', reason: null })) }), execute: async () => 1,
		removeScratch: async (directory) => { if (failRemoval) throw cleanupError; await rm(directory, { recursive: true, force: true }); } });
	context.after(() => service.dispose());
	const begun = await service.command(owner, { type: 'begin', plan }) as { operationId: string };
	await assert.rejects(() => service.command(owner, { type: 'delete', ...begun }), (error: unknown) => error instanceof AggregateError && error.cause === cleanupError);
	await assert.rejects(() => service.command(owner, { type: 'status', ...begun }), /session stopped/u);
	await assert.rejects(() => service.command({}, { type: 'begin', plan }), /scratch storage/u);
	failRemoval = false; assert.equal(await service.command(owner, { type: 'delete', ...begun }), true);
	assert.ok(await service.command({}, { type: 'begin', plan }));
});

test('service disposal waits every cleanup after one failure and can retry retained scratch', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'audio-stream-dispose-all-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const secondCleanup = deferred<void>(); const entered = deferred<void>(); const cleanupError = new Error('first scratch removal failed'); let attempts = 0; let settled = false;
	const service = createDesktopAudioStreamService({ scratchRoot: root,
		capabilities: async (query) => ({ schemaVersion: 2, capabilities: query.operations.map((tuple) => ({
			...tuple, available: true, provider: 'bundled', reason: null })) }), execute: async () => 1,
		removeScratch: async (directory) => {
			attempts++; if (attempts === 1) throw cleanupError;
			if (attempts === 2) { entered.resolve(); await secondCleanup.promise; }
			await rm(directory, { recursive: true, force: true });
		} });
	context.after(() => service.dispose());
	await service.command({}, { type: 'begin', plan }); await service.command({}, { type: 'begin', plan });
	const disposing = service.dispose(); void disposing.catch(() => { settled = true; });
	await entered.promise; await nextTurn(); try { assert.equal(settled, false); } finally { secondCleanup.resolve(); }
	await assert.rejects(disposing, (error: unknown) => error instanceof AggregateError);
	await service.dispose(); assert.equal(attempts, 3);
});
