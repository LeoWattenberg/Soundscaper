import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';

import {
	APP_ORIGIN,
	MAX_READ_CAPABILITIES_PER_OWNER,
	MAX_READ_CAPABILITY_BYTES_PER_OWNER,
	READ_CAPABILITY_PREFIX,
} from './constants.js';
import { mimeTypeForPath } from './validation.js';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export class ReadCapabilityStore {
	#cleanupErrors = [];
	#disposed = false;
	#disposePromise = null;
	#entries = new Map();
	#maximumBytes;
	#maximumCount;
	#now;
	#open;
	#operations = new Set();
	#ownerStates = new WeakMap();
	#randomBytes;
	#revocations = new Set();
	#ttlMs;

	constructor({
		ttlMs = DEFAULT_TTL_MS,
		now = Date.now,
		openImpl = open,
		randomBytesImpl = randomBytes,
		maximumCount = MAX_READ_CAPABILITIES_PER_OWNER,
		maximumBytes = MAX_READ_CAPABILITY_BYTES_PER_OWNER,
	} = {}) {
		this.#ttlMs = ttlMs;
		this.#now = now;
		this.#open = openImpl;
		this.#randomBytes = randomBytesImpl;
		this.#maximumCount = boundedLimit(
			maximumCount,
			MAX_READ_CAPABILITIES_PER_OWNER,
			'Read capability count',
			{ allowZero: false },
		);
		this.#maximumBytes = boundedLimit(
			maximumBytes,
			MAX_READ_CAPABILITY_BYTES_PER_OWNER,
			'Read capability aggregate bytes',
		);
	}

	registerPath(filePath, { owner, mimeType, displayName } = {}) {
		let state;
		try {
			if (this.#disposed) throw new Error('Read capability store is disposed');
			state = this.#ownerState(owner);
			if (state.revoked) throw new Error('Read capability owner was revoked');
			this.#sweepExpired(state);
			if (state.count >= this.#maximumCount) {
				throw new RangeError(`Read capability count exceeds the per-owner limit of ${this.#maximumCount}`);
			}
			state.count += 1;
		} catch (error) {
			return Promise.reject(error);
		}
		return this.#trackOperation(
			() => this.#registerPath(filePath, { owner, mimeType, displayName }, state),
			state,
		);
	}

	get(id) {
		const entry = this.#entries.get(String(id || ''));
		if (!entry) return null;
		if (entry.expiresAt <= this.#now()) {
			void this.#releaseEntry(entry).catch(() => undefined);
			return null;
		}
		return entry;
	}

	release(id, { owner } = {}) {
		try {
			requireOwner(owner);
			const entry = this.#entries.get(String(id || ''));
			if (!entry) return Promise.resolve(false);
			if (entry.owner !== owner) return Promise.resolve(false);
			return this.#releaseEntry(entry);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	revokeOwner(owner) {
		let state;
		try {
			state = this.#ownerState(owner);
			if (state.revocation) return state.revocation;
			if (this.#disposed) return this.#disposePromise ?? Promise.resolve();
			state.revoked = true;
		} catch (error) {
			return Promise.reject(error);
		}
		const releases = [...this.#entries.values()]
			.filter((entry) => entry.owner === owner)
			.map((entry) => this.#releaseEntry(entry));
		state.revocation = this.#revokeOwner(state, releases);
		const completion = state.revocation.then(() => undefined, () => undefined);
		this.#revocations.add(completion);
		void completion.then(() => this.#revocations.delete(completion));
		return state.revocation;
	}

	dispose() {
		if (this.#disposePromise) return this.#disposePromise;
		this.#disposed = true;
		const releases = [...this.#entries.values()].map((entry) => this.#releaseEntry(entry));
		this.#disposePromise = this.#dispose(releases);
		return this.#disposePromise;
	}

	async #registerPath(filePath, { owner, mimeType, displayName }, state) {
		let handle = null;
		let accountedBytes = 0;
		try {
			handle = await this.#open(filePath, 'r');
			this.#assertAdmissionActive(state);
			const details = await handle.stat();
			if (!details.isFile()) throw new TypeError('Selected input is not a regular file');
			const size = safeFileSize(details.size);
			this.#assertAdmissionActive(state);
			this.#sweepExpired(state);
			if (size > this.#maximumBytes - state.bytes) {
				throw new RangeError(`Read capability bytes exceed the per-owner limit of ${this.#maximumBytes}`);
			}
			const id = this.#newId();
			const name = cleanDisplayName(displayName || basename(filePath));
			const entry = {
				id,
				handle,
				owner,
				state,
				name,
				size,
				mimeType: mimeType || mimeTypeForPath(filePath),
				lastModified: Math.trunc(details.mtimeMs),
				expiresAt: this.#now() + this.#ttlMs,
				timer: null,
			};
			const descriptor = descriptorFor(entry);
			entry.timer = setTimeout(() => {
				void this.#releaseEntry(entry).catch(() => undefined);
			}, this.#ttlMs);
			entry.timer.unref?.();
			state.bytes += size;
			accountedBytes = size;
			this.#entries.set(id, entry);
			handle = null;
			return descriptor;
		} catch (error) {
			if (!handle) {
				state.count -= 1;
				state.bytes -= accountedBytes;
				throw error;
			}
			try {
				await this.#closeHandle(handle, state);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Read capability admission and candidate-handle cleanup both failed',
					{ cause: cleanupError },
				);
			}
			state.count -= 1;
			state.bytes -= accountedBytes;
			throw error;
		}
	}

	async #revokeOwner(state, releases) {
		await Promise.allSettled(releases);
		await Promise.all([...state.operations]);
		if (state.cleanupErrors.length) {
			throw new AggregateError([...state.cleanupErrors], 'Renderer read capability cleanup failed');
		}
	}

	async #dispose(releases) {
		await Promise.allSettled(releases);
		await Promise.all([...this.#operations, ...this.#revocations]);
		if (this.#cleanupErrors.length) {
			throw new AggregateError([...this.#cleanupErrors], 'Desktop read capability cleanup failed');
		}
	}

	#releaseEntry(entry) {
		if (this.#entries.get(entry.id) !== entry) return Promise.resolve(false);
		this.#entries.delete(entry.id);
		clearTimeout(entry.timer);
		return this.#trackOperation(async () => {
			await this.#closeHandle(entry.handle, entry.state);
			entry.state.count -= 1;
			entry.state.bytes -= entry.size;
			return true;
		}, entry.state);
	}

	async #closeHandle(handle, state) {
		try {
			await handle.close();
		} catch (error) {
			const cleanupError = new Error('Could not close the desktop read capability', { cause: error });
			this.#cleanupErrors.push(cleanupError);
			state.cleanupErrors.push(cleanupError);
			throw cleanupError;
		}
	}

	#sweepExpired(state) {
		const now = this.#now();
		for (const entry of this.#entries.values()) {
			if (entry.state === state && entry.expiresAt <= now) {
				void this.#releaseEntry(entry).catch(() => undefined);
			}
		}
	}

	#assertAdmissionActive(state) {
		if (this.#disposed) throw new Error('Read capability store is disposed');
		if (state.revoked) throw new Error('Read capability owner was revoked');
	}

	#ownerState(owner) {
		requireOwner(owner);
		let state = this.#ownerStates.get(owner);
		if (!state) {
			state = {
				owner,
				bytes: 0,
				cleanupErrors: [],
				count: 0,
				operations: new Set(),
				revocation: null,
				revoked: false,
			};
			this.#ownerStates.set(owner, state);
		}
		return state;
	}

	#trackOperation(operation, state) {
		let markComplete;
		const completion = new Promise((resolve) => { markComplete = resolve; });
		this.#operations.add(completion);
		state.operations.add(completion);
		let result;
		try {
			result = operation();
		} catch (error) {
			this.#operations.delete(completion);
			state.operations.delete(completion);
			markComplete();
			return Promise.reject(error);
		}
		return Promise.resolve(result).finally(() => {
			this.#operations.delete(completion);
			state.operations.delete(completion);
			markComplete();
		});
	}

	#newId() {
		let id;
		do id = this.#randomBytes(32).toString('hex'); while (this.#entries.has(id));
		return id;
	}
}

export async function throwAfterReadCapabilityRollback(store, descriptors, owner, cause) {
	const results = await Promise.allSettled(
		descriptors.map((descriptor) => store.release(descriptor.id, { owner })),
	);
	const cleanupErrors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
	if (!cleanupErrors.length) throw cause;
	throw new AggregateError(
		[cause, ...cleanupErrors],
		'Read capability registration and rollback cleanup both failed',
		{ cause },
	);
}

function requireOwner(owner) {
	if ((typeof owner !== 'object' || owner === null) && typeof owner !== 'function') {
		throw new TypeError('Read capabilities require an opaque renderer owner');
	}
	return owner;
}

function boundedLimit(value, maximum, label, { allowZero = true } = {}) {
	if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > maximum) {
		throw new RangeError(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} integer no greater than ${maximum}`);
	}
	return value;
}

function safeFileSize(value) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('Selected file size must be a non-negative safe integer');
	}
	return value;
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
