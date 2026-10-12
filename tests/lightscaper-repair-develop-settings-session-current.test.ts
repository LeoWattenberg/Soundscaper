/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { repairRecipe } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { repairSettingsFixture, brushSettingsRecipe, FULL_SETTINGS_SELECTION, SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairSettingsFixture>>;
type Selection = { readonly effectTypes: 'all' | readonly string[]; readonly geometry: boolean; readonly localAdjustments: boolean; readonly repairs: boolean };
interface Packet { readonly schemaVersion: 3; readonly kind: 'photo-develop-settings'; readonly selection: Selection; readonly develop: ImageDevelopStateCurrentV1 }
interface Receipt { readonly schemaVersion: 3; readonly completion: 'finished' | 'cancelled' | 'interrupted'; readonly notices: readonly string[];
	readonly outcomes: readonly { readonly photoId: string; readonly status: 'applied' | 'unchanged' | 'conflict' | 'failed' | 'not-attempted'; readonly revision: number | null }[] }
interface CurrentSettings { copy(request: unknown): Packet; merge(request: unknown): ImageDevelopStateCurrentV1; adjust(request: unknown): ImageDevelopStateCurrentV1;
	copySelected(request: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Packet>;
	applyBatch(request: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Receipt> }
function settings(f: Fixture): CurrentSettings {
	const data = Object.getOwnPropertyDescriptor(f.session.develop, 'settingsCurrent');
	assert.ok(data && Object.hasOwn(data, 'value') && data.value, 'actual selected Develop3 must expose its own settingsCurrent child');
	return data.value as CurrentSettings;
}
function target(f: Fixture, index: number) { const photo = f.photos[index]!; return { photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision }; }
function batch(f: Fixture, action: unknown, indexes = [1]) { return { schemaVersion: 3, catalogId: f.photos[0]!.catalogId, targets: indexes.map(index => target(f, index)), action, label: 'Current settings', createdAt: SETTINGS_TIME }; }
const relative = (exposure: number) => ({ kind: 'relative', effectType: 'tone-ladder-v1', changes: { exposure } });
const local = Object.freeze({ effectTypes: [] as readonly string[], geometry: false, localAdjustments: true, repairs: false });

// Every positive reaches the actual missing selected child at baseline. No
// future value module import, synthetic Port2 or substitute body validator.
test('selected Current settings copy, merge and native batch donate exact ordered repairs while preserving Originals', async () => {
	const f = await repairSettingsFixture();
	try { const child = settings(f), before = await f.inspect(), source = await f.read();
		const packet = child.copy({ schemaVersion: 3, develop: source.develop, selection: FULL_SETTINGS_SELECTION });
		assert.equal(packet.schemaVersion, 3); assert.equal(packet.develop.processVersion, 3);
		const merged = child.merge({ schemaVersion: 3, target: f.photos[1]!.versions[0]!.develop, settings: packet });
		assert.equal(merged.processVersion, 3); assert.deepEqual(merged, source.develop);
		const receipt = await child.applyBatch(batch(f, { kind: 'paste', settings: packet })); assert.equal(receipt.schemaVersion, 3); assert.equal(receipt.outcomes[0]!.status, 'applied');
		const after = await f.inspect(); assert.equal(after[1]!.photo.schemaVersion, 3); assert.deepEqual(after[1]!.photo.versions[0]!.develop, source.develop);
		assert.deepEqual(after[0], before[0]); assert.deepEqual(after.map(row => row.bytes), before.map(row => row.bytes));
	} finally { await f.close(); }
});

test('partial Current selection and relative no-op preserve the target repair list and native revision', async () => {
	const f = await repairSettingsFixture();
	try { const child = settings(f), value = repairRecipe(), targetRecipe = { ...value, repairs: { ...value.repairs, spots: [{ ...value.repairs.spots[0]!, id: 'target', enabled: false }] } };
		await f.record(targetRecipe, 1); const before = await f.read(1);
		const packet = child.copy({ schemaVersion: 3, develop: f.source().develop, selection: { ...local, localAdjustments: false } });
		const merged = child.merge({ schemaVersion: 3, target: before.develop, settings: packet }); assert.deepEqual(merged, before.develop);
		const receipt = await child.applyBatch(batch(f, relative(0))); assert.equal(receipt.outcomes[0]!.status, 'unchanged');
		assert.deepEqual(await f.read(1), before); assert.equal(f.saved.length, 1);
	} finally { await f.close(); }
});

test('whole retained Photo3 with active legacy recipe remains Current and refuses genuine legacy Develop2 reads', async () => {
	const f = await repairSettingsFixture();
	try { const child = settings(f); await f.record(defaultImageDevelopStateV2()); const before = (await f.inspect())[0]!.photo;
		assert.equal(before.schemaVersion, 3); assert.equal(before.versions[0]!.develop.processVersion, 2);
		await assert.rejects(f.session.legacyDevelop!.read({ schemaVersion: 2, photoId: before.id }));
		const receipt = await child.applyBatch(batch(f, relative(1), [0])); assert.equal(receipt.outcomes[0]!.status, 'applied');
		const after = (await f.inspect())[0]!; assert.equal(after.photo.schemaVersion, 3); assert.equal(after.photo.versions[0]!.develop.processVersion, 2);
		assert.deepEqual(after.photo.versions[0]!.workspace!.entries.slice(0, -1), before.versions[0]!.workspace!.entries); assert.deepEqual(after.bytes, f.bytes);
	} finally { await f.close(); }
});

test('Current batch reports actual revision conflict without changing the stale native target or Original', async () => {
	const f = await repairSettingsFixture();
	try { const child = settings(f), request = batch(f, relative(1)); await f.session.applyMetadata(f.photos[1]!.id, f.photos[1]!.revision, { title: 'Native change' });
		const before = await f.inspect(), receipt = await child.applyBatch(request); assert.equal(receipt.outcomes[0]!.status, 'conflict'); assert.equal(receipt.outcomes[0]!.revision, null);
		assert.deepEqual(await f.inspect(), before);
	} finally { await f.close(); }
});

test('Current serial settings detach the complete plan and retain native ACK while opaque cancellation skips later targets', async () => {
	const f = await repairSettingsFixture(), entered = deferred<void>(), held = deferred<void>(), stop = new AbortController(), primary = Proxy.revocable({}, {}); primary.revoke();
	let work: Promise<Receipt> | undefined;
	try { const child = settings(f), before = await f.inspect(), request = batch(f, relative(1), [0, 1]);
		f.hooks.afterSave = async () => { entered.resolve(); await held.promise; };
		work = child.applyBatch(request, { signal: stop.signal }); void work.catch(() => undefined);
		await Promise.race([entered.promise, work.then(() => assert.fail('Real native ACK never entered'))]);
		request.targets[1]!.photoId = 'replacement'; (request.action as ReturnType<typeof relative>).changes.exposure = 4; stop.abort(primary.proxy);
		assert.equal(await remainsPending(work), true); held.resolve(); const receipt = await work;
		assert.equal(receipt.completion, 'cancelled'); assert.deepEqual(receipt.outcomes.map(row => row.status), ['applied', 'not-attempted']); assert.equal(receipt.outcomes[1]!.photoId, before[1]!.photo.id);
		const after = await f.inspect(); assert.equal(after[0]!.photo.revision, before[0]!.photo.revision + 1); assert.equal(after[0]!.photo.versions[0]!.develop.effects[0]!.params.exposure, 1);
		assert.deepEqual(after[1], before[1]); assert.deepEqual(after.map(row => row.bytes), before.map(row => row.bytes));
	} finally { held.resolve(); await work?.catch(() => undefined); await f.close(); }
});

test('Current settings preabort is native before hostile request metadata and duplicate targets refuse before any native save', async () => {
	const f = await repairSettingsFixture();
	try { const child = settings(f), stop = new AbortController(), primary = Proxy.revocable({}, {}); primary.revoke(); stop.abort(primary.proxy); let traps = 0;
		const hostile = new Proxy({}, { ownKeys() { traps++; throw new Error('Late metadata'); } });
		const outcome = await child.applyBatch(hostile, { signal: stop.signal }).then(() => ({ ok: true }), (error: unknown) => ({ error }));
		assert.ok('error' in outcome); assert.equal(outcome.error, primary.proxy); assert.equal(traps, 0);
		const request = batch(f, relative(1)); await assert.rejects(child.applyBatch({ ...request, targets: [request.targets[0], request.targets[0]] })); assert.equal(f.saved.length, 0);
	} finally { await f.close(); }
});

test('authenticated selected dirty brush copy joins real body scope before publication and pastes in the same namespace without installation', async () => {
	const f = await repairSettingsFixture(), entered = deferred<void>(), held = deferred<void>(); let work: Promise<Packet> | undefined;
	try { const child = settings(f), installed = await f.installBrush(), draft = brushSettingsRecipe(installed.reference), before = await f.inspect(); let published = false, writes = 0;
		f.native.observeTransactions((_tx, stores, mode) => { if (mode === 'readwrite' && [...(typeof stores === 'string' ? [stores] : stores)].includes('analysis')) writes++; });
		f.hooks.borrowedBrush = async () => { entered.resolve(); await held.promise; };
		work = child.copySelected({ ...f.source(0, draft), selection: local }); void work.then(() => { published = true; }, () => undefined);
		await Promise.race([entered.promise, work.then(() => assert.fail('Authentic body borrower never entered'))]);
		assert.equal(published, false); assert.equal(await remainsPending(work), true); assert.ok(f.borrowed[0]!.some(byte => byte !== 0));
		held.resolve(); const packet = await work; assert.equal(published, true); assert.deepEqual(packet.develop.masks, draft.masks); assert.equal(Object.isFrozen(packet), true);
		f.hooks.borrowedBrush = async () => undefined;
		const merged = child.merge({ schemaVersion: 3, target: f.photos[1]!.versions[0]!.develop, settings: packet }); assert.deepEqual(merged.masks, draft.masks);
		const receipt = await child.applyBatch(batch(f, { kind: 'paste', settings: packet })); assert.equal(receipt.outcomes[0]!.status, 'applied');
		const after = await f.inspect(); assert.deepEqual(after[0], before[0]); assert.deepEqual(after[1]!.photo.versions[0]!.develop.masks, draft.masks);
		assert.deepEqual(after.map(row => row.bytes), before.map(row => row.bytes)); assert.equal(writes, 0); assert.ok(f.borrowed.length >= 2); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { held.resolve(); await work?.catch(() => undefined); await f.close(); }
});

test('cloned raw and foreign Session brush packets cannot grant selected paste or merge authority', async () => {
	const f = await repairSettingsFixture(); let foreign: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	try { const child = settings(f), installed = await f.installBrush(), draft = brushSettingsRecipe(installed.reference);
		const packet = await child.copySelected({ ...f.source(0, draft), selection: local }), clone: unknown = JSON.parse(JSON.stringify(packet)), before = await f.inspect();
		assert.throws(() => child.merge({ schemaVersion: 3, target: f.photos[1]!.versions[0]!.develop, settings: clone }));
		await assert.rejects(child.applyBatch(batch(f, { kind: 'paste', settings: clone })));
		foreign = await createPhotoLibrarySessionCurrentV1(f.options); const other = Object.getOwnPropertyDescriptor(foreign.develop, 'settingsCurrent')?.value as CurrentSettings | undefined; assert.ok(other);
		await assert.rejects(other.applyBatch(batch(f, { kind: 'paste', settings: packet }))); assert.deepEqual(await f.inspect(), before);
	} finally { await foreign?.close(); await f.close(); }
});

test('selected draft copy authenticates an unused declared native brush before any clipboard packet publication', async () => {
	const f = await repairSettingsFixture();
	try { const child = settings(f), first = await f.installBrush(), unused = await f.installBrush([0, 255, 1]), base = brushSettingsRecipe(first.reference), graph = base.masks[0]!;
		const draft = { ...base, masks: [{ ...graph, inputs: [...graph.inputs, { name: 'unused', sourceRef: unused.reference.storageKey, kind: 'alpha' }] }] };
		await f.corruptBrush(unused.reference); const before = await f.inspect(); let published = 0;
		await assert.rejects(child.copySelected({ ...f.source(0, normalizeImageDevelopStateCurrentV1(draft)), selection: local }).then(packet => { published++; return packet; }));
		assert.equal(published, 0); assert.deepEqual(await f.inspect(), before); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.close(); }
});

test('selected copy authenticates retained saved brushes even when active recipe and selected packet contain no brush', async () => {
	const f = await repairSettingsFixture();
	try { const child = settings(f), installed = await f.installBrush(); await f.record(brushSettingsRecipe(installed.reference)); await f.record(defaultImageDevelopStateV2());
		assert.equal(f.photos[0]!.schemaVersion, 3); assert.equal(f.source().develop.processVersion, 2); await f.corruptBrush(installed.reference);
		await assert.rejects(child.copySelected({ ...f.source(), selection: { ...local, localAdjustments: false } })); assert.equal(f.saved.length, 2);
	} finally { await f.close(); }
});

test('an enrolled brush packet never bypasses full target-save resource authentication after durable body corruption', async () => {
	const f = await repairSettingsFixture();
	try { const child = settings(f), installed = await f.installBrush(), packet = await child.copySelected({ ...f.source(0, brushSettingsRecipe(installed.reference)), selection: local });
		await f.corruptBrush(installed.reference); const before = await f.inspect(), receipt = await child.applyBatch(batch(f, { kind: 'paste', settings: packet }));
		assert.equal(receipt.outcomes[0]!.status, 'failed'); assert.deepEqual(await f.inspect(), before); assert.equal(f.saved.length, 0);
	} finally { await f.close(); }
});

for (const sourceRef of ['foreign-source', `brush-mask-v2:1:1:${'a'.repeat(64)}`]) test(`selected dirty settings refuse unsupported unused source ${sourceRef} before any genuine brush borrow`, async () => {
	const f = await repairSettingsFixture();
	try {
		const child = settings(f), installed = await f.installBrush(), base = brushSettingsRecipe(installed.reference), graph = base.masks[0]!;
		const draft = normalizeImageDevelopStateCurrentV1({ ...base, masks: [{ ...graph,
			inputs: [...graph.inputs, { name: 'unused', sourceRef, kind: 'alpha' }] }] });
		const before = await f.inspect(); let published = 0;
		await assert.rejects(child.copySelected({ ...f.source(0, draft), selection: local }).then(packet => { published++; return packet; }), { name: 'TypeError' });
		assert.equal(published, 0); assert.equal(f.borrowed.length, 0); assert.equal(f.saved.length, 0);
		assert.deepEqual(await f.inspect(), before);
	} finally { await f.close(); }
});

test('genuine legacy settings and whole-Photo frontdoors retain strict process1/2 refusal and ordinary legacy availability', async () => {
	const f = await repairSettingsFixture();
	try { const legacy = f.session.legacyDevelop!; assert.ok(legacy.settings);
		assert.throws(() => Reflect.apply(legacy.settings!.copy, legacy.settings, [{ schemaVersion: 2, develop: repairRecipe(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }]));
		await assert.rejects(legacy.read({ schemaVersion: 2, photoId: f.photos[0]!.id }));
		assert.equal((await legacy.read({ schemaVersion: 2, photoId: f.photos[1]!.id })).schemaVersion, 2); assert.deepEqual((await f.inspect()).map(row => row.bytes), [f.bytes, f.bytes]);
	} finally { await f.close(); }
});
