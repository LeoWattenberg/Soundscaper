/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoFramescaperHandoffDownload, type PhotoFramescaperHandoffDownloadRequest, type PhotoFramescaperHandoffTarget } from '../src/lightscaper/controller/photo-framescaper-handoff-download.ts';
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
