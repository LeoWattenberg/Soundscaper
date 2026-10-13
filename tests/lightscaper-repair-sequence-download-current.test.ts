/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoFramescaperHandoffDownload, type PhotoFramescaperCollectionHandoffDownloadRequest,
	type PhotoFramescaperCollectionHandoffDownloadReceipt } from '../src/lightscaper/controller/photo-framescaper-handoff-download.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

// Delivery checks native Blob and ACK bytes. Frame archive semantics are
// exercised separately by the owning Current sequence archive tests.
const body = new Blob([Uint8Array.of(1, 2, 3)]);
type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };
type Request = Omit<Mutable<PhotoFramescaperCollectionHandoffDownloadRequest>, 'target'> & {
	target: Mutable<PhotoFramescaperCollectionHandoffDownloadRequest['target']> & { schemaVersion: 2 };
};
function request(): Request {
	return { fileName: 'Current sequence.fscape', fileTypeDescription: 'Editable sequence',
		target: { schemaVersion: 2, binding: { catalogId: 'catalog', collectionId: 'manual', scope: 'catalog', expectedCatalogRevision: 3 },
			capture: { async withCapture() { throw Error('Delivery cannot acquire Photo body authority.'); } }, async checkCurrent() {} },
		async buildArchive() { return { blob: body, fileName: 'Current sequence.fscape', projectId: 'project', sequenceId: 'sequence', photoCount: 2 }; },
		prepareSave() { return { mode: 'blob', target: { browserDownload: true }, fileName: 'Chosen.fscape' }; },
		saveFile(value) { assert.equal(value.blob, body); return { method: 'download', fileName: 'Chosen.fscape', size: body.size }; } };
}
function start(controller: PhotoFramescaperHandoffDownload, input: unknown): Promise<PhotoFramescaperCollectionHandoffDownloadReceipt> {
	const candidate: unknown = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(controller) as object, 'startCollectionCurrent')?.value;
	const method = typeof candidate === 'function' ? candidate : controller.startCollection;
	return Reflect.apply(method, controller, [input]) as Promise<PhotoFramescaperCollectionHandoffDownloadReceipt>;
}

test('Current sequence delivery admits its tagged target in the gesture and keeps exact sequence ACK fields', async () => {
	const input = request(), events: string[] = [], owner = new PhotoFramescaperHandoffDownload();
	input.prepareSave = function (value) { assert.equal(this, input); events.push('picker'); assert.equal(value.suggestedName, input.fileName);
		return { mode: 'blob', target: { browserDownload: true }, fileName: 'Chosen.fscape' }; };
	input.target.checkCurrent = async function () { assert.equal(this, input.target); events.push('current'); };
	input.buildArchive = async function (value) { assert.equal(this, input); assert.deepEqual(value.binding, input.target.binding); events.push('archive');
		return { blob: body, fileName: input.fileName, projectId: 'project', sequenceId: 'sequence', photoCount: 2 }; };
	const work = start(owner, input), outcome = work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try { assert.deepEqual(events, ['picker']); const result = await outcome; if (!result.ok) throw result.error;
		assert.deepEqual(result.value, { status: 'download-started', fileName: 'Chosen.fscape', byteLength: 3, projectId: 'project', sequenceId: 'sequence', photoCount: 2 });
		assert.deepEqual(events, ['picker', 'current', 'archive', 'current']);
	} finally { await outcome; await owner.cancelAndJoin(); }
});

test('Current sequence retirement joins an entered builder and keeps the exact opaque cancellation', async () => {
	const input = request(), entered = deferred<void>(), release = deferred<void>(), owner = new PhotoFramescaperHandoffDownload(), stop = Symbol('retire sequence');
	let deliveries = 0;
	input.buildArchive = async () => { entered.resolve(); await release.promise; return { blob: body, fileName: input.fileName, projectId: 'project', sequenceId: 'sequence', photoCount: 2 }; };
	input.saveFile = () => { deliveries++; throw Error('Retired sequence cannot be delivered.'); };
	const work = start(owner, input), outcome = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	try { await Promise.race([entered.promise, outcome.then(value => { if (!value.ok) throw value.error; assert.fail('Current builder finished without entering.'); })]);
		const closing = owner.cancelAndJoin(stop); assert.equal(await remainsPending(closing), true); release.resolve();
		const result = await outcome; assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, stop); await closing; assert.equal(deliveries, 0);
	} finally { release.resolve(); await outcome; await owner.cancelAndJoin(); }
});

test('permanent legacy sequence delivery refuses a Current target before the picker', async () => {
	const input = request(); let pickers = 0; input.prepareSave = () => { pickers++; throw Error('No destination authority.'); };
	await assert.rejects(new PhotoFramescaperHandoffDownload().startCollection(input), TypeError); assert.equal(pickers, 0);
});
