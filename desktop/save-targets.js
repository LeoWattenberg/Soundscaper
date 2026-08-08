import { randomBytes } from 'node:crypto';
import { open, rename, statfs, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
	MAX_AUDIO_PCM_SAVE_CHUNK_BYTES,
	MAX_DESKTOP_SAVE_BYTES,
	MAX_SAVE_ADMITTED_BYTES,
	MAX_SAVE_CHUNK_BYTES,
	MAX_SAVE_SESSIONS,
	MAX_SAVE_TARGETS,
} from './constants.js';
import { SPACE_EXHAUSTED_MESSAGE, commitFailureMessage, isSpaceExhaustedError } from './save-space.js';
import { validateDeclaredSize } from './validation.js';

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const FINAL_PREFIX_BYTES = 32;

export class SaveTargetStore {
	#disposed = false;
	#entries = new Map();
	#maximumTargets;
	#now;
	#randomBytes;
	#revokedOwners = new WeakMap();
	#ttlMs;

	constructor({
		ttlMs = DEFAULT_TTL_MS,
		now = Date.now,
		randomBytesImpl = randomBytes,
		maximumTargets = MAX_SAVE_TARGETS,
	} = {}) {
		this.#ttlMs = ttlMs;
		this.#now = now;
		this.#randomBytes = randomBytesImpl;
		this.#maximumTargets = boundedLimit(maximumTargets, MAX_SAVE_TARGETS, 'Save target capacity');
	}

	registerPath(filePath, { owner, purpose } = {}) {
		if (this.#disposed) throw new Error('Save target store is disposed');
		this.#assertOwnerActive(owner);
		this.#sweepExpired();
		if (this.#entries.size >= this.#maximumTargets) {
			throw new RangeError(`Save target capacity reached its product-wide limit of ${this.#maximumTargets}`);
		}
		const id = this.#newId();
		const entry = { id, path: filePath, name: basename(filePath), owner, purpose, expiresAt: this.#now() + this.#ttlMs, timer: null };
		entry.timer = setTimeout(() => this.#releaseEntry(entry), this.#ttlMs);
		entry.timer.unref?.();
		this.#entries.set(id, entry);
		return Object.freeze({ id, name: entry.name });
	}

	consume(id, { owner } = {}) {
		this.#assertOwnerActive(owner);
		const entry = this.#entries.get(String(id || ''));
		if (!entry) return null;
		this.#assertEntryOwner(entry, owner);
		if (entry.expiresAt <= this.#now()) {
			this.#releaseEntry(entry);
			return null;
		}
		this.#releaseEntry(entry);
		return entry;
	}

	release(id, { owner } = {}) {
		requireOwner(owner);
		const entry = this.#entries.get(String(id || ''));
		if (!entry) return false;
		this.#assertEntryOwner(entry, owner);
		return this.#releaseEntry(entry);
	}

	revokeOwner(owner) {
		requireOwner(owner);
		this.#revokedOwners.set(owner, true);
		for (const entry of this.#entries.values()) {
			if (entry.owner === owner) this.#releaseEntry(entry);
		}
	}

	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const entry of [...this.#entries.values()]) this.#releaseEntry(entry);
	}

	#newId() {
		let id;
		do id = this.#randomBytes(24).toString('hex'); while (this.#entries.has(id));
		return id;
	}

	#sweepExpired() {
		const now = this.#now();
		for (const entry of this.#entries.values()) {
			if (entry.expiresAt <= now) this.#releaseEntry(entry);
		}
	}

	#assertOwnerActive(owner) {
		requireOwner(owner);
		if (this.#revokedOwners.get(owner)) throw new Error('Save target owner was revoked');
	}

	#assertEntryOwner(entry, owner) {
		if (entry.owner !== owner) throw new Error('Save target belongs to another renderer owner');
	}

	#releaseEntry(entry) {
		if (this.#entries.get(entry.id) !== entry) return false;
		this.#entries.delete(entry.id);
		clearTimeout(entry.timer);
		return true;
	}
}

export class AtomicSaveManager {
	#admittedBytes = 0;
	#cleanupErrors = [];
	#closing = false;
	#disposePromise = null;
	#maximumAdmittedBytes;
	#maximumSaveBytes;
	#maximumSessions;
	#open;
	#operations = new Set();
	#ownerStates = new WeakMap();
	#randomBytes;
	#rename;
	#reservedSessions = 0;
	#revocations = new Set();
	#sessions = new Map();
	#statfs;
	#targets;
	#unlink;

	constructor({
		targets,
		openImpl = open,
		renameImpl = rename,
		statfsImpl = statfs,
		unlinkImpl = unlink,
		randomBytesImpl = randomBytes,
		maximumSessions = MAX_SAVE_SESSIONS,
		maximumSaveBytes = MAX_DESKTOP_SAVE_BYTES,
		maximumAdmittedBytes = MAX_SAVE_ADMITTED_BYTES,
	} = {}) {
		if (!targets) throw new TypeError('A SaveTargetStore is required');
		this.#targets = targets;
		this.#open = openImpl;
		this.#rename = renameImpl;
		this.#statfs = statfsImpl;
		this.#unlink = unlinkImpl;
		this.#randomBytes = randomBytesImpl;
		this.#maximumSessions = boundedLimit(maximumSessions, MAX_SAVE_SESSIONS, 'Save session capacity');
		this.#maximumSaveBytes = boundedLimit(maximumSaveBytes, MAX_DESKTOP_SAVE_BYTES, 'Practical save maximum');
		this.#maximumAdmittedBytes = boundedLimit(
			maximumAdmittedBytes,
			MAX_SAVE_ADMITTED_BYTES,
			'Aggregate admitted save bytes',
		);
	}

	begin(options = {}) {
		let exactSize;
		let admittedSize;
		let reservation;
		const owner = options?.owner;
		try {
			if (this.#closing) throw new Error('Save manager is shutting down');
			const state = this.#ownerState(owner);
			if (state.revoked) throw new Error('Save renderer owner was revoked');
			exactSize = options?.size !== undefined;
			if (exactSize === (options?.maximumSize !== undefined)) {
				throw new RangeError('A save requires exactly one exact size or admitted maximum');
			}
			admittedSize = validateDeclaredSize(exactSize ? options.size : options.maximumSize);
			if (options?.finalPrefixByteLength !== undefined) {
				if (options.finalPrefixByteLength !== FINAL_PREFIX_BYTES) throw new RangeError('Final prefix must be exactly 32 bytes');
				if (!exactSize) throw new RangeError('A final prefix requires an exact-size save');
				if (admittedSize < FINAL_PREFIX_BYTES) throw new RangeError('A final-prefix save must be at least 32 bytes');
			}
			reservation = this.#reserve(admittedSize);
		} catch (error) {
			return Promise.reject(error);
		}
		return this.#admit(owner, () => this.#begin(owner, options, exactSize, admittedSize, reservation))
			.catch((error) => {
				this.#releaseReservation(reservation);
				throw error;
			});
	}

	async #begin(owner, { targetId, finalPrefixByteLength }, exactSize, admittedSize, reservation) {
		try {
			const target = this.#targets.consume(targetId, { owner });
			if (!target) throw new Error('Save target expired or was already used');
			if (!exactSize && target.purpose !== 'project') {
				throw new Error('Bounded streaming is restricted to project save targets');
			}
			const chunkSize = exactSize && target.purpose === 'audio-pcm-mix'
				? MAX_AUDIO_PCM_SAVE_CHUNK_BYTES
				: MAX_SAVE_CHUNK_BYTES;
			const writeId = this.#newId();
			const targetDirectory = dirname(target.path);
			const temporaryPath = join(targetDirectory, `.${basename(target.path)}.${writeId}.soundscaper-part`);
			await this.#assertAvailableStorage(targetDirectory);
			let handle;
			try {
				handle = await this.#open(temporaryPath, 'wx', 0o600);
			} catch (error) {
				throw new Error('Could not create the temporary save file', { cause: error });
			}
			this.#sessions.set(writeId, {
				id: writeId,
				owner,
				targetPath: target.path,
				temporaryPath,
				handle,
				exactSize,
				admittedSize,
				chunkSize,
				finalPrefixState: finalPrefixByteLength === undefined ? 'none' : 'required',
				reservation,
				written: 0,
				busy: false,
				idle: Promise.resolve(),
			});
			return Object.freeze({ writeId, chunkSize });
		} catch (error) {
			this.#releaseReservation(reservation);
			throw error;
		}
	}

	writeChunk(options = {}) {
		return this.#admit(options.owner, () => this.#writeChunk(options.owner, options));
	}

	async #writeChunk(owner, { writeId, offset, bytes }) {
		const session = this.#session(writeId, owner);
		if (session.busy) throw new Error('Concurrent save writes are not allowed');
		const buffer = toBuffer(bytes);
		if (buffer.byteLength > session.chunkSize) throw new RangeError('Save chunk is too large');
		if (!Number.isSafeInteger(offset) || offset !== session.written) throw new RangeError('Save chunk offset is out of sequence');
		if (buffer.byteLength > session.admittedSize - session.written) {
			throw new RangeError(session.exactSize
				? 'Save exceeds its declared size'
				: 'Save exceeds its admitted maximum');
		}
		let markIdle;
		let spaceExhausted = false;
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
		} catch (error) {
			spaceExhausted = isSpaceExhaustedError(error);
			if (!spaceExhausted) throw error;
			this.#sessions.delete(session.id);
			throw new Error(SPACE_EXHAUSTED_MESSAGE, { cause: error });
		} finally {
			session.busy = false;
			markIdle();
			if (spaceExhausted) await this.#cleanupSession(session);
		}
	}

	patchFinalPrefix(options = {}) {
		return this.#admit(options.owner, () => this.#patchFinalPrefix(options.owner, options));
	}

	async #patchFinalPrefix(owner, { writeId, bytes }) {
		const session = this.#session(writeId, owner);
		if (session.busy) throw new Error('Concurrent save writes are not allowed');
		if (session.finalPrefixState !== 'required') {
			if (session.finalPrefixState === 'none') throw new Error('Save did not declare a final prefix');
			throw new Error('Final prefix patch was already attempted');
		}
		if (session.written !== session.admittedSize) {
			throw new Error('Final prefix can be patched only after all sequential bytes are written');
		}
		const buffer = toBuffer(bytes);
		if (buffer.byteLength !== FINAL_PREFIX_BYTES) throw new RangeError('Final prefix must be exactly 32 bytes');
		let markIdle;
		let spaceExhausted = false;
		session.idle = new Promise((resolve) => { markIdle = resolve; });
		session.busy = true;
		session.finalPrefixState = 'attempting';
		try {
			let cursor = 0;
			while (cursor < buffer.byteLength) {
				const remaining = buffer.byteLength - cursor;
				const result = await session.handle.write(buffer, cursor, remaining, cursor);
				if (!Number.isSafeInteger(result?.bytesWritten)
					|| result.bytesWritten < 1 || result.bytesWritten > remaining) {
					throw new Error('Final prefix write made invalid progress');
				}
				cursor += result.bytesWritten;
			}
			session.finalPrefixState = 'complete';
			return Object.freeze({ byteLength: session.written });
		} catch (error) {
			session.finalPrefixState = 'failed';
			spaceExhausted = isSpaceExhaustedError(error);
			if (!spaceExhausted) throw error;
			this.#sessions.delete(session.id);
			throw new Error(SPACE_EXHAUSTED_MESSAGE, { cause: error });
		} finally {
			session.busy = false;
			markIdle();
			if (spaceExhausted) await this.#cleanupSession(session);
		}
	}

	finish(writeId, { owner } = {}) {
		return this.#admit(owner, () => this.#finish(writeId, owner));
	}

	async #finish(writeId, owner) {
		const session = this.#session(writeId, owner);
		if (session.busy) throw new Error('Save write is still in progress');
		if (session.finalPrefixState === 'required') throw new Error('The required final prefix is missing');
		if (session.finalPrefixState === 'failed') throw new Error('The final prefix patch failed');
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
			this.#releaseReservation(session.reservation);
			return Object.freeze({ byteLength: session.written });
		} catch (error) {
			await this.#cleanupSession(session, { closeHandle: !handleClosed });
			throw new Error(commitFailureMessage(error), { cause: error });
		}
	}

	abort(writeId, { owner } = {}) {
		return this.#admit(owner, () => this.#abort(writeId, owner));
	}

	async #abort(writeId, owner) {
		const session = this.#sessions.get(String(writeId || ''));
		if (!session) return false;
		this.#assertSessionOwner(session, owner);
		if (session.busy) await session.idle;
		if (this.#sessions.get(session.id) !== session) return false;
		this.#sessions.delete(session.id);
		await this.#cleanupSession(session);
		return true;
	}

	revokeOwner(owner) {
		let state;
		try {
			state = this.#ownerState(owner);
			if (state.revocation) return state.revocation;
			if (this.#closing) return this.#disposePromise;
			state.revoked = true;
			this.#targets.revokeOwner(owner);
		} catch (error) {
			return Promise.reject(error);
		}
		state.revocation = this.#revokeOwner(owner, state);
		const completion = state.revocation.then(() => undefined, () => undefined);
		this.#revocations.add(completion);
		void completion.then(() => this.#revocations.delete(completion));
		return state.revocation;
	}

	dispose() {
		if (this.#disposePromise) return this.#disposePromise;
		this.#closing = true;
		this.#targets.dispose();
		this.#disposePromise = this.#dispose();
		return this.#disposePromise;
	}

	#reserve(admittedSize) {
		if (admittedSize > this.#maximumSaveBytes) {
			throw new RangeError(`Save exceeds the practical per-save maximum of ${this.#maximumSaveBytes} bytes`);
		}
		if (this.#reservedSessions >= this.#maximumSessions) {
			throw new RangeError(`Save session capacity reached its product-wide limit of ${this.#maximumSessions}`);
		}
		if (admittedSize > this.#maximumAdmittedBytes - this.#admittedBytes) {
			throw new RangeError(`Aggregate admitted save bytes exceed the product-wide limit of ${this.#maximumAdmittedBytes}`);
		}
		this.#reservedSessions += 1;
		this.#admittedBytes += admittedSize;
		return { admittedSize, released: false };
	}

	#releaseReservation(reservation) {
		if (!reservation || reservation.released) return false;
		reservation.released = true;
		this.#reservedSessions -= 1;
		this.#admittedBytes -= reservation.admittedSize;
		return true;
	}

	async #assertAvailableStorage(targetDirectory) {
		let details;
		try {
			details = await this.#statfs(targetDirectory, { bigint: true });
		} catch (error) {
			throw new Error('Could not inspect filesystem capacity for the save', { cause: error });
		}
		let availableBytes;
		try {
			availableBytes = availableStorageBytes(details);
		} catch (error) {
			throw new Error('Filesystem capacity information is invalid', { cause: error });
		}
		if (availableBytes < BigInt(this.#admittedBytes)) {
			throw new RangeError('Available disk space is below the aggregate admitted save capacity');
		}
	}

	#admit(owner, operation) {
		if (this.#closing) return Promise.reject(new Error('Save manager is shutting down'));
		let state;
		try {
			state = this.#ownerState(owner);
			if (state.revoked) throw new Error('Save renderer owner was revoked');
		} catch (error) {
			return Promise.reject(error);
		}
		const priorRevocations = [...this.#revocations];
		return this.#trackOperation(priorRevocations.length
			? async () => {
				await Promise.all(priorRevocations);
				if (this.#closing) throw new Error('Save manager is shutting down');
				if (state.revoked) throw new Error('Save renderer owner was revoked');
				return operation();
			}
			: operation, state.operations);
	}

	#trackOperation(operation, ownerOperations) {
		let markComplete;
		// Disposal drains failures too without taking ownership of the caller's error.
		const completion = new Promise((resolve) => { markComplete = resolve; });
		this.#operations.add(completion);
		ownerOperations?.add(completion);
		let result;
		try {
			result = operation();
		} catch (error) {
			this.#operations.delete(completion);
			ownerOperations?.delete(completion);
			markComplete();
			return Promise.reject(error);
		}
		return Promise.resolve(result).finally(() => {
			this.#operations.delete(completion);
			ownerOperations?.delete(completion);
			markComplete();
		});
	}

	async #abortAll() {
		await Promise.all([...this.#sessions.values()].map((session) => this.#abortSession(session)));
	}

	async #revokeOwner(owner, state) {
		await Promise.all([...state.operations]);
		const sessions = [...this.#sessions.values()].filter((session) => session.owner === owner);
		await Promise.all(sessions.map((session) => this.#abortSession(session)));
		if (state.cleanupErrors.length) {
			throw new AggregateError([...state.cleanupErrors], 'Renderer save staging cleanup failed');
		}
	}

	async #dispose() {
		await Promise.all([...this.#operations, ...this.#revocations]);
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
		this.#ownerState(session.owner).cleanupErrors.push(...errors);
		if (!errors.length) this.#releaseReservation(session.reservation);
		return errors;
	}

	async #abortSession(session) {
		if (session.busy) await session.idle;
		if (this.#sessions.get(session.id) !== session) return false;
		this.#sessions.delete(session.id);
		await this.#cleanupSession(session);
		return true;
	}

	#session(id, owner) {
		const session = this.#sessions.get(String(id || ''));
		if (!session) throw new Error('Unknown save session');
		this.#assertSessionOwner(session, owner);
		return session;
	}

	#assertSessionOwner(session, owner) {
		if (session.owner !== owner) throw new Error('Save session belongs to another renderer owner');
	}

	#ownerState(owner) {
		requireOwner(owner);
		let state = this.#ownerStates.get(owner);
		if (!state) {
			state = { cleanupErrors: [], operations: new Set(), revoked: false, revocation: null };
			this.#ownerStates.set(owner, state);
		}
		return state;
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

function requireOwner(owner) {
	if ((typeof owner !== 'object' || owner === null) && typeof owner !== 'function') {
		throw new TypeError('A renderer save owner object reference is required');
	}
}

function boundedLimit(value, maximum, label) {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
		throw new RangeError(`${label} must be a non-negative integer no greater than the hard limit of ${maximum}`);
	}
	return value;
}

function availableStorageBytes(details) {
	if (!details || typeof details !== 'object'
		|| typeof details.bavail !== 'bigint' || details.bavail < 0n
		|| typeof details.bsize !== 'bigint' || details.bsize <= 0n) {
		throw new TypeError('Expected non-negative bigint bavail and positive bigint bsize values');
	}
	return details.bavail * details.bsize;
}

export const SAVE_LIMITS = Object.freeze({
	chunkBytes: MAX_SAVE_CHUNK_BYTES,
	audioPcmChunkBytes: MAX_AUDIO_PCM_SAVE_CHUNK_BYTES,
	totalBytes: MAX_DESKTOP_SAVE_BYTES,
	targets: MAX_SAVE_TARGETS,
	sessions: MAX_SAVE_SESSIONS,
	admittedBytes: MAX_SAVE_ADMITTED_BYTES,
});
