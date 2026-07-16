import assert from 'node:assert/strict';
import test from 'node:test';

import {
	Aup4ClientError,
	createAup4Client,
	requestAup4FileHandle,
	saveAup4Result,
} from '../src/lib/tools/audio-editor/aup4-client.js';

test('AUP4 client routes results, progress, structured errors, and cancellation', async () => {
	const worker = new FakeWorker();
	const client = createAup4Client({ worker });
	try {
		const progress = [];
		const creating = client.create('project-1', { onProgress: (value) => progress.push(value) });
		const createMessage = worker.messages.at(-1);
		worker.emit({ id: createMessage.id, progress: { value: 0.5, phase: 'creating' } });
		worker.emit({ id: createMessage.id, result: { projectId: 'project-1' } });
		assert.deepEqual(await creating, { projectId: 'project-1' });
		assert.deepEqual(progress, [{ value: 0.5, phase: 'creating' }]);

		const inspection = client.inspect('project-1');
		const inspectMessage = worker.messages.at(-1);
		worker.emit({ id: inspectMessage.id, error: { name: 'Aup4Error', message: 'Unsafe schema', code: 'UNSAFE_SCHEMA', details: { table: 'x' } } });
		await assert.rejects(inspection, (error) => error instanceof Aup4ClientError && error.code === 'UNSAFE_SCHEMA' && error.details.table === 'x');

		const abortController = new AbortController();
		const opening = client.openFile('project-2', new File(['SQLite'], 'project.aup4'), { signal: abortController.signal });
		const openMessage = worker.messages.at(-1);
		abortController.abort();
		await assert.rejects(opening, (error) => error.code === 'ABORTED');
		assert.deepEqual(worker.messages.at(-1), { type: 'cancel', id: openMessage.id });

		const alreadyAborted = new AbortController();
		alreadyAborted.abort();
		const messageCount = worker.messages.length;
		await assert.rejects(client.inspect('project-1', { signal: alreadyAborted.signal }), (error) => error.code === 'ABORTED');
		assert.equal(worker.messages.length, messageCount);
		worker.emit({ id: openMessage.id, result: { shouldBeIgnored: true } });
	} finally {
		client.dispose();
	}
});

test('AUP4 client rejects pending operations when the worker fails', async () => {
	const worker = new FakeWorker();
	const client = createAup4Client({ worker });
	const pending = client.initialize();
	worker.fail(new Error('worker crashed'));
	await assert.rejects(pending, /worker crashed/);
	client.dispose();
});

test('AUP4 client cancellation is operation-scoped and quota failures remain structured', async () => {
	const worker = new FakeWorker();
	const client = createAup4Client({ worker });
	try {
		const abortController = new AbortController();
		const opening = client.openFile('project-1', new File(['SQLite'], 'large.aup4'), {
			opfs: false,
			signal: abortController.signal,
		});
		const openMessage = worker.messages.at(-1);
		assert.equal(openMessage.args.maxBytes, 64 * 1024 * 1024);

		const history = client.history('project-1');
		const historyMessage = worker.messages.at(-1);
		abortController.abort();
		await assert.rejects(opening, (error) => error.code === 'ABORTED');
		worker.emit({ id: historyMessage.id, result: [{ generation: 1, savedAt: 1 }] });
		assert.deepEqual(await history, [{ generation: 1, savedAt: 1 }]);
		assert.deepEqual(worker.messages.at(-1), { type: 'cancel', id: openMessage.id });

		const exporting = client.export('project-1', { opfs: false });
		const exportMessage = worker.messages.at(-1);
		assert.equal(exportMessage.args.maxBytes, 64 * 1024 * 1024);
		worker.emit({
			id: exportMessage.id,
			error: {
				name: 'Aup4WorkerError',
				message: 'Snapshot exceeds the save limit.',
				code: 'PROJECT_TOO_LARGE',
				details: { limit: 64 * 1024 * 1024, size: 64 * 1024 * 1024 + 1 },
			},
		});
		await assert.rejects(exporting, (error) => (
			error instanceof Aup4ClientError
			&& error.code === 'PROJECT_TOO_LARGE'
			&& error.details.limit === 64 * 1024 * 1024
			&& error.details.size === 64 * 1024 * 1024 + 1
		));
	} finally {
		client.dispose();
	}
});

test('AUP4 file-handle publication aborts the writable on failure', async () => {
	let aborted = false;
	let closed = false;
	const writable = {
		async write() { throw new Error('disk full'); },
		async close() { closed = true; },
		async abort() { aborted = true; },
	};
	await assert.rejects(
		() => saveAup4Result({ bytes: Uint8Array.of(1, 2, 3) }, {
			fileName: 'round-trip',
			fileHandle: { async createWritable() { return writable; } },
		}),
		/disk full/,
	);
	assert.equal(aborted, true);
	assert.equal(closed, false);
});

test('AUP4 publication delegates opaque desktop targets to the injected file service', async () => {
	let request;
	const result = await saveAup4Result({
		bytes: Uint8Array.of(1, 2, 3),
		mimeType: 'application/x-audacity-project',
	}, {
		fileName: 'desktop-copy',
		saveTarget: { id: 'target-1', name: 'desktop-copy.aup4' },
		fileService: {
			async saveFile(value) {
				request = value;
				return { method: 'desktop', fileName: value.target.name, size: value.blob.size };
			},
		},
	});

	assert.equal(request.purpose, 'project');
	assert.equal(request.suggestedName, 'desktop-copy.aup4');
	assert.equal(request.mimeType, 'application/x-audacity-project');
	assert.deepEqual(request.target, { id: 'target-1', name: 'desktop-copy.aup4' });
	assert.deepEqual(new Uint8Array(await request.blob.arrayBuffer()), Uint8Array.of(1, 2, 3));
	assert.deepEqual(result, { method: 'desktop', fileName: 'desktop-copy.aup4', size: 3 });
});

test('AUP4 snapshot PCM is transferred one source at a time and quota/headroom limits reach the worker', async () => {
	const worker = new FakeWorker();
	const client = createAup4Client({ worker });
	try {
		const left = Float32Array.of(-1, 0, 1);
		const right = Float32Array.of(1, 0, -1);
		const writing = client.writeSnapshot('project-1', { sources: [], clips: [], tracks: [] }, [{
			sourceId: 'source-1',
			channels: [left, right],
		}], {
			opfs: true,
			deviceMemory: 8,
			quota: 100 * 1024 * 1024,
			usage: 20 * 1024 * 1024,
			workingBytes: 32 * 1024 * 1024,
		});
		const begin = worker.messages.at(-1);
		assert.equal(begin.type, 'begin-snapshot');
		assert.equal(begin.args.maxBytes, 48 * 1024 * 1024);
		assert.equal(begin.args.sources, undefined);
		assert.equal(worker.transfers.at(-1).length, 0);
		worker.emit({ id: begin.id, result: { snapshotId: 'snapshot-1' } });
		await nextTask();

		const append = worker.messages.at(-1);
		assert.equal(append.type, 'append-snapshot-source');
		assert.equal(append.args.snapshotId, 'snapshot-1');
		assert.equal(worker.transfers.at(-1).length, 2);
		assert.notEqual(append.args.source.channels[0].buffer, left.buffer);
		assert.deepEqual(append.args.source.channels[0], left);
		assert.deepEqual(left, Float32Array.of(-1, 0, 1));
		worker.emit({ id: append.id, result: { sourceId: 'source-1', sampleCount: 6 } });
		await nextTask();

		const finalize = worker.messages.at(-1);
		assert.equal(finalize.type, 'finalize-snapshot');
		assert.deepEqual(finalize.args, { projectId: 'project-1', snapshotId: 'snapshot-1' });
		worker.emit({ id: finalize.id, result: { sampleCount: 6 } });
		assert.deepEqual(await writing, { sampleCount: 6 });
	} finally {
		client.dispose();
	}
});

test('AUP4 snapshot async sources observe awaited per-source backpressure', async () => {
	const worker = new FakeWorker();
	const client = createAup4Client({ worker });
	const requested = [];
	async function* sources() {
		for (let index = 1; index <= 3; index += 1) {
			requested.push(index);
			yield { sourceId: `source-${index}`, channels: [Float32Array.of(index)] };
		}
	}
	try {
		const writing = client.writeSnapshot('project-1', { sources: [], clips: [], tracks: [] }, sources());
		const begin = worker.messages.at(-1);
		assert.deepEqual(requested, []);
		worker.emit({ id: begin.id, result: { snapshotId: 'snapshot-stream' } });
		await nextTask();
		assert.deepEqual(requested, [1]);
		assert.equal(worker.messages.filter((message) => message.type === 'append-snapshot-source').length, 1);

		for (let index = 1; index <= 3; index += 1) {
			const append = worker.messages.at(-1);
			assert.equal(append.args.source.sourceId, `source-${index}`);
			worker.emit({ id: append.id, result: { sourceId: `source-${index}` } });
			await nextTask();
			assert.deepEqual(requested, Array.from({ length: Math.min(3, index + 1) }, (_, offset) => offset + 1));
		}

		const finalize = worker.messages.at(-1);
		assert.equal(finalize.type, 'finalize-snapshot');
		worker.emit({ id: finalize.id, result: { sourceCount: 3 } });
		assert.deepEqual(await writing, { sourceCount: 3 });
	} finally {
		client.dispose();
	}
});

test('AUP4 snapshot failures discard staged worker state without reusing an aborted signal', async () => {
	const worker = new FakeWorker();
	const client = createAup4Client({ worker });
	try {
		const writing = client.writeSnapshot('project-1', { sources: [], clips: [], tracks: [] }, [{
			sourceId: 'source-1', channels: [Float32Array.of(1)],
		}]);
		const begin = worker.messages.at(-1);
		worker.emit({ id: begin.id, result: { snapshotId: 'snapshot-failure' } });
		await nextTask();
		const append = worker.messages.at(-1);
		worker.emit({ id: append.id, error: { message: 'Disk full', code: 'QUOTA_EXCEEDED' } });
		await nextTask();
		const abort = worker.messages.at(-1);
		assert.equal(abort.type, 'abort-snapshot');
		assert.deepEqual(abort.args, { projectId: 'project-1', snapshotId: 'snapshot-failure' });
		worker.emit({ id: abort.id, result: true });
		await assert.rejects(writing, (error) => error.code === 'QUOTA_EXCEEDED');
	} finally {
		client.dispose();
	}
});

test('AUP4 snapshot cancellation interrupts a pending async source producer', async () => {
	const worker = new FakeWorker();
	const client = createAup4Client({ worker });
	const controller = new AbortController();
	let nextCalled = false;
	let returnCalled = false;
	const sources = {
		[Symbol.asyncIterator]() {
			return {
				next() {
					nextCalled = true;
					return new Promise(() => {});
				},
				return() {
					returnCalled = true;
					return { done: true };
				},
			};
		},
	};
	try {
		const writing = client.writeSnapshot('project-1', { sources: [], clips: [], tracks: [] }, sources, {
			signal: controller.signal,
		});
		const begin = worker.messages.at(-1);
		worker.emit({ id: begin.id, result: { snapshotId: 'snapshot-cancel' } });
		await nextTask();
		assert.equal(nextCalled, true);
		controller.abort();
		await nextTask();
		assert.equal(returnCalled, true);
		const abort = worker.messages.at(-1);
		assert.equal(abort.type, 'abort-snapshot');
		worker.emit({ id: abort.id, result: true });
		await assert.rejects(writing, (error) => error.code === 'ABORTED');
	} finally {
		client.dispose();
	}
});

test('AUP4 file picker requests the native extension and remains optional', async () => {
	const original = globalThis.showSaveFilePicker;
	try {
		let pickerOptions;
		const handle = { async createWritable() {} };
		globalThis.showSaveFilePicker = async (options) => {
			pickerOptions = options;
			return handle;
		};
		assert.equal(await requestAup4FileHandle({ fileName: 'session' }), handle);
		assert.equal(pickerOptions.suggestedName, 'session.aup4');
		assert.deepEqual(pickerOptions.types[0].accept, { 'application/x-audacity-project': ['.aup4'] });
		delete globalThis.showSaveFilePicker;
		assert.equal(await requestAup4FileHandle({ fileName: 'fallback' }), null);
	} finally {
		if (original === undefined) delete globalThis.showSaveFilePicker;
		else globalThis.showSaveFilePicker = original;
	}
});

class FakeWorker {
	constructor() {
		this.listeners = new Map();
		this.messages = [];
		this.terminated = false;
		this.transfers = [];
	}
	addEventListener(type, listener) { this.listeners.set(type, listener); }
	removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
	postMessage(message, transfer = []) { this.messages.push(message); this.transfers.push(transfer); }
	emit(data) { this.listeners.get('message')?.({ data }); }
	fail(error) { this.listeners.get('error')?.({ error }); }
	terminate() { this.terminated = true; }
}

function nextTask() {
	return new Promise((resolve) => setImmediate(resolve));
}
