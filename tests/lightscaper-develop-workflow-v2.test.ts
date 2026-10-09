/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopWorkflowV2, type ExecutePhotoDevelopV2 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import type { PhotoLibraryDevelopAcknowledgementV2, PhotoLibraryDevelopPortV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import { CURRENT_TIME, currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

async function fixture() {
	const f = await currentDevelopFixture(1); let current = true, refreshes = 0;
	const execute: ExecutePhotoDevelopV2 = async (run, signal) => { await run({ signal: signal!, acquire: async () => f.develop,
		isCurrent: () => current, refresh: async () => { refreshes++; } }); };
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute, now: () => CURRENT_TIME });
	return { ...f, owner, execute, retire() { current = false; }, get refreshes() { return refreshes; } };
}

test('actual current workflow promotes only resource edits and keeps aggregate2 across old history, snapshots and virtual copies', async () => {
	const f = await fixture();
	try {
		await f.owner.open('photo-1'); const initial = f.owner.snapshot().document!;
		f.owner.setEffects([createVideoEffectV2('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })]);
		await f.owner.save('Tone'); assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.schemaVersion, 1);
		f.owner.setEffects([...f.owner.snapshot().draft!.effects, createVideoEffectV2('cube-lut-profile-v1', { id: 'profile', enabled: false })]);
		assert.equal(f.owner.snapshot().draft?.processVersion, 2); await f.owner.save('Profile');
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.schemaVersion, 2);
		await f.owner.apply({ type: 'save-develop-snapshot', versionId: initial.versionId, id: 'snapshot', name: 'Profile', createdAt: CURRENT_TIME });
		await f.owner.apply({ type: 'select-develop-history', versionId: initial.versionId, cursor: 0 });
		assert.equal(f.owner.snapshot().draft?.processVersion, 1);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.schemaVersion, 2);
		await f.owner.apply({ type: 'restore-develop-snapshot', versionId: initial.versionId, snapshotId: 'snapshot', label: 'Restore', createdAt: CURRENT_TIME });
		assert.equal(f.owner.snapshot().draft?.processVersion, 2);
		await f.owner.apply({ type: 'create-virtual-copy', sourceVersionId: initial.versionId, id: 'copy', name: 'Copy', createdAt: CURRENT_TIME });
		await f.owner.open('photo-1', 'copy'); assert.equal(f.owner.snapshot().draft?.processVersion, 2);
		const stored = await f.repository.loadPhoto('catalog-1', 'photo-1'); assert.ok(stored);
		assert.deepEqual(stored.original, f.photos[0]!.original); assert.deepEqual(stored.extractedMetadata, f.photos[0]!.extractedMetadata);
	} finally { await f.owner.close(); await f.close(); }
});

test('current gesture cancellation preserves disabled refs and accepted discrete edits without a write', async () => {
	const f = await fixture();
	try {
		await f.owner.open('photo-1'); f.owner.setEffects(currentRecipe().effects); const resource = f.owner.snapshot().draft;
		f.owner.setEffects([...resource!.effects, createVideoEffectV2('tone-ladder-v1', { id: 'tone' })]);
		const accepted = f.owner.snapshot().draft;
		f.owner.previewEffect('tone', { exposure: 1.25 }); f.owner.cancelGesture(); assert.equal(f.owner.snapshot().draft, accepted);
		assert.deepEqual(f.owner.snapshot().draft!.effects[0], currentRecipe().effects[0]);
		f.owner.previewEffect('tone', { exposure: 0.5 });
		f.owner.setEffects([...f.owner.snapshot().draft!.effects, createVideoEffectV2('cube-lut-profile-v1', { id: 'second' })]);
		const discrete = f.owner.snapshot().draft; f.owner.cancelGesture(); assert.equal(f.owner.snapshot().draft, discrete);
		f.owner.previewEffect('profile', { lut: null }); f.owner.commitGesture(); assert.equal(f.owner.snapshot().draft!.effects[0]?.params.lut, null);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, f.photos[0]?.revision);
	} finally { await f.owner.close(); await f.close(); }
});

test('actual stale CAS refuses Save without erasing the accepted draft or durable mixed recipe', async () => {
	const f = await fixture();
	try {
		await f.owner.open('photo-1'); const before = f.owner.snapshot().document!;
		f.owner.setEffects(currentRecipe(null).effects); const draft = f.owner.snapshot().draft;
		const external = await f.develop.apply({ schemaVersion: 2, photoId: before.photoId, expectedRevision: before.revision,
			command: { type: 'record-develop', versionId: before.versionId, develop: currentRecipe(), label: 'External', createdAt: CURRENT_TIME } });
		assert.equal(await f.owner.save('Stale'), null); assert.ok(f.owner.snapshot().error);
		assert.equal(f.owner.snapshot().draft, draft); assert.equal(f.owner.snapshot().document?.revision, before.revision);
		const stored = await f.repository.loadPhoto('catalog-1', 'photo-1'); assert.equal(stored?.revision, external.snapshot.revision);
		assert.deepEqual(stored?.versions[0]?.develop, currentRecipe()); assert.deepEqual(stored?.original, f.photos[0]?.original);
		f.owner.discard(); await f.owner.reload(); assert.equal(f.owner.snapshot().document?.revision, external.snapshot.revision);
	} finally { await f.owner.close(); await f.close(); }
});

test('Save admits its demand before the borrowed clock can reenter selection', async () => {
	const f = await fixture(); let nested: Promise<null> | null = null;
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: f.execute, now: () => { nested = owner.open('other'); return CURRENT_TIME; } });
	try {
		await owner.open('photo-1'); owner.setEffects(currentRecipe(null).effects);
		const receipt = await owner.save('Save'); assert.ok(receipt); assert.equal(receipt.snapshot.photoId, 'photo-1');
		assert.ok(nested); assert.equal(await nested, null); assert.equal(owner.snapshot().document?.photoId, 'photo-1');
	} finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('effect capacity refuses before reflecting any over-cap entry', async () => {
	const f = await fixture(); let traps = 0;
	try {
		await f.owner.open('photo-1'); const before = f.owner.snapshot().draft;
		const effect = new Proxy(createVideoEffectV2('cube-lut-profile-v1'), { getOwnPropertyDescriptor() { traps++; throw new Error('Entry reflected'); } });
		assert.throws(() => f.owner.setEffects(Array.from({ length: 257 }, () => effect)));
		assert.equal(traps, 0); assert.equal(f.owner.snapshot().draft, before);
	} finally { await f.owner.close(); await f.close(); }
});

test('a known current ACK retains cleanup notices when Cancel arrives and refresh fails', async () => {
	const f = await fixture(), held = deferred<PhotoLibraryDevelopAcknowledgementV2>();
	const port: PhotoLibraryDevelopPortV2 = { ...f.develop, apply: () => held.promise };
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => { await run({ signal: signal!, acquire: async () => port,
		isCurrent: () => true, refresh: async () => { throw new Error('Refresh failed'); } }); } });
	try {
		await owner.open('photo-1'); const before = owner.snapshot().document!;
		const work = owner.apply({ type: 'activate-version', versionId: before.versionId }); await settle(); const cancelling = owner.cancel();
		held.resolve({ schemaVersion: 2, snapshot: { ...before, revision: before.revision + 1 }, notices: ['cleanup-failed'] });
		const receipt = await work; await cancelling; assert.equal(receipt?.snapshot.revision, before.revision + 1);
		assert.deepEqual(owner.snapshot().receipt?.notices, ['cleanup-failed']); assert.equal(owner.snapshot().notice, 'refresh-failed');
	} finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('an actual native Save ACK survives a failing borrowed currentness callback without reflecting its opaque failure', async () => {
	const f = await fixture(); let acknowledged: PhotoLibraryDevelopAcknowledgementV2 | null = null, traps = 0;
	const failure = new Proxy({}, { getOwnPropertyDescriptor() { traps++; throw new Error('Opaque currentness failure inspected'); } });
	const port: PhotoLibraryDevelopPortV2 = { ...f.develop, async apply(...args) { const receipt = await f.develop.apply(...args); acknowledged = receipt; return receipt; } };
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => { await run({ signal: signal!, acquire: async () => port,
		isCurrent: () => { if (acknowledged) throw failure; return true; }, refresh: async () => undefined }); }, now: () => CURRENT_TIME });
	try {
		await owner.open('photo-1'); owner.setEffects(currentRecipe(null).effects);
		const receipt = await owner.save('Save'); assert.ok(receipt); assert.ok(Object.is(receipt, acknowledged)); assert.equal(traps, 0);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, receipt.snapshot.revision);
	} finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('capability and clock methods use captured receivers without borrowed metadata reads', async () => {
	const f = await fixture(); let traps = 0, calls = 0;
	const original = f.develop.read;
	const port: PhotoLibraryDevelopPortV2 = { ...f.develop, read: new Proxy(async function (this: PhotoLibraryDevelopPortV2, ...args: Parameters<typeof original>) {
		assert.equal(this, port); calls++; return await Reflect.apply(original, f.develop, args);
	}, { get() { traps++; throw new Error('Borrowed function metadata'); } }) };
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => { await run({ signal: signal!, acquire: async () => port, isCurrent: () => true, refresh: async () => undefined }); } });
	try { await owner.open('photo-1'); assert.equal(calls, 1); assert.equal(traps, 0); }
	finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('execution context methods retain their original receiver through acquisition and refresh', async () => {
	const f = await fixture(); let refreshes = 0;
	const context = { signal: new AbortController().signal,
		async acquire() { assert.equal(this, context); return f.develop; },
		isCurrent() { assert.equal(this, context); return true; },
		async refresh() { assert.equal(this, context); refreshes++; },
	};
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: async run => { await run(context); }, now: () => CURRENT_TIME });
	try {
		await owner.open('photo-1'); assert.equal(owner.snapshot().document?.photoId, 'photo-1');
		owner.setEffects(currentRecipe(null).effects); assert.ok(await owner.save('Profile')); assert.equal(refreshes, 1);
	} finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('a context getter aborts its own signal before any capability acquisition or opaque failure reflection', async () => {
	const f = await fixture(), stop = new AbortController(); let acquired = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw new Error('Opaque reason inspected'); }, getOwnPropertyDescriptor() { traps++; throw new Error('Opaque reason inspected'); } });
	const context = { signal: stop.signal,
		get acquire() { stop.abort(reason); return async () => { acquired++; return f.develop; }; },
		isCurrent: () => true, refresh: async () => undefined,
	};
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: async run => { await run(context); } });
	try { await owner.open('photo-1'); assert.equal(acquired, 0); assert.equal(traps, 0); assert.equal(owner.snapshot().document, null); }
	finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('borrowed currentness native-aborts before any current capability acquisition', async () => {
	const f = await fixture(), stop = new AbortController(); let acquired = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw new Error('Opaque native reason inspected'); }, getOwnPropertyDescriptor() { traps++; throw new Error('Opaque native reason inspected'); } });
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: async run => { await run({ signal: stop.signal,
		acquire: async () => { acquired++; return f.develop; }, isCurrent: () => { stop.abort(reason); return true; }, refresh: async () => undefined }); } });
	try { await owner.open('photo-1'); assert.equal(acquired, 0); assert.equal(traps, 0); assert.equal(owner.snapshot().document, null); }
	finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('native abort from a throwing currentness callback keeps precedence without inspecting its distinct failure', async () => {
	const f = await fixture(), stop = new AbortController(); let acquired = 0, traps = 0;
	const reason = {}, failure = new Proxy({}, { getOwnPropertyDescriptor() { traps++; throw new Error('Distinct failure inspected'); } });
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: async run => { await run({ signal: stop.signal,
		acquire: async () => { acquired++; return f.develop; }, isCurrent: () => { stop.abort(reason); throw failure; }, refresh: async () => undefined }); } });
	try { await owner.open('photo-1'); assert.equal(acquired, 0); assert.equal(traps, 0); assert.equal(owner.snapshot().error, null); }
	finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('Close during command reflection refuses the detached demand before host execution', async () => {
	const f = await fixture(); let executions = 0, closing: Promise<void> | null = null;
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => { executions++; await f.execute(run, signal); } });
	try {
		await owner.open('photo-1'); const document = owner.snapshot().document!;
		const command = new Proxy({ type: 'record-develop' as const, versionId: document.versionId, develop: currentRecipe(null), label: 'Retired', createdAt: CURRENT_TIME }, {
			ownKeys(target) { closing = owner.close(); return Reflect.ownKeys(target); },
		});
		const work = owner.apply(command); await work; assert.ok(closing); await closing;
		assert.equal(executions, 1); assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, f.photos[0]?.revision);
	} finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('cancelled acquisition never reflects a late current capability', async () => {
	const f = await fixture(), held = deferred<PhotoLibraryDevelopPortV2>(); let traps = 0;
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => { await run({ signal: signal!, acquire: () => held.promise,
		isCurrent: () => true, refresh: async () => undefined }); } });
	try {
		const work = owner.open('photo-1'), cancelled = owner.cancel();
		held.resolve(new Proxy(f.develop, { getOwnPropertyDescriptor() { traps++; throw new Error('Late capability reflected'); } }));
		await work; await cancelled; assert.equal(traps, 0); assert.equal(owner.snapshot().error, null);
	} finally { held.resolve(f.develop); await owner.close(); await f.owner.close(); await f.close(); }
});

test('current complete command and domains detach before held acquisition while overlapping demand is refused', async () => {
	const f = await fixture(), held = deferred<PhotoLibraryDevelopPortV2>(); let holding = false, acquired = 0;
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => { await run({ signal: signal!,
		acquire: () => { acquired++; return holding ? held.promise : Promise.resolve(f.develop); }, isCurrent: () => true, refresh: async () => undefined }); } });
	try {
		await owner.open('photo-1'); holding = true; const document = owner.snapshot().document!;
		const develop = JSON.parse(JSON.stringify(currentRecipe())) as ReturnType<typeof currentRecipe>;
		const command = { type: 'record-develop' as const, versionId: document.versionId, develop, label: 'Captured', createdAt: CURRENT_TIME };
		const work = owner.apply(command); command.label = 'Changed'; Reflect.set(develop.effects[0]!.params.lut as object, 'storageKey', 'changed');
		await owner.open('another'); assert.equal(acquired, 2); held.resolve(f.develop); await work;
		assert.deepEqual(owner.snapshot().document?.develop, currentRecipe()); assert.equal(owner.snapshot().document?.history.entries.at(-1)?.label, 'Captured');
	} finally { held.resolve(f.develop); await owner.close(); await f.owner.close(); await f.close(); }
});

test('late native ACK survives Cancel and retirement without publishing into a new epoch', async () => {
	const f = await fixture(), held = deferred<PhotoLibraryDevelopAcknowledgementV2>();
	const port: PhotoLibraryDevelopPortV2 = { ...f.develop, apply: () => held.promise };
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => { await run({ signal: signal!, acquire: async () => port,
		isCurrent: () => true, refresh: async () => { throw new Error('Refresh failed'); } }); } });
	try {
		await owner.open('photo-1'); const before = owner.snapshot().document!;
		const work = owner.apply({ type: 'activate-version', versionId: before.versionId }); await settle();
		const retired = owner.retire(); await remainsPending(retired); owner.resume(); assert.equal(await owner.open('photo-1'), null);
		held.resolve({ schemaVersion: 2, snapshot: { ...before, revision: before.revision + 1 }, notices: ['cleanup-failed'] });
		const ack = await work; await retired; assert.equal(ack?.snapshot.revision, before.revision + 1);
		assert.deepEqual(ack?.notices, ['cleanup-failed']); assert.equal(owner.snapshot().receipt, null); assert.equal(owner.snapshot().visible, false);
	} finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('Close is cached before observer/abort reentry and command admission cannot start host work after retirement', async () => {
	const f = await fixture(), held = deferred<PhotoLibraryDevelopPortV2>(); let acquired = 0;
	const owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => { await run({ signal: signal!, acquire: () => { acquired++; return held.promise; }, isCurrent: () => true, refresh: async () => undefined }); } });
	const opening = owner.open('photo-1'); let nested: Promise<void> | null = null;
	owner.subscribe(view => { if (!view.visible && view.busy) nested = owner.close(); });
	try {
		const closing = owner.close(); assert.equal(owner.close(), closing); if (nested) assert.equal(nested, closing);
		await remainsPending(closing); held.resolve(f.develop); await opening; await closing; assert.equal(acquired, 1);
	} finally { held.resolve(f.develop); await owner.close(); await f.owner.close(); await f.close(); }
});
