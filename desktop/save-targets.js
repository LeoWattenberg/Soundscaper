import { randomBytes } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
	MAX_SAVE_CHUNK_BYTES,
	MAX_SAVE_BYTES,
} from './constants.js';
import { validateDeclaredSize } from './validation.js';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export class SaveTargetStore {
	#disposed = false;
	#entries = new Map();
	#now;
	#randomBytes;
	#ttlMs;

	constructor({ ttlMs = DEFAULT_TTL_MS, now = Date.now, randomBytesImpl = randomBytes } = {}) {
		this.#ttlMs = ttlMs;
		this.#now = now;
		this.#randomBytes = randomBytesImpl;
	}

	registerPath(filePath, { purpose } = {}) {
		if (this.#disposed) throw new Error('Save target store is disposed');
		const id = this.#newId();
		const entry = { id, path: filePath, name: basename(filePath), purpose, expiresAt: this.#now() + this.#ttlMs, timer: null };
		entry.timer = setTimeout(() => this.release(id), this.#ttlMs);
		entry.timer.unref?.();
		this.#entries.set(id, entry);
		return Object.freeze({ id, name: entry.name });
	}

	consume(id) {
		const entry = this.#entries.get(String(id || ''));
		if (!entry || entry.expiresAt <= this.#now()) {
			if (entry) this.release(entry.id);
			return null;
		}
		this.#entries.delete(entry.id);
		clearTimeout(entry.timer);
		return entry;
	}

	release(id) {
		const entry = this.#entries.get(String(id || ''));
		if (!entry) return false;
		this.#entries.delete(entry.id);
		clearTimeout(entry.timer);
		return true;
	}

	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const id of [...this.#entries.keys()]) this.release(id);
	}

	#newId() {
		let id;
		do id = this.#randomBytes(24).toString('hex'); while (this.#entries.has(id));
		return id;
	}
}

export class AtomicSaveManager {
	#cleanupErrors = [];
	#closing = false;
	#disposePromise = null;
	#open;
	#operations = new Set();
	#randomBytes;
	#rename;
	#sessions = new Map();
	#targets;
	#unlink;

	constructor({ targets, openImpl = open, renameImpl = rename, unlinkImpl = unlink, randomBytesImpl = randomBytes } = {}) {
		if (!targets) throw new TypeError('A SaveTargetStore is required');
		this.#targets = targets;
		this.#open = openImpl;
		this.#rename = renameImpl;
		this.#unlink = unlinkImpl;
		this.#randomBytes = randomBytesImpl;
	}

	begin(options) {
		return this.#admit(() => this.#begin(options));
	}

	async #begin({ targetId, size, maximumSize }) {
		const exactSize = size !== undefined;
		if (exactSize === (maximumSize !== undefined)) {
			throw new RangeError('A save requires exactly one exact size or admitted maximum');
		}
		const admittedSize = validateDeclaredSize(exactSize ? size : maximumSize);
		const target = this.#targets.consume(targetId);
		if (!target) throw new Error('Save target expired or was already used');
		if (!exactSize && target.purpose !== 'project') {
			throw new Error('Bounded streaming is restricted to project save targets');
		}
		const writeId = this.#newId();
		const temporaryPath = join(dirname(target.path), `.${basename(target.path)}.${writeId}.soundscaper-part`);
		let handle;
		try {
			handle = await this.#open(temporaryPath, 'wx', 0o600);
		} catch (error) {
			throw new Error('Could not create the temporary save file', { cause: error });
		}
		this.#sessions.set(writeId, {
			id: writeId,
			targetPath: target.path,
			temporaryPath,
			handle,
			exactSize,
			admittedSize,
			written: 0,
			busy: false,
			idle: Promise.resolve(),
		});
		return Object.freeze({ writeId, chunkSize: MAX_SAVE_CHUNK_BYTES });
	}

	writeChunk(options) {
		return this.#admit(() => this.#writeChunk(options));
	}

	async #writeChunk({ writeId, offset, bytes }) {
		const session = this.#session(writeId);
		if (session.busy) throw new Error('Concurrent save writes are not allowed');
		const buffer = toBuffer(bytes);
		if (buffer.byteLength > MAX_SAVE_CHUNK_BYTES) throw new RangeError('Save chunk is too large');
		if (!Number.isSafeInteger(offset) || offset !== session.written) throw new RangeError('Save chunk offset is out of sequence');
		if (buffer.byteLength > session.admittedSize - session.written) {
			throw new RangeError(session.exactSize
				? 'Save exceeds its declared size'
				: 'Save exceeds its admitted maximum');
		}
		let markIdle;
		session.idle = new Promise((resolve) => { markIdle = resolve; });
		session.busy = true;
		try {
			let cursor = 0;
			while (cursor < buffer.byteLength) {
				const result = await session.handle.write(buffer, cursor, buffer.byteLength - cursor, session.written + cursor);
				if (!result.bytesWritten) throw new Error('Save write made no progress');
				cursor += result.bytesWritten;
			}
			session.written += buffer.byteLength;
			return Object.freeze({ nextOffset: session.written });
		} finally {
			session.busy = false;
			markIdle();
		}
	}

	finish(writeId) {
		return this.#admit(() => this.#finish(writeId));
	}

	async #finish(writeId) {
		const session = this.#session(writeId);
		if (session.busy) throw new Error('Save write is still in progress');
		if (session.exactSize && session.written !== session.admittedSize) {
			throw new Error('Save ended before the declared size was written');
		}
		this.#sessions.delete(session.id);
		let handleClosed = false;
		try {
			await session.handle.sync();
			await session.handle.close();
			handleClosed = true;
			await this.#rename(session.temporaryPath, session.targetPath);
			return Object.freeze({ byteLength: session.written });
		} catch (error) {
			await this.#cleanupSession(session, { closeHandle: !handleClosed });
			throw new Error('Could not commit the saved file', { cause: error });
		}
	}

	abort(writeId) {
		return this.#admit(() => this.#abort(writeId));
	}

	async #abort(writeId) {
		const session = this.#sessions.get(String(writeId || ''));
		if (!session) return false;
		if (session.busy) await session.idle;
		if (this.#sessions.get(session.id) !== session) return false;
		this.#sessions.delete(session.id);
		await this.#cleanupSession(session);
		return true;
	}

	abortAll() {
		return this.#admit(() => this.#abortAll());
	}

	dispose() {
		if (this.#disposePromise) return this.#disposePromise;
		this.#closing = true;
		this.#targets.dispose();
		this.#disposePromise = this.#dispose();
		return this.#disposePromise;
	}

	#admit(operation) {
		if (this.#closing) return Promise.reject(new Error('Save manager is shutting down'));
		let markComplete;
		// Disposal drains failures too without taking ownership of the caller's error.
		const completion = new Promise((resolve) => { markComplete = resolve; });
		this.#operations.add(completion);
		let result;
		try {
			result = operation();
		} catch (error) {
			this.#operations.delete(completion);
			markComplete();
			return Promise.reject(error);
		}
		return Promise.resolve(result).finally(() => {
			this.#operations.delete(completion);
			markComplete();
		});
	}

	async #abortAll() {
		await Promise.all([...this.#sessions.keys()].map((id) => this.#abort(id)));
	}

	async #dispose() {
		await Promise.all([...this.#operations]);
		await this.#abortAll();
		if (this.#cleanupErrors.length) {
			throw new AggregateError([...this.#cleanupErrors], 'Desktop save staging cleanup failed');
		}
	}

	async #cleanupSession(session, { closeHandle = true } = {}) {
		const errors = [];
		if (closeHandle) {
			try {
				await session.handle.close();
			} catch (error) {
				errors.push(new Error('Could not close the temporary save file', { cause: error }));
			}
		}
		try {
			await this.#unlink(session.temporaryPath);
		} catch (error) {
			if (!isMissingPathError(error)) {
				errors.push(new Error('Could not remove the temporary save file', { cause: error }));
			}
		}
		this.#cleanupErrors.push(...errors);
		return errors;
	}

	#session(id) {
		const session = this.#sessions.get(String(id || ''));
		if (!session) throw new Error('Unknown save session');
		return session;
	}

	#newId() {
		let id;
		do id = this.#randomBytes(16).toString('hex'); while (this.#sessions.has(id));
		return id;
	}
}

function toBuffer(value) {
	if (value instanceof ArrayBuffer) return Buffer.from(value);
	if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	throw new TypeError('Save chunks must be binary data');
}

function isMissingPathError(error) {
	return error && typeof error === 'object' && error.code === 'ENOENT';
}

export const SAVE_LIMITS = Object.freeze({ chunkBytes: MAX_SAVE_CHUNK_BYTES, totalBytes: MAX_SAVE_BYTES });
