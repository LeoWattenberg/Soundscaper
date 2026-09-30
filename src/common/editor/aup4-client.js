import { effectiveAup4SaveLimit } from './aup4-profile.js';
import { WorkerRequestBroker } from './worker-request-broker.ts';
import { createWorkerRequestId } from './worker-protocol.ts';
import { selectedRangeDescriptorForBlob } from './desktop-selected-range-blob.ts';

export class Aup4ClientError extends Error {
	constructor(message, code = 'AUP4_CLIENT_ERROR', options = {}) {
		super(message, options);
		this.name = options.name || 'Aup4ClientError';
		this.code = code;
		this.details = options.details || null;
	}
}

export function createAup4Client(options = {}) {
	return new Aup4WorkerClient(options);
}

export class Aup4WorkerClient {
	constructor({
		worker,
		workerFactory = defaultWorkerFactory,
		timeoutMs,
		setTimeout,
		clearTimeout,
	} = {}) {
		this.worker = worker || workerFactory();
		this.sequence = 0;
		this.requests = new WorkerRequestBroker({ timeoutMs, setTimeout, clearTimeout });
		// Retain the diagnostic surface used by existing tests and integrations.
		this.pending = this.requests.entries;
		this.disposed = false;
		this.onMessage = (event) => this.#handleMessage(event.data || {});
		this.onError = (event) => this.#handleFatal(event.error || new Error(event.message || 'The Audacity-project worker stopped.'));
		this.onMessageError = () => this.#handleFatal(new Error('The Audacity-project worker sent an unreadable message.'));
		this.worker.addEventListener('message', this.onMessage);
		this.worker.addEventListener('error', this.onError);
		this.worker.addEventListener('messageerror', this.onMessageError);
	}

	initialize(options = {}) { return this.call('initialize', {}, options); }
	create(projectId, options = {}) {
		return this.call('create', {
			projectId,
			...(options.targetGeneration == null
				? {}
				: { targetGeneration: audacityProjectGeneration(options.targetGeneration) }),
		}, options);
	}
	openFile(projectId, file, options = {}) {
		const desktopRange = file instanceof Blob ? selectedRangeDescriptorForBlob(file) : null;
		return this.call('open-file', { projectId, ...(desktopRange ? { desktopRange } : { file }), ...deviceOptions(options) }, options);
	}
	planImport(projectId, options = {}) {
		return this.call('plan-import', { projectId, title: options.title }, options);
	}
	async *readSourceChunks(projectId, sourceId, options = {}) {
		for (let index = 0; ; index += 1) {
			const result = await this.call('read-import-chunk', { projectId, sourceId, index }, options);
			if (result.done) return;
			yield result.channels;
		}
	}
	async writeSnapshot(projectId, project, sources, options = {}) {
		let snapshotId;
		try {
			const started = await this.call('begin-snapshot', {
				projectId,
				project,
				autosave: options.autosave !== false,
				...deviceOptions(options),
			}, options);
			snapshotId = started.snapshotId;
			for await (const source of snapshotSourceIterable(sources, options.signal)) {
				const transfer = [];
				const transferableSource = cloneSnapshotSource(source, transfer);
				await this.call('append-snapshot-source', {
					projectId,
					snapshotId,
					source: transferableSource,
				}, { ...options, transfer });
			}
			return await this.call('finalize-snapshot', { projectId, snapshotId }, options);
		} catch (error) {
			if (snapshotId && !this.disposed) {
				await this.call('abort-snapshot', { projectId, snapshotId }).catch(() => undefined);
			}
			throw error;
		}
	}
	commit(projectId, options = {}) { return this.call('commit', { projectId, now: timestamp(options.now) }, options); }
	export(projectId, options = {}) {
		return this.call('export', {
			projectId,
			commit: options.commit !== false,
			now: timestamp(options.now),
			...deviceOptions(options),
		}, options);
	}
	delete(projectId, options = {}) { return this.call('delete', { projectId }, options); }

	call(type, args = {}, options = {}) {
		if (this.disposed) return Promise.reject(new Aup4ClientError('The Audacity-project client has been disposed.', 'DISPOSED'));
		const id = createWorkerRequestId('aup4', `${Date.now().toString(36)}-${++this.sequence}`);
		return this.requests.request({
			id,
			signal: options.signal,
			timeoutMs: options.timeoutMs,
			context: { onProgress: options.onProgress },
			abortError: () => new Aup4ClientError('The Audacity-project operation was cancelled.', 'ABORTED'),
			timeoutError: (timeout) => {
				const error = new Aup4ClientError(`The Audacity-project worker received no activity for ${timeout} milliseconds.`, 'TIMEOUT', {
					name: 'TimeoutError',
				});
				return error;
			},
			onAbort: () => this.worker.postMessage({ type: 'cancel', id }),
			onTimeout: () => this.worker.postMessage({ type: 'cancel', id }),
			post: () => this.worker.postMessage({ id, type, args }, options.transfer || []),
		});
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.worker.removeEventListener('message', this.onMessage);
		this.worker.removeEventListener('error', this.onError);
		this.worker.removeEventListener('messageerror', this.onMessageError);
		try {
			this.worker.terminate?.();
		} finally {
			this.requests.dispose(new Aup4ClientError('The Audacity-project client was disposed.', 'DISPOSED'));
		}
	}

	#handleMessage(message) {
		const pending = this.requests.get(message.id);
		if (!pending) return;
		if (message.progress) {
			this.requests.touch(message.id);
			try {
				pending.context?.onProgress?.(message.progress);
			} catch (error) {
				this.requests.reject(message.id, error);
			}
			return;
		}
		if (message.error) {
			this.requests.reject(message.id, new Aup4ClientError(message.error.message, message.error.code, {
				name: message.error.name,
				details: message.error.details,
			}));
		} else this.requests.resolve(message.id, message.result);
	}

	#handleFatal(error) {
		this.requests.rejectAll(error);
	}
}

export async function saveAup4Result(result, options = {}) {
	return saveAudacityProjectResult(result, { ...options, targetGeneration: 'aup4' });
}

export async function saveAup3Result(result, options = {}) {
	return saveAudacityProjectResult(result, { ...options, targetGeneration: 'aup3' });
}

async function saveAudacityProjectResult(result, options) {
	const targetGeneration = audacityProjectGeneration(options.targetGeneration);
	const bytes = result?.bytes;
	if (!(bytes instanceof Uint8Array)) throw new TypeError(`A native ${targetGeneration.toUpperCase()} byte array is required.`);
	const fileName = ensureAudacityProjectExtension(
		options.fileName || `audacity-project.${targetGeneration}`,
		targetGeneration,
	);
	return options.fileService.saveFile({
		purpose: targetGeneration === 'aup3' ? 'aup3' : 'project',
		suggestedName: fileName,
		mimeType: result.mimeType || 'application/x-audacity-project',
		blob: new Blob([bytes], { type: result.mimeType || 'application/x-audacity-project' }),
		target: options.saveTarget ?? options.fileHandle ?? { browserDownload: true, name: fileName },
		signal: options.signal,
	});
}

export async function requestAup4FileHandle(options = {}) {
	return requestAudacityProjectFileHandle({ ...options, targetGeneration: 'aup4' });
}

export async function requestAup3FileHandle(options = {}) {
	return requestAudacityProjectFileHandle({ ...options, targetGeneration: 'aup3' });
}

async function requestAudacityProjectFileHandle(options) {
	if (typeof globalThis.showSaveFilePicker !== 'function') return null;
	const targetGeneration = audacityProjectGeneration(options.targetGeneration);
	return globalThis.showSaveFilePicker({
		suggestedName: ensureAudacityProjectExtension(
			options.fileName || `audacity-project.${targetGeneration}`,
			targetGeneration,
		),
		types: [{
			description: targetGeneration === 'aup3' ? 'Audacity 3 project' : 'Audacity interchange',
			accept: { 'application/x-audacity-project': [`.${targetGeneration}`] },
		}],
		excludeAcceptAllOption: false,
	});
}

function defaultWorkerFactory() {
	if (typeof Worker !== 'function') throw new Aup4ClientError('Module workers are unavailable in this browser.', 'WORKER_UNAVAILABLE');
	return new Worker(new URL('./aup4-worker.js', import.meta.url), { type: 'module', name: 'kw-media-audacity-projects' });
}

function deviceOptions(options) {
	const mobile = options.mobile ?? globalThis.matchMedia?.('(max-width: 700px)')?.matches ?? false;
	const deviceMemory = options.deviceMemory ?? globalThis.navigator?.deviceMemory;
	return {
		mobile: Boolean(mobile),
		...(Number.isFinite(Number(deviceMemory)) ? { deviceMemory: Number(deviceMemory) } : {}),
		...(options.quota == null ? {} : { quota: Number(options.quota) }),
		...(options.usage == null ? {} : { usage: Number(options.usage) }),
		workingBytes: Math.max(0, Number(options.workingBytes) || 0),
		maxBytes: options.maxBytes == null ? effectiveAup4SaveLimit({
			opfs: options.opfs !== false,
			mobile,
			deviceMemory,
			...(options.quota == null ? {} : { quota: options.quota }),
			...(options.usage == null ? {} : { usage: options.usage }),
			workingBytes: options.workingBytes,
		}) : Math.max(0, Number(options.maxBytes) || 0),
	};
}

async function* snapshotSourceIterable(sources, signal) {
	if (sources == null) return;
	const iterator = typeof sources[Symbol.asyncIterator] === 'function'
		? sources[Symbol.asyncIterator]()
		: typeof sources[Symbol.iterator] === 'function'
			? sources[Symbol.iterator]()
			: null;
	if (!iterator) throw new TypeError('Audacity-project source audio must be an iterable or async iterable.');
	let complete = false;
	try {
		while (!complete) {
			const next = await nextSnapshotSource(iterator, signal);
			complete = Boolean(next.done);
			if (!complete) yield next.value;
		}
	} finally {
		if (!complete && typeof iterator.return === 'function') {
			const closing = Promise.resolve().then(() => iterator.return());
			if (signal?.aborted) void closing.catch(() => undefined);
			else await closing;
		}
	}
}

function nextSnapshotSource(iterator, signal) {
	if (signal?.aborted) return Promise.reject(abortedSnapshotError());
	if (!signal) return Promise.resolve().then(() => iterator.next());
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', abort);
			callback(value);
		};
		const abort = () => finish(reject, abortedSnapshotError());
		signal.addEventListener('abort', abort, { once: true });
		Promise.resolve().then(() => iterator.next()).then(
			(value) => finish(resolve, value),
			(error) => finish(reject, error),
		);
	});
}

function abortedSnapshotError() {
	return new Aup4ClientError('The Audacity-project operation was cancelled.', 'ABORTED');
}

function cloneSnapshotSource(source, transfer) {
	if (!source || typeof source !== 'object') throw new TypeError('An Audacity-project source audio record is required.');
	if (!Array.isArray(source.channels) || !source.channels.length) {
		throw new TypeError(`Audacity-project source ${source.sourceId || ''} must contain planar channels.`);
	}
	return {
		...source,
		channels: source.channels.map((channel) => {
			if (!(channel instanceof Float32Array) && !ArrayBuffer.isView(channel) && !Array.isArray(channel)) {
				throw new TypeError(`Audacity-project source ${source.sourceId || ''} must contain Float32 samples.`);
			}
			const copy = Float32Array.from(channel);
			transfer.push(copy.buffer);
			return copy;
		}),
	};
}

function timestamp(value) {
	if (value == null) return Date.now();
	const number = value instanceof Date ? value.getTime() : Number(value);
	if (!Number.isFinite(number)) throw new TypeError('A valid Audacity-project timestamp is required.');
	return number;
}

function ensureAudacityProjectExtension(value, targetGeneration) {
	const name = String(value || '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/[. ]+$/g, '') || 'audacity-project';
	const extension = `.${audacityProjectGeneration(targetGeneration)}`;
	return /\.aup[34]$/i.test(name) ? name.replace(/\.aup[34]$/i, extension) : `${name}${extension}`;
}

function audacityProjectGeneration(value) {
	if (value === 'aup3' || value === 'aup4') return value;
	throw new TypeError(`Unsupported Audacity project generation: ${value}.`);
}
