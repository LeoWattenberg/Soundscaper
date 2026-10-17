/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperCubeLutEffectActionsFinishing } from '../src/framescaper/editor-cube-lut-effect-actions-finishing.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import type { VideoEffectProject } from '../src/common/editor/controller/clip-video/video-effect-service.ts';

const TEXT = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
const BYTES = new TextEncoder().encode(TEXT), parsed = parseCubeLutV1(TEXT);
const REF = { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256, byteLength: parsed.byteLength,
	size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax };
function fixture() {
	const base = framescaperV20Options();
	let project = createFramescaperProjectFinishing(PROFILE, { ...base,
		clips: (base.clips as readonly Record<string, unknown>[]).map(clip => clip.kind === 'video' ? { ...clip,
			videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: null } }] } : clip) });
	const bodies = new Map<string, Blob>(), writes: Uint8Array[] = [];
	let commits = 0, aborts = 0, bodyCommits = 0, reads = 0;
	const owner = { get project() { return project; }, actions: { edit: { commit(command: unknown) {
		commits++; project = applyFramescaperProjectCommandFinishing(PROFILE, project, command); return project;
	} } } };
	const store = {
		async getMediaAssetMetadata(key: string) { assert.equal(this, store); return bodies.has(key) ? { size: BYTES.length } : null; },
		async loadMediaAsset(key: string) { assert.equal(this, store); reads++; return bodies.get(key) ?? null; },
		async beginMediaAssetWrite(key: string, _metadata: unknown, options: { expectedBytes: number; expectedSha256: string }) {
			assert.equal(this, store); assert.equal(options.expectedBytes, BYTES.length); assert.equal(options.expectedSha256, REF.sha256);
			const parts: Uint8Array<ArrayBuffer>[] = []; const writer = {
				maximumChunkBytes: 17, bytesWritten: 0,
				async write(bytes: Uint8Array) { assert.equal(this, writer); assert.ok(bytes.length <= 17); parts.push(new Uint8Array(bytes)); writes.push(bytes); writer.bytesWritten += bytes.length; },
				async commit() { assert.equal(this, writer); bodyCommits++; bodies.set(key, new Blob(parts)); return { size: BYTES.length }; },
				async abort() { assert.equal(this, writer); aborts++; },
			}; return writer;
		},
	};
	const actions = createFramescaperCubeLutEffectActionsFinishing({ owner, store });
	return { actions, owner, store, bodies, writes,
		read: () => project, set: (next: typeof project) => { project = next; },
		stats: () => ({ commits, aborts, bodyCommits, reads }) };
}
const file = () => new File([BYTES], 'literal.cube');
const outcome = <T>(promise: Promise<T>) => promise.then(value => ({ value, error: undefined as unknown }), (error: unknown) => ({ value: undefined, error }));

test('actual current Frame command authoring publishes bounded immutable bytes and authenticates every exact-key reuse before attaching its scalar reference', async () => {
	const f = fixture(), binding = f.actions.capture('video-clip', 'cube'); assert.ok(binding);
	assert.deepEqual(await f.actions.importFile(binding, file()), REF);
	assert.equal(f.stats().bodyCommits, 1); assert.equal(f.stats().commits, 1); assert.equal(f.stats().reads, 1);
	assert.deepEqual(new Uint8Array(await f.bodies.get(REF.storageKey)!.arrayBuffer()), BYTES);
	assert.ok(f.writes.every(bytes => bytes.every(value => value === 0)));
	const current = f.actions.capture('video-clip', 'cube'); assert.ok(current);
	assert.deepEqual(await f.actions.importFile(current, file()), REF);
	assert.equal(f.stats().bodyCommits, 1); assert.equal(f.stats().commits, 1); assert.equal(f.stats().reads, 2);
	const corrupt = new Uint8Array(BYTES); corrupt[corrupt.length - 1] = 48; f.bodies.set(REF.storageKey, new Blob([corrupt]));
	await assert.rejects(f.actions.importFile(current, file()), /digest|SHA|body/iu);
	assert.equal(f.stats().bodyCommits, 1); assert.equal(f.stats().commits, 1); await f.actions.close();
});

test('held file acquisition captures the target, excludes overlap before reflection and joins Close before wiping exact opaque cancellation', async () => {
	const f = fixture(), held = deferred<Blob | null>(), entered = deferred<void>(), binding = f.actions.capture('video-clip', 'cube'); assert.ok(binding);
	f.bodies.set(REF.storageKey, file());
	// Captured before constructing this owner; this is the actual borrowed reader.
	const original = f.store.loadMediaAsset;
	f.store.loadMediaAsset = async function (key: string) { entered.resolve(); await held.promise; return Reflect.apply(original, this, [key]) as Promise<Blob | null>; };
	const actions = createFramescaperCubeLutEffectActionsFinishing({ owner: f.owner, store: f.store });
	const captured = actions.capture('video-clip', 'cube'); assert.ok(captured); const stop = new AbortController();
	let traps = 0; const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const work = actions.importFile(captured, file(), { signal: stop.signal }), observed = outcome(work);
	await entered.promise;
	let reflected = 0;
	await assert.rejects(actions.importFile(new Proxy(captured, { ownKeys() { reflected++; throw Error('overlap'); } }), file()), /overlap|active/iu);
	stop.abort(reason); const closing = actions.close(); assert.equal(actions.close(), closing);
	assert.equal(await remainsPending(closing), true); assert.equal(await remainsPending(work), true);
	held.resolve(file()); assert.equal((await observed).error, reason); await closing;
	assert.equal(traps, 0); assert.equal(reflected, 0); assert.equal(f.stats().commits, 0); await f.actions.close();
});

test('same-ID replacement before a held body settles refuses the old binding and never overwrites the new current recipe', async () => {
	const f = fixture(), entered = deferred<void>(), held = deferred<void>();
	f.bodies.set(REF.storageKey, file()); const original = f.store.loadMediaAsset;
	f.store.loadMediaAsset = async function (key: string) { entered.resolve(); await held.promise; return Reflect.apply(original, this, [key]) as Promise<Blob | null>; };
	const actions = createFramescaperCubeLutEffectActionsFinishing({ owner: f.owner, store: f.store }), binding = actions.capture('video-clip', 'cube'); assert.ok(binding);
	const work = actions.importFile(binding, file()); const observed = outcome(work); await entered.promise;
	f.set(applyFramescaperProjectCommandFinishing(PROFILE, f.read(), { type: 'video-effect/update', clipId: 'video-clip', effectId: 'cube', changes: { enabled: false } }));
	held.resolve(); assert.match(String((await observed).error), /changed|current|retired/iu);
	assert.equal(actions.isCurrent(binding), false); assert.equal(f.stats().commits, 0); await actions.close(); await f.actions.close();
});

test('a stale rendered stack cannot bind a same-ID replacement before React publishes the new props', async () => {
	const f = fixture(), before = (f.read().clips as VideoEffectProject['clips']).find(row => row.id === 'video-clip')!.videoEffects!;
	f.set(applyFramescaperProjectCommandFinishing(PROFILE, f.read(), { type: 'video-effect/update', clipId: 'video-clip', effectId: 'cube', changes: { enabled: false } }));
	assert.equal(f.actions.capture('video-clip', 'cube', before), null); assert.ok(f.actions.capture('video-clip', 'cube'));
	await f.actions.close();
});

test('an acquired writer is retired and joined when capture of its write method fails opaquely', async () => {
	const f = fixture(), entered = deferred<void>(), held = deferred<void>();
	let traps = 0, aborts = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const writer = { maximumChunkBytes: 17, bytesWritten: 0, async write() {}, async commit() { return {}; },
		async abort() { assert.equal(this, captured); aborts++; entered.resolve(); await held.promise; } };
	const captured = new Proxy(writer, { getOwnPropertyDescriptor(target, key) {
		if (key === 'write') throw reason; return Reflect.getOwnPropertyDescriptor(target, key);
	} });
	const store = { getMediaAssetMetadata: (key: string) => f.store.getMediaAssetMetadata(key),
		loadMediaAsset: (key: string) => f.store.loadMediaAsset(key), async beginMediaAssetWrite() { return captured; } };
	const actions = createFramescaperCubeLutEffectActionsFinishing({ owner: f.owner, store }), binding = actions.capture('video-clip', 'cube'); assert.ok(binding);
	const work = actions.importFile(binding, file()), observed = outcome(work);
	// The owner must call abort even though no write method could be captured.
	await Promise.race([entered.promise, work.catch(() => undefined)]);
	assert.equal(aborts, 1); assert.equal(await remainsPending(work), true);
	const closing = actions.close(); assert.equal(await remainsPending(closing), true);
	held.resolve(); assert.equal((await observed).error, reason); await closing;
	assert.equal(traps, 0); assert.equal(f.stats().commits, 0);
	assert.deepEqual(new Uint8Array(await file().arrayBuffer()), BYTES); await f.actions.close();
});

test('loss of an acquired writer abort capability remains sticky so controller retirement cannot close borrowed storage', async () => {
	const f = fixture(); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const writer = { maximumChunkBytes: 17, bytesWritten: 0, write: () => Promise.resolve(), commit: () => Promise.resolve({}), abort: () => Promise.resolve() };
	const captured = new Proxy(writer, { getOwnPropertyDescriptor(target, key) { if (key === 'abort') throw reason; return Reflect.getOwnPropertyDescriptor(target, key); } });
	const store = { getMediaAssetMetadata: (key: string) => f.store.getMediaAssetMetadata(key), loadMediaAsset: (key: string) => f.store.loadMediaAsset(key),
		beginMediaAssetWrite: () => Promise.resolve(captured) };
	const actions = createFramescaperCubeLutEffectActionsFinishing({ owner: f.owner, store }), binding = actions.capture('video-clip', 'cube'); assert.ok(binding);
	assert.equal((await outcome(actions.importFile(binding, file()))).error, reason);
	assert.equal(actions.capture('video-clip', 'cube'), null);
	const unopened = new Proxy(file(), { get() { traps++; throw Error('retired file'); } });
	assert.equal((await outcome(actions.importFile(binding, unopened))).error, reason);
	assert.equal((await outcome(actions.close())).error, reason); assert.equal(traps, 0); assert.equal(f.stats().commits, 0); await f.actions.close();
});

test('distinct opaque write and retirement failures stay joined and Close retains the retirement evidence', async () => {
	const f = fixture(), held = deferred<void>(), entered = deferred<void>(); let traps = 0;
	const opaque = () => new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const primary = opaque(), cleanup = opaque(); let captured: Uint8Array | undefined;
	const writer = { maximumChunkBytes: 17, bytesWritten: 0, write(bytes: Uint8Array) { captured = bytes; return Promise.reject(primary); },
		commit() { return Promise.resolve({}); }, async abort() { entered.resolve(); await held.promise; throw cleanup; } };
	const store = { getMediaAssetMetadata: (key: string) => f.store.getMediaAssetMetadata(key), loadMediaAsset: (key: string) => f.store.loadMediaAsset(key),
		beginMediaAssetWrite: () => Promise.resolve(writer) };
	const actions = createFramescaperCubeLutEffectActionsFinishing({ owner: f.owner, store }), binding = actions.capture('video-clip', 'cube'); assert.ok(binding);
	const observed = outcome(actions.importFile(binding, file())); await entered.promise;
	const closing = actions.close(), closeResult = outcome(closing); assert.equal(await remainsPending(closing), true);
	held.resolve(); const error = (await observed).error;
	assert.ok(error instanceof AggregateError); assert.equal(error.errors[0], primary); assert.equal(error.errors[1], cleanup);
	assert.equal((await closeResult).error, cleanup); assert.equal(traps, 0); assert.ok(captured?.every(value => value === 0));
	assert.equal(f.stats().commits, 0); assert.equal(f.bodies.size, 0); await f.actions.close();
});

test('native cancellation is checked before the file and synchronous option retirement cannot start resource IO', async () => {
	const f = fixture(), binding = f.actions.capture('video-clip', 'cube'); assert.ok(binding);
	const stop = new AbortController(), reason = Object.freeze({ cancelled: true }); stop.abort(reason);
	let reads = 0; const unopened = new Proxy(file(), { get() { reads++; throw Error('file'); } });
	assert.equal((await outcome(f.actions.importFile(binding, unopened, { signal: stop.signal }))).error, reason);
	let closing: Promise<void> | undefined;
	const options = new Proxy({}, { ownKeys() { closing = f.actions.close(); return []; } });
	await assert.rejects(f.actions.importFile(binding, unopened, options), /aborted|retired|changed/iu);
	assert.equal(reads, 0); assert.deepEqual(f.stats(), { commits: 0, aborts: 0, bodyCommits: 0, reads: 0 }); await closing;
});

test('the captured native first cancellation precedes full option reflection, including abort during admission', async () => {
	for (const preaborted of [true, false]) {
		const f = fixture(), binding = f.actions.capture('video-clip', 'cube'); assert.ok(binding);
		const stop = new AbortController(); let traps = 0, full = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
		if (preaborted) stop.abort(reason);
		const options = new Proxy({ signal: stop.signal }, { ownKeys() { full++; stop.abort(reason); throw Object.freeze({ later: true }); } });
		assert.equal((await outcome(f.actions.importFile(binding, file(), options))).error, reason);
		assert.equal(full, preaborted ? 0 : 1); assert.equal(traps, 0); assert.equal(f.stats().reads, 0); assert.equal(f.stats().bodyCommits, 0);
		await f.actions.close();
	}
});

test('a native first reason survives a later held write rejection and retains distinct joined abort cleanup', async () => {
	const f = fixture(), entered = deferred<void>(), held = deferred<void>(), stop = new AbortController(); let traps = 0;
	const primary = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const later = Object.freeze({ later: true }), cleanup = Object.freeze({ cleanup: true });
	const writer = { maximumChunkBytes: 17, bytesWritten: 0, write() { entered.resolve(); return held.promise; },
		commit: () => Promise.resolve({}), abort: () => Promise.reject(cleanup) };
	const store = { getMediaAssetMetadata: (key: string) => f.store.getMediaAssetMetadata(key), loadMediaAsset: (key: string) => f.store.loadMediaAsset(key),
		beginMediaAssetWrite: () => Promise.resolve(writer) };
	const actions = createFramescaperCubeLutEffectActionsFinishing({ owner: f.owner, store }), binding = actions.capture('video-clip', 'cube'); assert.ok(binding);
	const observed = outcome(actions.importFile(binding, file(), { signal: stop.signal })); await entered.promise; stop.abort(primary);
	const closing = outcome(actions.close()); held.reject(later);
	const failure = (await observed).error; assert.ok(failure instanceof AggregateError);
	assert.equal(failure.errors[0], primary); assert.equal(failure.errors[1], cleanup); assert.equal((await closing).error, cleanup); assert.equal(traps, 0);
	await f.actions.close();
});

test('a native recipe ACK wins late cancellation, while a failed recipe leaves its immutable body append-only', async () => {
	const f = fixture(), stop = new AbortController(); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const owner = { get project() { return f.owner.project; }, actions: { edit: { commit(command: unknown) {
		const next = f.owner.actions.edit.commit(command); stop.abort(reason); return next;
	} } } };
	const actions = createFramescaperCubeLutEffectActionsFinishing({ owner, store: f.store }), binding = actions.capture('video-clip', 'cube'); assert.ok(binding);
	assert.deepEqual(await actions.importFile(binding, file(), { signal: stop.signal }), REF);
	assert.equal(traps, 0); assert.equal(f.stats().commits, 1); await actions.close(); await f.actions.close();
	const failed = fixture(), primary = Object.freeze({ failed: true });
	const refusing = { get project() { return failed.owner.project; }, actions: { edit: { commit() { throw primary; } } } };
	const refused = createFramescaperCubeLutEffectActionsFinishing({ owner: refusing, store: failed.store }), target = refused.capture('video-clip', 'cube'); assert.ok(target);
	assert.equal((await outcome(refused.importFile(target, file()))).error, primary);
	assert.equal(failed.stats().bodyCommits, 1); assert.equal(failed.stats().aborts, 0);
	assert.deepEqual(new Uint8Array(await failed.bodies.get(REF.storageKey)!.arrayBuffer()), BYTES);
	await refused.close(); await failed.actions.close();
});
