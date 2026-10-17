/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { OpfsSyncWorkerRuntime } from '../src/common/editor/storage/opfs-sync-worker-runtime.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const OPTIONS = { concurrency: false, timeout: 5_000 };
const SHARED = 'light-original.blob', OTHER = 'light-mask.blob';
const ORIGINAL = Uint8Array.of(8, 3, 7, 2), MASK = Uint8Array.of(1, 0, 1);
type Outcome = { readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false; readonly error: unknown };
type Work = Promise<Outcome>;
type HoldKind = 'file' | 'access';
interface ControlledFile {
	bytes: Uint8Array<ArrayBuffer>;
	accesses: number;
	closes: number;
	live: number;
	snapshots: number;
}

// Explicit Node filesystem ports reproduce the confirmed Firefox exclusion:
// getFile and another access acquisition cannot overlap for one path. The real
// runtime owns request admission, cancellation, writer IDs, and every outcome.
// This does not itself establish native browser/Worker/OPFS execution.
class ReadOwnershipFixture {
	readonly runtime = new OpfsSyncWorkerRuntime({ supportsSyncAccessHandles: () => true });
	readonly files = new Map<string, ControlledFile>();
	readonly lookups: string[] = [];
	readonly events: string[] = [];
	readonly entered = deferred<void>();
	readonly release = deferred<void>();
	readonly #work: Work[] = [];
	#held = false;
	failure: unknown;
	constructor(readonly hold: HoldKind = 'file') { this.seed(SHARED, ORIGINAL); this.seed(OTHER, MASK); }
	seed(path: string, bytes: Uint8Array): void {
		this.files.set(path, { bytes: new Uint8Array(bytes), accesses: 0, closes: 0, live: 0, snapshots: 0 });
	}
	readonly directory = {
		getFileHandle: async (path: string, options: Readonly<{ create?: boolean }> = {}) => {
			this.lookups.push(path); let file = this.files.get(path);
			if (!file && options.create) { this.seed(path, new Uint8Array()); file = this.files.get(path); }
			if (!file) throw new DOMException('Controlled file is absent.', 'NotFoundError');
			const owned = file;
			return {
				createSyncAccessHandle: async (accessOptions?: Readonly<{ mode?: string }>) => {
					assert.ok(accessOptions === undefined || accessOptions.mode === 'read-only');
					this.assertUnlocked(owned); owned.live++; owned.accesses++; this.events.push(`access:${path}`);
					await this.pause('access', path); let closed = false;
					return {
						getSize: () => owned.bytes.byteLength,
						read: (target: ArrayBufferView, at: Readonly<{ at: number }>) => {
							const bytes = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
							bytes.set(owned.bytes.subarray(at.at, at.at + bytes.byteLength)); return bytes.byteLength;
						},
						write: (source: ArrayBufferView, at: Readonly<{ at: number }>) => {
							const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
							const next = new Uint8Array(Math.max(owned.bytes.byteLength, at.at + bytes.byteLength));
							next.set(owned.bytes); next.set(bytes, at.at); owned.bytes = next; return bytes.byteLength;
						},
						truncate: (size: number) => { const next = new Uint8Array(size); next.set(owned.bytes.subarray(0, size)); owned.bytes = next; },
						flush: () => { this.events.push(`flush:${path}`); },
						close: () => { assert.equal(closed, false, 'The real runtime closed an access twice.'); closed = true;
							owned.live--; owned.closes++; this.events.push(`close:${path}`); },
					};
				},
				getFile: async () => {
					this.assertUnlocked(owned); owned.snapshots++; this.events.push(`file:${path}`);
					try { const held = await this.pause('file', path); if (held && this.failure !== undefined) throw this.failure;
						assert.equal(owned.live, 0); return new Blob([new Uint8Array(owned.bytes)]);
					} finally { owned.snapshots--; this.events.push(`file-terminal:${path}`); }
				},
			};
		},
		removeEntry: (path: string) => { this.files.delete(path); return Promise.resolve(); },
	};
	assertUnlocked(file: ControlledFile): void {
		if (file.live || file.snapshots) throw new DOMException('Controlled overlapping OPFS read ownership.', 'NoModificationAllowedError');
	}
	async pause(kind: HoldKind, path: string): Promise<boolean> {
		if (kind !== this.hold || path !== SHARED || this.#held) return false;
		this.#held = true; this.entered.resolve(); await this.release.promise; return true;
	}
	async ready(): Promise<void> {
		assert.deepEqual(await this.runtime.handle({ id: 'init', type: 'initialize', directory: this.directory as unknown as FileSystemDirectoryHandle }), { supported: true });
	}
	start(request: Record<string, unknown>): Work {
		const work = this.runtime.handle(request).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
		this.#work.push(work); return work;
	}
	async cleanup(): Promise<void> {
		this.release.resolve(); await Promise.all(this.#work);
		for (const file of this.files.values()) { assert.equal(file.live, 0); assert.equal(file.snapshots, 0); assert.equal(file.closes, file.accesses); }
	}
}

function snapshot(id: string, path = SHARED): Record<string, unknown> { return { id, type: 'snapshot', operationId: 'media-asset-chunk-read', path }; }
function read(id: string, path = SHARED): Record<string, unknown> { return { id, type: 'read', operationId: 'derivative-payload-read', path, offset: 0, length: path === SHARED ? ORIGINAL.length : MASK.length }; }
function success(outcome: Outcome): Record<string, unknown> { if (!outcome.ok) throw outcome.error; return outcome.value; }
async function entered(fixture: ReadOwnershipFixture, work: Work): Promise<void> {
	await Promise.race([fixture.entered.promise, work.then(value => { success(value); assert.fail('Real request settled before its controlled native boundary.'); })]);
}
async function pending(work: Work): Promise<void> {
	await settle(2); if (!await remainsPending(work)) { success(await work); assert.fail('A same-path request bypassed the held native read owner.'); }
}
async function completeWhileHeld(work: Work): Promise<Record<string, unknown>> {
	await settle(2); assert.equal(await remainsPending(work), false, 'An independent operation was blocked by another path.'); return success(await work);
}
async function blobBytes(value: Record<string, unknown>): Promise<number[]> {
	assert.ok(value.file instanceof Blob); return [...new Uint8Array(await value.file.arrayBuffer())];
}
function readBytes(value: Record<string, unknown>): number[] { assert.ok(value.bytes instanceof ArrayBuffer); return [...new Uint8Array(value.bytes)]; }
function preserved(fixture: ReadOwnershipFixture): void { assert.deepEqual(fixture.files.get(SHARED)?.bytes, ORIGINAL); assert.deepEqual(fixture.files.get(OTHER)?.bytes, MASK); }

for (const next of ['snapshot', 'read'] as const) test(`Light repaired-source OPFS snapshot owns getFile through another same-path ${next}`, OPTIONS, async () => {
	const fixture = new ReadOwnershipFixture(); await fixture.ready(); const first = fixture.start(snapshot('first'));
	try {
		await entered(fixture, first); assert.equal(fixture.files.get(SHARED)?.live, 0, 'The first sync handle was closed before getFile.');
		const second = fixture.start(next === 'snapshot' ? snapshot('second') : read('second')); await pending(second);
		assert.deepEqual(fixture.lookups, [SHARED], 'Queued read touched the filesystem before the previous snapshot terminal.');
		fixture.release.resolve(); const one = success(await first), two = success(await second);
		assert.equal(one.size, ORIGINAL.length); assert.equal(two.size, ORIGINAL.length); assert.deepEqual(await blobBytes(one), [...ORIGINAL]);
		assert.deepEqual(next === 'snapshot' ? await blobBytes(two) : readBytes(two), [...ORIGINAL]); preserved(fixture);
	} finally { await fixture.cleanup(); }
});

test('Light same-path snapshot waits for the actual in-flight read access acquisition and close', OPTIONS, async () => {
	const fixture = new ReadOwnershipFixture('access'); await fixture.ready(); const first = fixture.start(read('held-read'));
	try {
		await entered(fixture, first); assert.equal(fixture.files.get(SHARED)?.live, 1);
		const second = fixture.start(snapshot('next-snapshot')); await pending(second); assert.deepEqual(fixture.lookups, [SHARED]);
		fixture.release.resolve(); assert.deepEqual(readBytes(success(await first)), [...ORIGINAL]);
		assert.deepEqual(await blobBytes(success(await second)), [...ORIGINAL]);
		assert.ok(fixture.events.indexOf(`close:${SHARED}`) < fixture.events.indexOf(`file:${SHARED}`)); preserved(fixture);
	} finally { await fixture.cleanup(); }
});

test('Light held snapshot permits independent path reads and actual writer write/close dispatch', OPTIONS, async () => {
	const fixture = new ReadOwnershipFixture(); await fixture.ready(); const first = fixture.start(snapshot('held'));
	let opening: Work | undefined, writer: Record<string, unknown> | undefined;
	try {
		await entered(fixture, first); assert.deepEqual(readBytes(await completeWhileHeld(fixture.start(read('other', OTHER)))), [...MASK]);
		opening = fixture.start({ id: 'open', type: 'open-writer', operationId: 'media-asset-chunk-write', path: 'new.blob' });
		writer = await completeWhileHeld(opening);
		assert.equal(typeof writer.writerId, 'string');
		assert.deepEqual(await completeWhileHeld(fixture.start({ id: 'write', type: 'write', writerId: writer.writerId, bytes: Uint8Array.of(4, 5).buffer })), { written: 2 });
		assert.deepEqual(await completeWhileHeld(fixture.start({ id: 'close', type: 'close-writer', writerId: writer.writerId })), { size: 2 });
		assert.deepEqual(await blobBytes(await completeWhileHeld(fixture.start(snapshot('written', 'new.blob')))), [4, 5]);
		assert.equal(await remainsPending(first), true); fixture.release.resolve(); assert.deepEqual(await blobBytes(success(await first)), [...ORIGINAL]); preserved(fixture);
	} finally {
		fixture.release.resolve();
		if (!writer && opening) { const result = await opening; if (result.ok) writer = result.value; }
		if (writer) await fixture.runtime.handle({ id: 'cleanup-writer', type: 'abort-writer', writerId: writer.writerId });
		await fixture.cleanup();
	}
});

test('Light queued read cancellation dispatches immediately and refuses filesystem entry before the next owner', OPTIONS, async () => {
	const fixture = new ReadOwnershipFixture(); await fixture.ready(); const first = fixture.start(snapshot('held'));
	try {
		await entered(fixture, first); const cancelled = fixture.start(read('cancelled')); await pending(cancelled);
		assert.deepEqual(await completeWhileHeld(fixture.start({ id: 'cancelled', type: 'cancel' })), { cancelled: true });
		assert.equal(await remainsPending(first), true); assert.deepEqual(fixture.lookups, [SHARED]);
		fixture.release.resolve(); assert.deepEqual(await blobBytes(success(await first)), [...ORIGINAL]);
		const outcome = await cancelled; assert.equal(outcome.ok, false);
		if (!outcome.ok) { assert.ok(outcome.error instanceof Error); assert.equal(outcome.error.name, 'AbortError'); }
		assert.deepEqual(fixture.lookups, [SHARED], 'The cancelled queued request acquired a file handle.');
		assert.deepEqual(readBytes(success(await fixture.start(read('after-cancel')))), [...ORIGINAL]); preserved(fixture);
	} finally { await fixture.cleanup(); }
});

test('Light failed snapshot releases the path for its queued successor without replacing its exact failure', OPTIONS, async () => {
	const fixture = new ReadOwnershipFixture(), reason = Symbol('native getFile failure'); fixture.failure = reason; await fixture.ready();
	const first = fixture.start(snapshot('failing'));
	try {
		await entered(fixture, first); const second = fixture.start(read('after-failure')); await pending(second);
		fixture.release.resolve(); const failure = await first; assert.equal(failure.ok, false);
		if (!failure.ok) assert.equal(Object.is(failure.error, reason), true);
		assert.deepEqual(readBytes(success(await second)), [...ORIGINAL]);
		assert.deepEqual(await blobBytes(success(await fixture.start(snapshot('after-release')))), [...ORIGINAL]); preserved(fixture);
	} finally { await fixture.cleanup(); }
});

test('Light queued OPFS read retains its admitted path, operation and range when its request is mutated', OPTIONS, async () => {
	const fixture = new ReadOwnershipFixture(); await fixture.ready(); const first = fixture.start(snapshot('held'));
	try {
		await entered(fixture, first); const request = { id: 'mutable', type: 'read', operationId: 'canonical-pcm-chunk-read', path: SHARED, offset: 1, length: 2 };
		const second = fixture.start(request); await pending(second);
		Object.assign(request, { operationId: 'media-asset-chunk-read', path: OTHER, offset: 0, length: 1 });
		fixture.release.resolve(); success(await first); const value = success(await second);
		assert.equal(value.operationId, 'canonical-pcm-chunk-read'); assert.equal(value.size, ORIGINAL.length); assert.deepEqual(readBytes(value), [3, 7]);
		assert.deepEqual(fixture.lookups, [SHARED, SHARED]); preserved(fixture);
	} finally { await fixture.cleanup(); }
});
