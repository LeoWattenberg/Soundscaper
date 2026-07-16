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
	#entries = new Map();
	#now;
	#randomBytes;
	#ttlMs;

	constructor({ ttlMs = DEFAULT_TTL_MS, now = Date.now, randomBytesImpl = randomBytes } = {}) {
		this.#ttlMs = ttlMs;
		this.#now = now;
		this.#randomBytes = randomBytesImpl;
	}

	registerPath(filePath) {
		const id = this.#newId();
		const entry = { id, path: filePath, name: basename(filePath), expiresAt: this.#now() + this.#ttlMs, timer: null };
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
		for (const id of [...this.#entries.keys()]) this.release(id);
	}

	#newId() {
		let id;
		do id = this.#randomBytes(24).toString('hex'); while (this.#entries.has(id));
		return id;
	}
}

export class AtomicSaveManager {
	#open;
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

	async begin({ targetId, size }) {
		const declaredSize = validateDeclaredSize(size);
		const target = this.#targets.consume(targetId);
		if (!target) throw new Error('Save target expired or was already used');
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
			declaredSize,
			written: 0,
			busy: false,
		});
		return Object.freeze({ writeId, chunkSize: MAX_SAVE_CHUNK_BYTES });
	}

	async writeChunk({ writeId, offset, bytes }) {
		const session = this.#session(writeId);
		if (session.busy) throw new Error('Concurrent save writes are not allowed');
		const buffer = toBuffer(bytes);
		if (buffer.byteLength > MAX_SAVE_CHUNK_BYTES) throw new RangeError('Save chunk is too large');
		if (!Number.isSafeInteger(offset) || offset !== session.written) throw new RangeError('Save chunk offset is out of sequence');
		if (session.written + buffer.byteLength > session.declaredSize) throw new RangeError('Save exceeds its declared size');
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
		}
	}

	async finish(writeId) {
		const session = this.#session(writeId);
		if (session.busy) throw new Error('Save write is still in progress');
		if (session.written !== session.declaredSize) throw new Error('Save ended before the declared size was written');
		this.#sessions.delete(session.id);
		try {
			await session.handle.sync();
			await session.handle.close();
			await this.#rename(session.temporaryPath, session.targetPath);
			return Object.freeze({ byteLength: session.written });
		} catch (error) {
			await session.handle.close().catch(() => {});
			await this.#unlink(session.temporaryPath).catch(() => {});
			throw new Error('Could not commit the saved file', { cause: error });
		}
	}

	async abort(writeId) {
		const session = this.#sessions.get(String(writeId || ''));
		if (!session) return false;
		this.#sessions.delete(session.id);
		await session.handle.close().catch(() => {});
		await this.#unlink(session.temporaryPath).catch(() => {});
		return true;
	}

	async dispose() {
		await Promise.all([...this.#sessions.keys()].map((id) => this.abort(id)));
		this.#targets.dispose();
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

export const SAVE_LIMITS = Object.freeze({ chunkBytes: MAX_SAVE_CHUNK_BYTES, totalBytes: MAX_SAVE_BYTES });
