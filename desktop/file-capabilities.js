import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import {
	APP_ORIGIN,
	MAX_READ_CAPABILITIES_PER_OWNER,
	MAX_READ_CAPABILITY_BYTES_PER_OWNER,
	READ_CAPABILITY_PREFIX,
	READ_PROFILE_MATERIALIZED_V1,
	READ_PROFILE_SCAPE_RANGE_V1,
	SCAPE_PROJECT_MIME_TYPE,
} from './constants.js';
import {
	ReadCapabilityAdmissionError,
	boundedReadLimit,
	safeReadFileSize,
	ScapeRangeReadAdmission,
} from './read-capability-admission.js';
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
	#retirements = new Map();
	#scapeRangeAdmission;
	#ttlMs;

	constructor({
		ttlMs = DEFAULT_TTL_MS,
		now = Date.now,
		openImpl = open,
		randomBytesImpl = randomBytes,
		maximumCount = MAX_READ_CAPABILITIES_PER_OWNER,
		maximumBytes = MAX_READ_CAPABILITY_BYTES_PER_OWNER,
		maximumScapeRangeCount,
		maximumScapeRangeBytes,
	} = {}) {
		this.#ttlMs = ttlMs;
		this.#now = now;
		this.#open = openImpl;
		this.#randomBytes = randomBytesImpl;
		this.#maximumCount = boundedReadLimit(
			maximumCount,
			MAX_READ_CAPABILITIES_PER_OWNER,
			'Read capability count',
			{ allowZero: false },
		);
		this.#maximumBytes = boundedReadLimit(
			maximumBytes,
			MAX_READ_CAPABILITY_BYTES_PER_OWNER,
			'Read capability aggregate bytes',
		);
		this.#scapeRangeAdmission = new ScapeRangeReadAdmission({
			maximumCount: maximumScapeRangeCount,
			maximumBytes: maximumScapeRangeBytes,
		});
	}

	registerPath(filePath, { owner, mimeType, displayName } = {}) {
		return this.registerMaterializedPath(filePath, { owner, mimeType, displayName });
	}

	registerMaterializedPath(filePath, { owner, mimeType, displayName } = {}) {
		return this.#admitPath(filePath, { owner, mimeType, displayName }, READ_PROFILE_MATERIALIZED_V1);
	}

	registerScapeRangePath(filePath, { owner } = {}) {
		try {
			const selectedPath = String(filePath || '');
			if (extname(selectedPath).toLowerCase() !== '.scape'
				|| mimeTypeForPath(selectedPath) !== SCAPE_PROJECT_MIME_TYPE) {
				throw new TypeError('Scape range capabilities require a terminal .scape project path');
			}
			return this.#admitPath(selectedPath, {
				owner,
				mimeType: SCAPE_PROJECT_MIME_TYPE,
				displayName: basename(selectedPath),
			}, READ_PROFILE_SCAPE_RANGE_V1);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	#admitPath(filePath, { owner, mimeType, displayName }, readProfile) {
		let state;
		let rangeTicket = null;
		try {
			if (this.#disposed) throw new Error('Read capability store is disposed');
			state = this.#ownerState(owner);
			if (state.revoked) throw new Error('Read capability owner was revoked');
			this.#sweepExpired(state);
			if (state.count >= this.#maximumCount) {
				throw new ReadCapabilityAdmissionError(`Read capability count exceeds the per-owner limit of ${this.#maximumCount}`, { retryable: true });
			}
			state.count += 1;
			try {
				if (readProfile === READ_PROFILE_SCAPE_RANGE_V1) {
					rangeTicket = this.#scapeRangeAdmission.reserve(owner);
				}
			} catch (error) {
				state.count -= 1;
				throw error;
			}
		} catch (error) {
			return Promise.reject(error);
		}
		return this.#trackOperation(() => this.#registerPath(filePath, {
			owner, mimeType, displayName, readProfile, rangeTicket,
		}, state), state);
	}

	get(id) {
		const entry = this.#liveEntry(id);
		return entry ? descriptorFor(entry) : null;
	}

	acquireRequest(id, expectedProfile) {
		const entry = this.#liveEntry(id);
		if (!entry || entry.request
			|| (expectedProfile !== undefined && entry.readProfile !== expectedProfile)) return null;
		const rangeRequest = entry.rangeTicket
			? this.#scapeRangeAdmission.acquireRequest(entry.rangeTicket)
			: null;
		if (entry.rangeTicket && !rangeRequest) return null;
		this.#renewExpiry(entry);
		try {
			return this.#createRequestLease(entry, rangeRequest);
		} catch (error) {
			rangeRequest?.release();
			throw error;
		}
	}

	release(id, { owner } = {}) {
		try {
			requireOwner(owner);
			const key = String(id || '');
			const entry = this.#entries.get(key);
			if (!entry) {
				const retirement = this.#retirements.get(key);
				return retirement?.owner === owner ? retirement.promise : Promise.resolve(false);
			}
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

	async #registerPath(filePath, { owner, mimeType, displayName, readProfile, rangeTicket }, state) {
		let handle = null;
		let accountedBytes = 0;
		try {
			handle = await this.#open(filePath, 'r');
			this.#assertAdmissionActive(state);
			const details = await handle.stat();
			if (!details.isFile()) throw new TypeError('Selected input is not a regular file');
			const size = safeReadFileSize(details.size);
			this.#assertAdmissionActive(state);
			this.#sweepExpired(state);
			if (rangeTicket) {
				this.#scapeRangeAdmission.charge(rangeTicket, size);
			} else {
				if (size > this.#maximumBytes) {
					throw new ReadCapabilityAdmissionError(`Read capability bytes exceed the per-owner limit of ${this.#maximumBytes}`);
				}
				if (size > this.#maximumBytes - state.bytes) {
					throw new ReadCapabilityAdmissionError(`Read capability bytes exceed the per-owner limit of ${this.#maximumBytes}`, { retryable: true });
				}
				state.bytes += size;
				accountedBytes = size;
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
				readProfile,
				rangeTicket,
				lastModified: safeReadTimestamp(details.mtimeMs),
				expiresAt: this.#now() + this.#ttlMs,
				request: null,
				retirement: null,
				timer: null,
			};
			const descriptor = descriptorFor(entry);
			this.#renewExpiry(entry);
			this.#entries.set(id, entry);
			handle = null;
			return descriptor;
		} catch (error) {
			if (!handle) {
				this.#rollbackAdmission(state, rangeTicket, accountedBytes);
				throw error;
			}
			try {
				await this.#closeHandle(handle, state);
			} catch (cleanupError) {
				this.#scapeRangeAdmission.retainAndFence(rangeTicket);
				throw new AggregateError(
					[error, cleanupError],
					'Read capability admission and candidate-handle cleanup both failed',
					{ cause: cleanupError },
				);
			}
			this.#rollbackAdmission(state, rangeTicket, accountedBytes);
			throw error;
		}
	}

	#rollbackAdmission(state, rangeTicket, accountedBytes) {
		state.count -= 1;
		state.bytes -= accountedBytes;
		this.#scapeRangeAdmission.release(rangeTicket);
	}

	async #revokeOwner(state, releases) {
		try {
			await Promise.allSettled(releases);
			await Promise.all([...state.operations]);
			if (state.cleanupErrors.length) {
				throw new AggregateError([...state.cleanupErrors], 'Renderer read capability cleanup failed');
			}
		} finally {
			this.#clearRetirementsForOwner(state.owner);
		}
	}

	async #dispose(releases) {
		try {
			await Promise.allSettled(releases);
			await Promise.all([...this.#operations, ...this.#revocations]);
			if (this.#cleanupErrors.length) {
				throw new AggregateError([...this.#cleanupErrors], 'Desktop read capability cleanup failed');
			}
		} finally {
			this.#retirements.clear();
		}
	}

	#releaseEntry(entry) {
		if (entry.retirement) return entry.retirement.promise;
		if (this.#entries.get(entry.id) !== entry) {
			return this.#retirements.get(entry.id)?.promise ?? Promise.resolve(false);
		}
		this.#entries.delete(entry.id);
		clearTimeout(entry.timer);
		const retirementBarrier = Promise.withResolvers();
		entry.retirement = Object.freeze({
			owner: entry.owner,
			promise: retirementBarrier.promise,
		});
		this.#retirements.set(entry.id, entry.retirement);
		const request = entry.request;
		const operation = this.#trackOperation(async () => {
			const cleanupErrors = [];
			if (request) {
				try {
					await request.close();
				} catch (error) {
					cleanupErrors.push(this.#recordCleanupError(
						'Could not close the active desktop read request',
						error,
						entry.state,
					));
				}
			}
			let handleClosed = false;
			try {
				await this.#closeHandle(entry.handle, entry.state);
				handleClosed = true;
			} catch (error) {
				cleanupErrors.push(error);
			}
			if (handleClosed) {
				entry.state.count -= 1;
				if (!entry.rangeTicket) entry.state.bytes -= entry.size;
			}
			if (entry.rangeTicket) {
				if (handleClosed && cleanupErrors.length === 0) {
					this.#scapeRangeAdmission.release(entry.rangeTicket);
				} else {
					this.#scapeRangeAdmission.retainAndFence(entry.rangeTicket);
				}
			}
			if (cleanupErrors.length === 1) throw cleanupErrors[0];
			if (cleanupErrors.length > 1) {
				throw new AggregateError(cleanupErrors, 'Desktop read capability retirement failed');
			}
			return true;
		}, entry.state);
		void operation.then(
			(value) => {
				retirementBarrier.resolve(value);
				if (this.#retirements.get(entry.id) === entry.retirement) this.#retirements.delete(entry.id);
			},
			retirementBarrier.reject,
		);
		return retirementBarrier.promise;
	}

	async #closeHandle(handle, state) {
		try {
			await handle.close();
		} catch (error) {
			throw this.#recordCleanupError('Could not close the desktop read capability', error, state);
		}
	}

	#recordCleanupError(message, cause, state) {
		const cleanupError = new Error(message, { cause });
		this.#cleanupErrors.push(cleanupError);
		state.cleanupErrors.push(cleanupError);
		return cleanupError;
	}

	#createRequestLease(entry, rangeRequest) {
		const requestBarrier = Promise.withResolvers();
		let completePromise = null;
		let forceClosePromise = null;
		let settled = false;
		let stream = null;
		let streamBarrier = null;
		let streamSettled = false;
		const observeError = () => {
			// Native FileHandle streams emit close after an error; keep the handle leased until then.
			if (!settled) stream.once('error', observeError);
		};
		const settleStream = () => {
			if (streamSettled) return;
			streamSettled = true;
			stream.removeListener?.('end', settleStream);
			stream.removeListener?.('error', observeError);
			stream.removeListener?.('close', settleStream);
			streamBarrier?.resolve();
		};
		const finishRequest = () => {
			if (settled) return;
			settled = true;
			if (entry.request === request) entry.request = null;
			rangeRequest?.release();
			requestBarrier.resolve();
		};
		const createReadStream = (options) => {
			if (settled) throw new Error('Desktop read request lease is closed');
			if (stream) throw new Error('Desktop read request lease already has a stream');
			let candidate;
			try {
				candidate = entry.handle.createReadStream(options);
			} catch (error) {
				finishRequest();
				throw error;
			}
			if (!candidate || typeof candidate.once !== 'function'
				|| typeof candidate.removeListener !== 'function'
				|| typeof candidate.destroy !== 'function') {
				finishRequest();
				throw new TypeError('Desktop read capability returned an invalid stream');
			}
			stream = candidate;
			streamBarrier = Promise.withResolvers();
			stream.once('end', settleStream);
			stream.once('error', observeError);
			stream.once('close', settleStream);
			if (stream.readableEnded === true || stream.closed === true) settleStream();
			return stream;
		};
		const complete = () => {
			if (completePromise) return completePromise;
			completePromise = (async () => {
				if (stream && !streamSettled) {
					throw new Error('Desktop read request cannot complete before its stream settles');
				}
				finishRequest();
				await requestBarrier.promise;
			})();
			return completePromise;
		};
		const forceClose = () => {
			if (forceClosePromise) return forceClosePromise;
			forceClosePromise = (async () => {
				if (stream && !streamSettled) {
					if (!stream.destroyed) {
						try {
							stream.destroy(readRequestRetiredError());
						} catch (error) {
							settleStream();
							finishRequest();
							throw error;
						}
					}
					await streamBarrier.promise;
				}
				finishRequest();
				await requestBarrier.promise;
			})();
			return forceClosePromise;
		};
		const request = { close: forceClose, completion: requestBarrier.promise };
		entry.request = request;
		this.#operations.add(request.completion);
		entry.state.operations.add(request.completion);
		void request.completion.then(() => {
			this.#operations.delete(request.completion);
			entry.state.operations.delete(request.completion);
		});
		return Object.freeze({
			id: entry.id,
			name: entry.name,
			size: entry.size,
			mimeType: entry.mimeType,
			readProfile: entry.readProfile,
			lastModified: entry.lastModified,
			createReadStream,
			close: complete,
			retire: () => this.#releaseEntry(entry),
		});
	}

	#clearRetirementsForOwner(owner) {
		for (const [id, retirement] of this.#retirements) {
			if (retirement.owner === owner) this.#retirements.delete(id);
		}
	}

	#liveEntry(id) {
		const entry = this.#entries.get(String(id || ''));
		if (!entry) return null;
		if (entry.expiresAt <= this.#now()) {
			void this.#releaseEntry(entry).catch(() => undefined);
			return null;
		}
		return entry;
	}

	#renewExpiry(entry) {
		clearTimeout(entry.timer);
		const expiresAt = this.#now() + this.#ttlMs;
		entry.expiresAt = expiresAt;
		entry.timer = setTimeout(() => {
			if (this.#entries.get(entry.id) !== entry || entry.expiresAt !== expiresAt) return;
			void this.#releaseEntry(entry).catch(() => undefined);
		}, this.#ttlMs);
		entry.timer.unref?.();
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
		do id = this.#randomBytes(32).toString('hex'); while (this.#entries.has(id) || this.#retirements.has(id));
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

function descriptorFor(entry) {
	return Object.freeze({
		id: entry.id,
		url: `${APP_ORIGIN}${READ_CAPABILITY_PREFIX}${entry.readProfile}/${entry.id}/${encodeURIComponent(entry.name)}`,
		name: entry.name,
		size: entry.size,
		mimeType: entry.mimeType,
		readProfile: entry.readProfile,
		lastModified: entry.lastModified,
	});
}

function cleanDisplayName(value) {
	const name = String(value || 'file').replace(/[\u0000-\u001f/\\]/gu, '-').slice(0, 255);
	return name || 'file';
}

function safeReadTimestamp(value) {
	const timestamp = Math.trunc(value);
	return Number.isSafeInteger(timestamp) ? Math.max(0, timestamp) : 0;
}

function readRequestRetiredError() {
	const error = new Error('Desktop read capability request was retired');
	error.name = 'AbortError';
	return error;
}
