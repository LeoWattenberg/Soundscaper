/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoFramescaperHandoffDownload, type PhotoFramescaperHandoffDownloadRequest, type PhotoFramescaperHandoffTarget,
	type PhotoFramescaperCollectionHandoffDownloadRequest, type PhotoFramescaperCollectionHandoffTarget } from '../src/lightscaper/controller/photo-framescaper-handoff-download.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import type { PreparedBrowserSave } from '../src/common/editor/browser-file-save-service.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

// This payload exercises the native delivery seam; archive content is the archive owner's separate evidence.
const blob = new Blob([new Uint8Array([1, 2, 3])]);
type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };
function request(): Mutable<PhotoFramescaperHandoffDownloadRequest> & { target: Mutable<PhotoFramescaperHandoffTarget> } {
	return { fileName: 'Original.png', fileTypeDescription: 'Editable project',
		target: { binding: { catalogId: 'catalog', photoId: 'photo', versionId: 'master', expectedRevision: 3 },
			capture: { withCapture: async () => assert.fail('The delivery owner must not borrow original resources itself.') }, checkCurrent: async () => undefined },
		buildArchive: async () => ({ blob, fileName: 'Original.fscape', projectId: 'project' }),
		prepareSave: () => ({ mode: 'blob', fileName: 'Original.fscape', target: { browserDownload: true } }),
		saveFile: value => { assert.equal(value.blob, blob); return { method: 'download', fileName: 'Original.fscape', size: 3 }; } };
}
test('native picker begins in the initial gesture; exact completed Blob ACK is download-started, not imported', async () => {
	const input = request(), events: string[] = [], controller = new PhotoFramescaperHandoffDownload();
	input.prepareSave = value => { events.push('picker'); assert.equal(value.purpose, 'project-copy'); assert.equal(value.suggestedName, 'Original.fscape'); return { mode: 'blob', fileName: 'Original.fscape', target: { browserDownload: true } }; };
	input.target.checkCurrent = async () => { events.push('current'); };
	input.buildArchive = async () => { events.push('archive'); return { blob, fileName: 'Original.fscape', projectId: 'project' }; };
	const work = controller.start(input); assert.deepEqual(events, ['picker']);
	assert.deepEqual(await work, { status: 'download-started', fileName: 'Original.fscape', byteLength: 3, projectId: 'project' });
	assert.deepEqual(events, ['picker', 'current', 'archive', 'current']); await controller.cancelAndJoin();
});
test('picker dismissal does not acquire archive or original authority', async () => {
	const input = request(); let archives = 0;
	input.prepareSave = () => ({ mode: 'cancelled', cancelled: true, fileName: 'Original.fscape' });
	input.buildArchive = async () => { archives++; throw new Error('Must stay cold'); };
	assert.deepEqual(await new PhotoFramescaperHandoffDownload().start(input), { status: 'cancelled' }); assert.equal(archives, 0);
});
test('closed request admission refuses getters and invalid IDs before native picker', async () => {
	let getters = 0, pickers = 0;
	for (const kind of ['getter', 'id'] as const) {
		const input = request(); input.prepareSave = () => { pickers++; throw new Error('Must not prepare'); };
		if (kind === 'getter') Object.defineProperty(input, 'fileName', { enumerable: true, get() { getters++; return 'Original.png'; } });
		else Object.defineProperty(input.target.binding, 'photoId', { enumerable: true, value: 'bad/id' });
		await assert.rejects(new PhotoFramescaperHandoffDownload().start(input), TypeError);
	}
	assert.equal(getters, 0); assert.equal(pickers, 0);
});
test('retirement joins a held picker and retains opaque cancellation', async () => {
	const picker = deferred<PreparedBrowserSave>(), input = request(), controller = new PhotoFramescaperHandoffDownload(), stop = Symbol('retired');
	input.prepareSave = () => picker.promise; const work = controller.start(input), refusal = assert.rejects(work, value => value === stop);
	const retiring = controller.cancelAndJoin(stop); assert.equal(await remainsPending(retiring), true);
	picker.resolve({ mode: 'cancelled', cancelled: true, fileName: 'Original.fscape' }); await refusal; await retiring;
});
test('held admitted archive joins before retirement; no Blob can be delivered after cancellation', async () => {
	const entered = deferred<void>(), release = deferred<void>(), input = request(), controller = new PhotoFramescaperHandoffDownload(); let deliveries = 0;
	input.buildArchive = async () => { entered.resolve(); await release.promise; return { blob, fileName: 'Original.fscape', projectId: 'project' }; };
	input.saveFile = () => { deliveries++; throw new Error('Cancelled generation cannot deliver'); };
	const work = controller.start(input), refusal = assert.rejects(work, error => error instanceof DOMException && error.name === 'AbortError');
	await entered.promise; const closing = controller.cancelAndJoin(); assert.equal(await remainsPending(closing), true);
	release.resolve(); await refusal; await closing; assert.equal(deliveries, 0);
});
test('same-generation saved-version change while the archive is held refuses the native boundary', async () => {
	const entered = deferred<void>(), release = deferred<void>(), input = request(); let changed = false, deliveries = 0;
	input.target.checkCurrent = async () => { if (changed) throw new Error('Saved photo changed'); };
	input.buildArchive = async () => { entered.resolve(); await release.promise; return { blob, fileName: 'Original.fscape', projectId: 'project' }; };
	input.saveFile = () => { deliveries++; throw new Error('Stale snapshot cannot deliver'); };
	const work = new PhotoFramescaperHandoffDownload().start(input), refusal = assert.rejects(work, /Saved photo changed/u);
	await entered.promise; changed = true; release.resolve(); await refusal; assert.equal(deliveries, 0);
});
test('real direct-save commit keeps its saved ACK through late cancellation and joins native close', async () => {
	const entered = deferred<void>(), release = deferred<void>(), input = request(), controller = new PhotoFramescaperHandoffDownload(); let aborted = 0; const writes: Uint8Array[] = [];
	input.prepareSave = value => createFileSystemPreparedSave({ fileName: 'Original.fscape', signal: value.signal, target: {
		name: 'Original.fscape', createWritable: () => Promise.resolve({ write(bytes) { assert.ok(bytes instanceof Uint8Array); writes.push(bytes); },
			async close() { entered.resolve(); await release.promise; }, abort() { aborted++; } }) } });
	const work = controller.start(input); await entered.promise; const closing = controller.cancelAndJoin(Symbol('late close')); assert.equal(await remainsPending(closing), true);
	release.resolve(); assert.deepEqual(await work, { status: 'saved', fileName: 'Original.fscape', byteLength: 3, projectId: 'project' }); await closing;
	assert.equal(aborted, 0); assert.deepEqual([...writes[0]!], [1, 2, 3]);
});
test('partial acquired destination cleanup preserves distinct opaque primary and cleanup values', async () => {
	const input = request(), primary = Symbol('archive refused'), cleanup = undefined; let aborts = 0; const reasons: unknown[] = [];
	input.prepareSave = () => ({ mode: 'stream', createWritable: async () => new WritableStream<Uint8Array>(), bytesWritten: () => 0, patchFinalPrefix: async () => undefined,
		commit: async () => assert.fail('No commit'), savedFile: () => assert.fail('No ACK'), abort: async reason => { aborts++; reasons.push(reason); throw cleanup; } });
	input.buildArchive = async () => { throw primary; };
	await assert.rejects(new PhotoFramescaperHandoffDownload().start(input), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); assert.equal(error.cause, primary); return true;
	}); assert.equal(aborts, 1); assert.deepEqual(reasons, [primary]);
});
test('malformed acquired stream captures safe own cleanup without invoking an accessor', async () => {
	const input = request(); let getters = 0, aborts = 0;
	const stream = { mode: 'stream', abort: async () => { aborts++; } };
	Object.defineProperty(stream, 'createWritable', { enumerable: true, get() { getters++; throw new Error('Foreign getter'); } });
	input.prepareSave = () => stream as PreparedBrowserSave;
	await assert.rejects(new PhotoFramescaperHandoffDownload().start(input), TypeError); assert.equal(getters, 0); assert.equal(aborts, 1);
});
test('native acknowledgement must match exact bytes and an admitted delivery method', async () => {
	for (const bad of [{ method: 'download', fileName: 'Original.fscape', size: 2 }, { method: 'blob', fileName: 'Original.fscape', size: 3 }] as const) {
		const input = request(); input.saveFile = () => bad;
		await assert.rejects(new PhotoFramescaperHandoffDownload().start(input), /exact bytes/u);
	}
});
test('direct acquired stream methods and cleanup are pinned before start returns', async () => {
	for (const refuse of [false, true]) {
		const input = request(), primary = Symbol('archive refused'), events: string[] = [];
		const stream = { mode: 'stream' as const, createWritable: async () => { events.push('write'); return new WritableStream<Uint8Array>(); },
			bytesWritten: () => 3, patchFinalPrefix: async () => undefined,
			commit: async () => { events.push('commit'); return { method: 'file-system-access' as const, fileName: 'Original.fscape', size: 3 }; },
			savedFile: () => ({ method: 'file-system-access' as const, fileName: 'Original.fscape', size: 3 }),
			abort: async (reason?: unknown) => { events.push('abort'); assert.equal(reason, primary); } };
		input.prepareSave = () => stream; if (refuse) input.buildArchive = async () => { throw primary; };
		const work = new PhotoFramescaperHandoffDownload().start(input);
		const substituted = () => { throw new Error('Substituted destination capability must not run.'); };
		Object.assign(stream, { createWritable: substituted, commit: substituted, abort: substituted, savedFile: substituted, bytesWritten: substituted, patchFinalPrefix: substituted });
		if (refuse) { await assert.rejects(work, error => error === primary); assert.deepEqual(events, ['abort']); }
		else { assert.deepEqual(await work, { status: 'saved', fileName: 'Original.fscape', byteLength: 3, projectId: 'project' }); assert.deepEqual(events, ['write', 'commit']); }
	}
});

function collectionRequest(): Mutable<PhotoFramescaperCollectionHandoffDownloadRequest> & { target: Mutable<PhotoFramescaperCollectionHandoffTarget> } {
	return { fileName: 'Selected collection', fileTypeDescription: 'Editable sequence',
		target: { binding: { catalogId: 'catalog', collectionId: 'collection', scope: 'catalog', expectedCatalogRevision: 3 },
			capture: { withCapture: async () => assert.fail('Delivery must not borrow original resources.') }, checkCurrent: async () => undefined },
		buildArchive: async () => ({ blob, fileName: 'Selected collection.fscape', projectId: 'project', sequenceId: 'sequence', photoCount: 2 }),
		prepareSave: () => ({ mode: 'blob', fileName: 'Selected collection.fscape', target: { browserDownload: true } }),
		saveFile: value => { assert.equal(value.blob, blob); return { method: 'download', fileName: 'Selected collection.fscape', size: 3 }; } };
}
test('Light collection delivery starts picker in the gesture and returns only actual download sequence ACK', async () => {
	const input = collectionRequest(), events: string[] = [], controller = new PhotoFramescaperHandoffDownload();
	input.prepareSave = value => { events.push('picker'); assert.equal(value.purpose, 'project-copy'); assert.equal(value.suggestedName, 'Selected collection.fscape');
		return { mode: 'blob', fileName: 'Chosen.fscape', target: { browserDownload: true } }; };
	input.target.checkCurrent = async () => { events.push('current'); };
	input.buildArchive = async value => { events.push('archive'); assert.deepEqual(value.binding, input.target.binding); assert.equal(Object.hasOwn(value.binding, 'photoId'), false);
		return { blob, fileName: 'Selected collection.fscape', projectId: 'project', sequenceId: 'sequence', photoCount: 2 }; };
	input.saveFile = value => { assert.equal(value.suggestedName, 'Chosen.fscape'); assert.equal(value.blob, blob); return { method: 'download', fileName: 'Chosen.fscape', size: 3 }; };
	const work = controller.startCollection(input); assert.deepEqual(events, ['picker']);
	assert.deepEqual(await work, { status: 'download-started', fileName: 'Chosen.fscape', byteLength: 3, projectId: 'project', sequenceId: 'sequence', photoCount: 2 });
	assert.deepEqual(events, ['picker', 'current', 'archive', 'current']); await controller.cancelAndJoin();
});
test('Light collection delivery pins saved-query binding and every capability receiver before picker yield', async () => {
	const input = collectionRequest(), picker = deferred<PreparedBrowserSave>(), binding = { catalogId: 'catalog', collectionId: 'query', scope: 'saved-query' as const,
		expectedCatalogRevision: 3, expectedDefinitionRevision: 5 }, target = input.target;
	input.target.binding = binding; const capture = { withCapture: async function <Result>(this: unknown) { assert.equal(this, capture); return undefined as Result; } };
	input.target.capture = capture;
	input.prepareSave = function (this: unknown) { assert.equal(this, input); return picker.promise; };
	input.target.checkCurrent = async function (this: unknown) { assert.equal(this, target); };
	input.buildArchive = async function (this: unknown, value) { assert.equal(this, input); assert.deepEqual(value.binding, { catalogId: 'catalog', collectionId: 'query', scope: 'saved-query', expectedCatalogRevision: 3, expectedDefinitionRevision: 5 });
		await value.capture.withCapture(value.binding, () => undefined, { signal: value.signal });
		return { blob, fileName: 'Selected collection.fscape', projectId: 'project', sequenceId: 'sequence', photoCount: 2 }; };
	input.saveFile = function (this: unknown) { assert.equal(this, input); return { method: 'download', fileName: 'Selected collection.fscape', size: 3 }; };
	const work = new PhotoFramescaperHandoffDownload().startCollection(input), replaced = () => { throw Symbol('replaced'); };
	Object.assign(binding, { collectionId: 'foreign', expectedDefinitionRevision: 10 });
	Object.assign(input, { prepareSave: replaced, buildArchive: replaced, saveFile: replaced }); Object.assign(target, { checkCurrent: replaced }); Object.assign(capture, { withCapture: replaced });
	picker.resolve({ mode: 'blob', fileName: 'Selected collection.fscape', target: { browserDownload: true } }); assert.equal((await work).status, 'download-started');
});
test('Light collection delivery admits closed scope-specific binding and native signal before picker', async () => {
	let getters = 0, pickers = 0;
	for (const mode of ['getter', 'nested', 'capture', 'scope', 'catalog-definition', 'missing-definition', 'definition', 'id', 'signal'] as const) {
		const input = collectionRequest(); input.prepareSave = () => { pickers++; throw Symbol('must not prepare'); };
		if (mode === 'getter') Object.defineProperty(input, 'buildArchive', { enumerable: true, get() { getters++; return input.buildArchive; } });
		if (mode === 'nested') Object.defineProperty(input.target.binding, 'collectionId', { enumerable: true, get() { getters++; return 'collection'; } });
		if (mode === 'capture') Object.defineProperty(input.target.capture, 'withCapture', { enumerable: true, get() { getters++; return () => undefined; } });
		if (mode === 'scope') Object.assign(input.target.binding, { scope: 'future' });
		if (mode === 'catalog-definition') Object.assign(input.target.binding, { expectedDefinitionRevision: 0 });
		if (mode === 'missing-definition') Object.assign(input.target.binding, { scope: 'saved-query' });
		if (mode === 'definition') Object.assign(input.target.binding, { scope: 'saved-query', expectedDefinitionRevision: -1 });
		if (mode === 'id') Object.assign(input.target.binding, { collectionId: 'bad/id' });
		if (mode === 'signal') input.signal = Object.defineProperty(new AbortController().signal, 'reason', { get() { getters++; return undefined; } });
		await assert.rejects(new PhotoFramescaperHandoffDownload().startCollection(input));
	}
	assert.equal(getters, 0); assert.equal(pickers, 0);
});
test('Light collection picker dismissal and the shared single/collection busy latch retain no archive authority', async () => {
	const input = collectionRequest(); let archives = 0;
	input.prepareSave = () => ({ mode: 'cancelled', cancelled: true, fileName: 'Selected collection.fscape' }); input.buildArchive = async () => { archives++; throw Symbol('must stay cold'); };
	assert.deepEqual(await new PhotoFramescaperHandoffDownload().startCollection(input), { status: 'cancelled' }); assert.equal(archives, 0);
	for (const collectionFirst of [false, true]) {
		const controller = new PhotoFramescaperHandoffDownload(), picker = deferred<PreparedBrowserSave>(), single = request(), collection = collectionRequest();
		single.prepareSave = collection.prepareSave = () => picker.promise;
		const work = collectionFirst ? controller.startCollection(collection) : controller.start(single);
		await assert.rejects(collectionFirst ? controller.start(single) : controller.startCollection(collection), /pending/u);
		picker.resolve({ mode: 'cancelled', cancelled: true, fileName: 'No copy.fscape' }); assert.deepEqual(await work, { status: 'cancelled' });
	}
});
test('Light collection retirement uses native cancellation after signal properties change during held picker', async () => {
	const input = collectionRequest(), stop = new AbortController(), picker = deferred<PreparedBrowserSave>(), controller = new PhotoFramescaperHandoffDownload(), primary = new Proxy({}, {}); let getters = 0;
	input.signal = stop.signal; input.prepareSave = () => picker.promise;
	const work = controller.startCollection(input), refused = assert.rejects(work, error => error === primary);
	Object.defineProperty(stop.signal, 'reason', { get() { getters++; return Symbol('foreign getter'); } }); stop.abort(primary);
	const closing = controller.cancelAndJoin(); assert.equal(await remainsPending(closing), true);
	picker.resolve({ mode: 'cancelled', cancelled: true, fileName: 'Selected collection.fscape' }); await refused; await closing; assert.equal(getters, 0);
});
test('Light collection archive retirement and final collection drift refuse native delivery after joining', async () => {
	for (const cancelled of [false, true]) {
		const input = collectionRequest(), entered = deferred<void>(), release = deferred<void>(), controller = new PhotoFramescaperHandoffDownload(); let changed = false, deliveries = 0;
		input.buildArchive = async () => { entered.resolve(); await release.promise; return { blob, fileName: 'Selected collection.fscape', projectId: 'project', sequenceId: 'sequence', photoCount: 2 }; };
		input.target.checkCurrent = async () => { if (changed) throw new Error('Collection changed'); };
		input.saveFile = () => { deliveries++; throw Symbol('must not deliver'); };
		const reason = Symbol('retired'), work = controller.startCollection(input), refused = assert.rejects(work, cancelled ? error => error === reason : /Collection changed/u);
		await entered.promise; changed = true; const closing = cancelled ? controller.cancelAndJoin(reason) : Promise.resolve();
		assert.equal(await remainsPending(work), true); if (cancelled) assert.equal(await remainsPending(closing), true);
		release.resolve(); await refused; await closing; assert.equal(deliveries, 0);
	}
});
test('Light collection native saved ACK survives late cancellation and joins direct close', async () => {
	const input = collectionRequest(), entered = deferred<void>(), release = deferred<void>(), controller = new PhotoFramescaperHandoffDownload(), writes: Uint8Array[] = []; let aborts = 0;
	input.prepareSave = value => createFileSystemPreparedSave({ fileName: 'Selected.fscape', signal: value.signal, target: { name: 'Selected.fscape',
		createWritable: async () => ({ write(bytes) { assert.ok(bytes instanceof Uint8Array); writes.push(bytes); }, async close() { entered.resolve(); await release.promise; }, abort() { aborts++; } }) } });
	const work = controller.startCollection(input); await entered.promise; const closing = controller.cancelAndJoin(Symbol('late cancellation'));
	assert.equal(await remainsPending(closing), true); release.resolve();
	assert.deepEqual(await work, { status: 'saved', fileName: 'Selected.fscape', byteLength: 3, projectId: 'project', sequenceId: 'sequence', photoCount: 2 });
	await closing; assert.equal(aborts, 0); assert.deepEqual([...writes[0]!], [1, 2, 3]);
});
test('Light collection archive identities and count are admitted before destination writes', async () => {
	let writes = 0, getters = 0;
	for (const bad of [{ sequenceId: 'bad/id' }, { photoCount: 0 }, { photoCount: 4_095 }, { photoCount: 1.5 }, { schemaVersion: 2 }] as const) {
		const input = collectionRequest(); input.buildArchive = async () => ({ blob, fileName: 'Selected.fscape', projectId: 'project', sequenceId: 'sequence', photoCount: 2, ...bad });
		input.saveFile = () => { writes++; throw Symbol('must not write'); }; await assert.rejects(new PhotoFramescaperHandoffDownload().startCollection(input));
	}
	const input = collectionRequest(); input.buildArchive = async () => Object.defineProperty({ blob, fileName: 'Selected.fscape', projectId: 'project', sequenceId: 'sequence', photoCount: 2 },
		'photoCount', { enumerable: true, get() { getters++; return 2; } });
	input.saveFile = () => { writes++; throw Symbol('must not write'); }; await assert.rejects(new PhotoFramescaperHandoffDownload().startCollection(input));
	assert.equal(writes, 0); assert.equal(getters, 0);
});
