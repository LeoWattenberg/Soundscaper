import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';

import { APP_ORIGIN, READ_CAPABILITY_PREFIX } from './constants.js';
import { mimeTypeForPath } from './validation.js';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export class ReadCapabilityStore {
	#entries = new Map();
	#now;
	#open;
	#randomBytes;
	#ttlMs;

	constructor({ ttlMs = DEFAULT_TTL_MS, now = Date.now, openImpl = open, randomBytesImpl = randomBytes } = {}) {
		this.#ttlMs = ttlMs;
		this.#now = now;
		this.#open = openImpl;
		this.#randomBytes = randomBytesImpl;
	}

	async registerPath(filePath, { mimeType, displayName } = {}) {
		const handle = await this.#open(filePath, 'r');
		try {
			const details = await handle.stat();
			if (!details.isFile()) throw new TypeError('Selected input is not a regular file');
			const id = this.#newId();
			const name = cleanDisplayName(displayName || basename(filePath));
			const entry = {
				id,
				handle,
				name,
				size: details.size,
				mimeType: mimeType || mimeTypeForPath(filePath),
				lastModified: Math.trunc(details.mtimeMs),
				expiresAt: this.#now() + this.#ttlMs,
				timer: null,
			};
			entry.timer = setTimeout(() => { void this.release(id); }, this.#ttlMs);
			entry.timer.unref?.();
			this.#entries.set(id, entry);
			return descriptorFor(entry);
		} catch (error) {
			await handle.close().catch(() => {});
			throw error;
		}
	}

	get(id) {
		const entry = this.#entries.get(String(id || ''));
		if (!entry) return null;
		if (entry.expiresAt <= this.#now()) {
			void this.release(entry.id);
			return null;
		}
		return entry;
	}

	async release(id) {
		const entry = this.#entries.get(String(id || ''));
		if (!entry) return false;
		this.#entries.delete(entry.id);
		clearTimeout(entry.timer);
		await entry.handle.close().catch(() => {});
		return true;
	}

	async dispose() {
		await Promise.all([...this.#entries.keys()].map((id) => this.release(id)));
	}

	#newId() {
		let id;
		do id = this.#randomBytes(32).toString('hex'); while (this.#entries.has(id));
		return id;
	}
}

function descriptorFor(entry) {
	return Object.freeze({
		id: entry.id,
		url: `${APP_ORIGIN}${READ_CAPABILITY_PREFIX}${entry.id}/${encodeURIComponent(entry.name)}`,
		name: entry.name,
		size: entry.size,
		mimeType: entry.mimeType,
		lastModified: entry.lastModified,
	});
}

function cleanDisplayName(value) {
	const name = String(value || 'file').replace(/[\u0000-\u001f/\\]/gu, '-').slice(0, 255);
	return name || 'file';
}
