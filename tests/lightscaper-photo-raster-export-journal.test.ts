/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { createPhotoRasterExportJournalV1, normalizePhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { PhotoRasterExportJournalErrorV1, PhotoRasterExportJournalOwnerV1, type PhotoRasterExportJournalSettingsV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

function fixture(sidecarEnabled = false) {
	const filenameTemplate = '{index:2}-{name}', plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'batch', format: 'png', filenameTemplate, ...(sidecarEnabled ? { sidecarEnabled: true } : {}),
		members: [{ photoId: 'one', versionId: 'master', expectedRevision: 2, sourceFileName: 'One.png' }, { photoId: 'two', versionId: 'master', expectedRevision: 3, sourceFileName: 'Two.png' }] });
	return createPhotoRasterExportJournalV1(plan, { catalogId: 'catalog', filenameTemplate,
		bindings: plan.members.map(() => ({ originalSha256: 'a'.repeat(64), recipeSha256: 'b'.repeat(64), lutSha256: ['c'.repeat(64)], ...(sidecarEnabled ? { sidecarSha256: 'd'.repeat(64) } : {}) })) });
}
function store(): PhotoRasterExportJournalSettingsV1 & { value: unknown } {
	return { value: undefined, async get() { return this.value; }, async putIfAbsent(_key, next) { if (this.value !== undefined) return false; this.value = structuredClone(next); return true; },
		async replaceIfCurrent(_key, expected, next) { if (JSON.stringify(expected) !== JSON.stringify(this.value)) return false; this.value = structuredClone(next); return true; } };
}
test('durable scalar journal detaches state, stable names and ordered original/LUT bindings', () => {
	const value = fixture(), roundTrip = normalizePhotoRasterExportJournalV1(JSON.parse(JSON.stringify(value)));
	assert.deepEqual(roundTrip, value); assert.ok(Object.isFrozen(value.members)); assert.ok(Object.isFrozen(value.members[0]!.binding.lutSha256));
	assert.deepEqual(value.members.map(member => [member.jobId, member.index, member.fileName, member.state]), [['batch:1', 1, '01-One.png', 'pending'], ['batch:2', 2, '02-Two.png', 'pending']]);
});
test('closed journal refuses capabilities, accessors, dishonest ACKs and derived filename/index changes', () => {
	const value = fixture(); let reads = 0;
	const malformed: unknown[] = [ { ...value, destination: new Blob() }, { ...value, members: [{ ...value.members[0], index: 2 }, value.members[1]] },
		{ ...value, members: [{ ...value.members[0], fileName: 'other.png' }, value.members[1]] }, { ...value, members: [{ ...value.members[0], state: 'committed', delivery: null }, value.members[1]] },
		{ ...value, members: [{ ...value.members[0], binding: { ...value.members[0]!.binding, lutSha256: ['BAD'] } }, value.members[1]] },
		Object.defineProperty({ ...value }, 'catalogId', { enumerable: true, get() { reads++; return 'catalog'; } }) ];
	for (const input of malformed) assert.throws(() => normalizePhotoRasterExportJournalV1(input)); assert.equal(reads, 0);
});
test('reopened journals retain started uncertainty and committed download initiation without claiming Saved', async () => {
	const settings = store(), owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await owner.create(fixture());
	await owner.started('batch:1'); await owner.committed('batch:1', { status: 'download-started', method: 'download', fileName: '01-One.png', size: 4 });
	await owner.started('batch:2'); await owner.closeAndJoin();
	const reopened = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'), value = await reopened.load();
	assert.deepEqual(value?.members.map(member => member.state), ['committed', 'started']);
	assert.equal(value?.members[0]!.delivery?.status, 'download-started'); await assert.rejects(reopened.started('batch:2'));
	await reopened.started('batch:2', true); await reopened.closeAndJoin();
});
test('lost insert and replacement acknowledgements reconcile only exact native readback', async () => {
	const settings = store(), insert = settings.putIfAbsent, replace = settings.replaceIfCurrent;
	settings.putIfAbsent = async function (...args) { await insert.apply(this, args); throw undefined; };
	settings.replaceIfCurrent = async function (...args) { await replace.apply(this, args); throw Symbol('lost ACK'); };
	const owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await owner.create(fixture()); await owner.started('batch:1');
	assert.equal(owner.current?.members[0]!.state, 'started'); await owner.closeAndJoin();
});
test('CAS conflicts never overwrite a competing writer or malformed foreign history', async () => {
	const settings = store(), first = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'), second = new PhotoRasterExportJournalOwnerV1(settings, 'catalog');
	await first.create(fixture()); await second.load(); await first.started('batch:1'); await assert.rejects(second.started('batch:2'), PhotoRasterExportJournalErrorV1);
	assert.equal(normalizePhotoRasterExportJournalV1(settings.value).members[1]!.state, 'pending');
	settings.value = { foreign: true }; await assert.rejects(first.started('batch:2')); assert.deepEqual(settings.value, { foreign: true });
	await first.closeAndJoin(); await second.closeAndJoin();
});
test('opaque failed write and readback causes are preserved without inspecting foreign properties', async () => {
	const primary = new Proxy({}, { get() { assert.fail('Foreign failure inspection'); } }), cleanup = Symbol('readback');
	const settings = store(); settings.putIfAbsent = async () => { throw primary; }; settings.get = async () => { throw cleanup; };
	const owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog');
	await assert.rejects(owner.create(fixture()), (error: unknown) => {
		assert.ok(error instanceof PhotoRasterExportJournalErrorV1); assert.equal(error.failure.cause, primary); assert.equal(error.failure.cleanup?.cause, cleanup); assert.ok(Object.isFrozen(error.failure)); return true;
	}); await owner.closeAndJoin();
});
test('close fences new admission and joins an already held native CAS publication', async () => {
	const settings = store(), held = deferred<void>(), entered = deferred<void>(), insert = settings.putIfAbsent;
	settings.putIfAbsent = async function (...args) { entered.resolve(); await held.promise; return insert.apply(this, args); };
	const owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'), work = owner.create(fixture()); await entered.promise;
	const close = owner.closeAndJoin(); assert.equal(await remainsPending(close), true); assert.throws(() => owner.load());
	held.resolve(); await work; await close; assert.equal(normalizePhotoRasterExportJournalV1(settings.value).revision, 1);
});
test('transport captures own native method receivers before late substitution and refuses accessor ports', async () => {
	const settings = store(), owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); settings.putIfAbsent = async () => assert.fail('Late substitution');
	await owner.create(fixture()); await owner.closeAndJoin(); let reads = 0;
	assert.throws(() => new PhotoRasterExportJournalOwnerV1(Object.defineProperty(store(), 'get', { enumerable: true, get() { reads++; return async () => undefined; } }), 'catalog'));
	assert.equal(reads, 0);
});
test('same maintained settings CAS repository reopens acknowledged rows; foreign catalog cannot create', async () => {
	const values = new KeyValueRepository({ memory: getMemoryDatabase(`journal-${crypto.randomUUID()}`), database: async () => null }, 'settings');
	const ports = { get: values.get.bind(values), putIfAbsent: values.putIfAbsent.bind(values), replaceIfCurrent: values.replaceIfCurrent.bind(values) };
	const owner = new PhotoRasterExportJournalOwnerV1(ports, 'catalog'); await owner.create(fixture()); await owner.started('batch:1'); await owner.closeAndJoin();
	const reopened = new PhotoRasterExportJournalOwnerV1(ports, 'catalog'); assert.equal((await reopened.load())?.members[0]!.state, 'started');
	const foreign = new PhotoRasterExportJournalOwnerV1(ports, 'other'); assert.throws(() => foreign.create(fixture())); await reopened.closeAndJoin(); await foreign.closeAndJoin();
});
test('dense member/resource bounds and UTF-8 journal capacity reject without truncating scalar intent', () => {
	const value = fixture();
	for (const input of [ { ...value, revision: -0 }, { ...value, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...value, members: new Array(2) },
		{ ...value, members: [{ ...value.members[0], binding: { ...value.members[0]!.binding, lutSha256: new Array(65).fill('a'.repeat(64)) } }, value.members[1]] } ]) assert.throws(() => normalizePhotoRasterExportJournalV1(input));
	const plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'maximum', format: 'png', filenameTemplate: '{index}-{name}',
		members: Array.from({ length: 256 }, (_, index) => ({ photoId: `photo${index}`, versionId: 'master', expectedRevision: 1, sourceFileName: 'Original.png' })) });
	assert.throws(() => createPhotoRasterExportJournalV1(plan, { catalogId: 'catalog', filenameTemplate: '{index}-{name}',
		bindings: plan.members.map(() => ({ originalSha256: 'a'.repeat(64), recipeSha256: 'b'.repeat(64), lutSha256: Array.from({ length: 64 }, () => 'c'.repeat(64)) })) }), /byte bound/u);
});
test('truthy non-boolean transport reply cannot invent a durable CAS acknowledgement', async () => {
	const settings = store(); Object.defineProperty(settings, 'putIfAbsent', { enumerable: true, value: async () => 'unverified' });
	const owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await assert.rejects(owner.create(fixture()));
	assert.equal(owner.current, null); assert.equal(settings.value, undefined); await owner.closeAndJoin();
});
test('explicit completed replacement refuses unfinished history and advances the exact CAS revision', async () => {
	const settings = store(), owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await owner.create(fixture());
	const fresh = { ...fixture(), batchId: 'replacement', members: fixture().members.map(member => ({ ...member, jobId: `replacement:${member.index}` })) };
	await assert.rejects(owner.replaceCompleted(fresh));
	for (const member of fixture().members) { await owner.started(member.jobId); await owner.committed(member.jobId, { status: 'download-started', method: 'download', fileName: member.fileName, size: 4 }); }
	const previous = owner.current!; await owner.replaceCompleted(fresh);
	assert.equal(owner.current!.batchId, 'replacement'); assert.equal(owner.current!.revision, previous.revision + 1);
	assert.deepEqual(owner.current!.members.map(member => member.state), ['pending', 'pending']); await owner.closeAndJoin();
});

test('completed replacement protects started rows and reconciles only exact lost CAS ACK', async () => {
	const settings = store(), owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await owner.create(fixture()); await owner.started('batch:1');
	const fresh = { ...fixture(), batchId: 'next', members: fixture().members.map(member => ({ ...member, jobId: `next:${member.index}` })) };
	await assert.rejects(owner.replaceCompleted(fresh));
	await owner.committed('batch:1', { status: 'download-started', method: 'download', fileName: '01-One.png', size: 4 });
	await owner.started('batch:2'); await owner.committed('batch:2', { status: 'download-started', method: 'download', fileName: '02-Two.png', size: 4 });
	const replace = settings.replaceIfCurrent, lost = Symbol('lost replacement ACK');
	// New owner pins the forwarding transport; the original owner retains its prior methods.
	settings.replaceIfCurrent = async function (...args) { await replace.apply(this, args); throw lost; };
	const reopened = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await reopened.load(); await reopened.replaceCompleted(fresh);
	assert.equal(reopened.current!.revision, 6); assert.equal(reopened.current!.batchId, 'next'); await owner.closeAndJoin(); await reopened.closeAndJoin();
});

test('two explicit replacement writers cannot erase the winning new pending queue', async () => {
	const settings = store(), first = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await first.create(fixture());
	for (const member of fixture().members) { await first.started(member.jobId); await first.committed(member.jobId, { status: 'download-started', method: 'download', fileName: member.fileName, size: 4 }); }
	const second = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await second.load();
	const next = (batchId: string) => ({ ...fixture(), batchId, members: fixture().members.map(member => ({ ...member, jobId: `${batchId}:${member.index}` })) });
	await first.replaceCompleted(next('winner')); await assert.rejects(second.replaceCompleted(next('loser')), PhotoRasterExportJournalErrorV1);
	assert.equal(normalizePhotoRasterExportJournalV1(settings.value).batchId, 'winner'); await first.closeAndJoin(); await second.closeAndJoin();
});

test('paired journal records a separately bounded JSON companion and keeps legacy bytes unchanged', () => {
	const old = fixture(), paired = fixture(true);
	assert.equal(Object.hasOwn(old, 'sidecarEnabled'), false); assert.equal(Object.hasOwn(old.members[0]!, 'sidecar'), false);
	assert.equal(paired.sidecarEnabled, true); assert.deepEqual(paired.members[0]!.sidecar, { state: 'pending', delivery: null });
	assert.deepEqual(normalizePhotoRasterExportJournalV1(JSON.parse(JSON.stringify(paired))), paired);
	assert.throws(() => normalizePhotoRasterExportJournalV1({ ...paired, members: paired.members.map(member => ({ ...member, binding: { originalSha256: member.binding.originalSha256, recipeSha256: member.binding.recipeSha256, lutSha256: member.binding.lutSha256 } })) }));
});
test('raster ACK alone cannot complete or replace paired work and its unfinished history remains discardable', async () => {
	const settings = { ...store(), async deleteIfCurrent(_key: string, expected: unknown) { if (JSON.stringify(this.value) !== JSON.stringify(expected)) return false; this.value = undefined; return true; } };
	const owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await owner.create(fixture(true));
	for (const member of owner.current!.members) { await owner.started(member.jobId); await owner.committed(member.jobId, { status: 'download-started', method: 'download', fileName: member.fileName, size: 4 }); }
	const fresh = { ...fixture(true), batchId: 'next', members: fixture(true).members.map(member => ({ ...member, jobId: `next:${member.index}` })) };
	await assert.rejects(owner.replaceCompleted(fresh));
	await owner.discardUnfinished({ batchId: 'batch', revision: owner.current!.revision, reviewed: true }); assert.equal(settings.value, undefined); await owner.closeAndJoin();
});
test('companion intent and ACK are separate durable transitions with exact full image suffix', async () => {
	const settings = store(), owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await owner.create(fixture(true));
	await assert.rejects(owner.sidecarStarted('batch:1')); await owner.started('batch:1');
	await owner.committed('batch:1', { status: 'download-started', method: 'download', fileName: '01-One.png', size: 4 }); await owner.sidecarStarted('batch:1');
	assert.equal(owner.current!.members[0]!.sidecar!.state, 'started'); await assert.rejects(owner.sidecarStarted('batch:1'));
	for (const ack of [{ status: 'download-started', method: 'download', mediaType: 'application/json' as const, fileName: '01-One.lightscaper.json', size: 4 }, { status: 'download-started', method: 'download', mediaType: 'application/json' as const, fileName: '01-One.png.lightscaper.json', size: 2_097_153 }] as const) assert.throws(() => owner.sidecarCommitted('batch:1', ack));
	await owner.sidecarCommitted('batch:1', { status: 'download-started', method: 'download', mediaType: 'application/json' as const, fileName: '01-One.png.lightscaper.json', size: 4 });
	assert.deepEqual(owner.current!.members[0]!.sidecar, { state: 'committed', delivery: { status: 'download-started', method: 'download', mediaType: 'application/json' as const, fileName: '01-One.png.lightscaper.json', size: 4 } }); await owner.closeAndJoin();
});
