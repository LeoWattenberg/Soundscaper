import { effectiveAup4SaveLimit } from './aup4-profile.js';

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
	constructor({ worker, workerFactory = defaultWorkerFactory } = {}) {
		this.worker = worker || workerFactory();
		this.sequence = 0;
		this.pending = new Map();
		this.disposed = false;
		this.onMessage = (event) => this.#handleMessage(event.data || {});
		this.onError = (event) => this.#handleFatal(event.error || new Error(event.message || 'The AUP4 worker stopped.'));
		this.worker.addEventListener('message', this.onMessage);
		this.worker.addEventListener('error', this.onError);
	}

	initialize(options = {}) { return this.call('initialize', {}, options); }
	create(projectId, options = {}) { return this.call('create', { projectId }, options); }
	openFile(projectId, file, options = {}) {
		return this.call('open-file', { projectId, file, ...deviceOptions(options) }, options);
	}
	inspect(projectId, options = {}) { return this.call('inspect', { projectId, options: options.validation }, options); }
	decode(projectId, options = {}) {
		return this.call('decode', {
			projectId,
			title: options.title,
			maxDecodedBytes: options.maxDecodedBytes,
		}, options);
	}
	writeDocument(projectId, encoded, options = {}) {
		const transfer = [];
		const transferableEncoded = cloneBinaryRecord(encoded, transfer);
		const sampleBlocks = (options.sampleBlocks || []).map((block) => cloneBinaryRecord(block, transfer));
		return this.call('write-document', {
			projectId,
			encoded: transferableEncoded,
			autosave: options.autosave !== false,
			sampleBlocks,
		}, { ...options, transfer });
	}
	writeSnapshot(projectId, project, sources, options = {}) {
		const transfer = [];
		const transferableSources = (sources || []).map((source) => ({
			...source,
			channels: (source.channels || []).map((channel) => {
				const copy = Float32Array.from(channel);
				transfer.push(copy.buffer);
				return copy;
			}),
		}));
		return this.call('write-snapshot', {
			projectId,
			project,
			sources: transferableSources,
			autosave: options.autosave !== false,
			...deviceOptions(options),
		}, { ...options, transfer });
	}
	commit(projectId, options = {}) { return this.call('commit', { projectId, now: timestamp(options.now) }, options); }
	restoreHistory(projectId, generation, options = {}) { return this.call('restore-history', { projectId, generation }, options); }
	history(projectId, options = {}) { return this.call('history', { projectId }, options); }
	readBlock(projectId, blockId, options = {}) { return this.call('read-block', { projectId, blockId }, options); }
	export(projectId, options = {}) {
		return this.call('export', {
			projectId,
			commit: options.commit !== false,
			now: timestamp(options.now),
			...deviceOptions(options),
		}, options);
	}
	close(projectId, options = {}) { return this.call('close', { projectId }, options); }
	delete(projectId, options = {}) { return this.call('delete', { projectId }, options); }
	listOpen(options = {}) { return this.call('list-open', {}, options); }

	call(type, args = {}, options = {}) {
		if (this.disposed) return Promise.reject(new Aup4ClientError('The AUP4 client has been disposed.', 'DISPOSED'));
		const id = `aup4-${Date.now().toString(36)}-${++this.sequence}`;
		return new Promise((resolve, reject) => {
			const signal = options.signal;
			const abort = () => {
				this.worker.postMessage({ type: 'cancel', id });
				this.#settle(id, false, new Aup4ClientError('The AUP4 operation was cancelled.', 'ABORTED'));
			};
			if (signal?.aborted) {
				reject(new Aup4ClientError('The AUP4 operation was cancelled.', 'ABORTED'));
				return;
			}
			this.pending.set(id, { resolve, reject, onProgress: options.onProgress, signal, abort });
			signal?.addEventListener('abort', abort, { once: true });
			this.worker.postMessage({ id, type, args }, options.transfer || []);
		});
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.worker.removeEventListener('message', this.onMessage);
		this.worker.removeEventListener('error', this.onError);
		this.worker.terminate?.();
		this.#handleFatal(new Aup4ClientError('The AUP4 client was disposed.', 'DISPOSED'));
	}

	#handleMessage(message) {
		const pending = this.pending.get(message.id);
		if (!pending) return;
		if (message.progress) {
			pending.onProgress?.(message.progress);
			return;
		}
		if (message.error) {
			this.#settle(message.id, false, new Aup4ClientError(message.error.message, message.error.code, {
				name: message.error.name,
				details: message.error.details,
			}));
		} else this.#settle(message.id, true, message.result);
	}

	#settle(id, success, value) {
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		pending.signal?.removeEventListener('abort', pending.abort);
		(success ? pending.resolve : pending.reject)(value);
	}

	#handleFatal(error) {
		for (const id of [...this.pending.keys()]) this.#settle(id, false, error);
	}
}

export async function saveAup4Result(result, options = {}) {
	const bytes = result?.bytes;
	if (!(bytes instanceof Uint8Array)) throw new TypeError('A native AUP4 byte array is required.');
	const fileName = ensureAup4Extension(options.fileName || 'audacity-project.aup4');
	if (options.fileService?.saveFile) {
		return options.fileService.saveFile({
			purpose: 'project',
			suggestedName: fileName,
			mimeType: result.mimeType || 'application/x-audacity-project',
			blob: new Blob([bytes], { type: result.mimeType || 'application/x-audacity-project' }),
			target: options.saveTarget ?? options.fileHandle ?? { browserDownload: true, name: fileName },
		});
	}
	if (options.fileHandle?.createWritable) {
		const writable = await options.fileHandle.createWritable();
		try {
			await writable.write(bytes);
			await writable.close();
		} catch (error) {
			await writable.abort?.().catch(() => undefined);
			throw error;
		}
		return { method: 'file-system-access', fileName, size: bytes.byteLength };
	}
	const blob = new Blob([bytes], { type: result.mimeType || 'application/x-audacity-project' });
	const url = URL.createObjectURL(blob);
	try {
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = fileName;
		anchor.hidden = true;
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
	} finally {
		globalThis.setTimeout(() => URL.revokeObjectURL(url), 30_000);
	}
	return { method: 'download', fileName, size: bytes.byteLength };
}

export async function requestAup4FileHandle(options = {}) {
	if (options.fileHandle?.createWritable) return options.fileHandle;
	if (typeof globalThis.showSaveFilePicker !== 'function') return null;
	return globalThis.showSaveFilePicker({
		suggestedName: ensureAup4Extension(options.fileName || 'audacity-project.aup4'),
		types: [{
			description: 'Audacity 4 project',
			accept: { 'application/x-audacity-project': ['.aup4'] },
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

function cloneBinaryRecord(value, transfer) {
	if (!value || typeof value !== 'object') return value;
	if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
		const bytes = value instanceof ArrayBuffer
			? new Uint8Array(value)
			: new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		const copy = bytes.slice();
		transfer.push(copy.buffer);
		return copy;
	}
	if (Array.isArray(value)) return value.map((entry) => cloneBinaryRecord(entry, transfer));
	return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneBinaryRecord(entry, transfer)]));
}

function timestamp(value) {
	if (value == null) return Date.now();
	const number = value instanceof Date ? value.getTime() : Number(value);
	if (!Number.isFinite(number)) throw new TypeError('A valid AUP4 timestamp is required.');
	return number;
}

function ensureAup4Extension(value) {
	const name = String(value || '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/[. ]+$/g, '') || 'audacity-project';
	return /\.aup4$/i.test(name) ? name : `${name}.aup4`;
}
