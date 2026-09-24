/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from './indexeddb-backend.ts';
import type { EditorMemoryDatabase } from './memory-backend.ts';
import { createProjectStoreId } from './project-store-defaults.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import { EditorStoreClosedError } from './status.ts';

const SESSION_KEY_PREFIX = 'audio-editor-retention-session-v1:';
const SESSION_ADMISSION_LOCK = 'audio-editor-retention-session-admission-v1';
const memorySessions = new WeakMap<EditorMemoryDatabase, MemorySessionState>();

interface MemorySessionState {
	readonly owners: Set<string>;
	tail: Promise<void>;
}

function memorySessionState(memory: EditorMemoryDatabase): MemorySessionState {
	let state = memorySessions.get(memory);
	if (!state) {
		state = { owners: new Set(), tail: Promise.resolve() };
		memorySessions.set(memory, state);
	}
	return state;
}

/**
 * An open store may hold undo roots that were never saved as project revisions.
 * Keep a durable marker for its entire lifetime. Web Locks prove when a
 * crashed tab has gone; without them, an abandoned marker stays protective.
 */
export class RetentionSessionGuard {
	readonly #port: StorageRepositoryPort;
	readonly #locks: LockManager | null;
	readonly #memorySessions: MemorySessionState;
	readonly #key = `${SESSION_KEY_PREFIX}${createProjectStoreId('owner')}`;
	#registration: Promise<void> | null = null;
	#releaseLock: (() => void) | null = null;
	#lockRun: Promise<void> | null = null;
	readonly #admissions = new Set<Promise<IDBDatabase | null>>();
	#released = false;

	constructor(port: StorageRepositoryPort, locks: LockManager | null = globalThis.navigator?.locks ?? null) {
		this.#port = port;
		this.#locks = locks;
		this.#memorySessions = memorySessionState(port.memory);
	}

	port(): StorageRepositoryPort {
		return { memory: this.#port.memory, database: () => this.database(), retentionSessionGuard: this };
	}

	database(): Promise<IDBDatabase | null> {
		const admission = this.#admitDatabase();
		this.#admissions.add(admission);
		void admission.finally(() => { this.#admissions.delete(admission); }).catch(() => undefined);
		return admission;
	}

	async #admitDatabase(): Promise<IDBDatabase | null> {
		if (this.#released) throw new EditorStoreClosedError();
		const database = await this.#port.database();
		if (this.#released) throw new EditorStoreClosedError();
		if (!database) {
			if (!this.#memorySessions.owners.has(this.#key)) {
				await this.#withMemoryAdmission(() => { this.#memorySessions.owners.add(this.#key); });
			}
			if (this.#released) throw new EditorStoreClosedError();
			return null;
		}
		if (!this.#registration) {
			const registration = (async () => {
				const webLock = await this.#acquireLock();
				try {
					const register = () => transact(database, 'settings', 'readwrite', ({ settings }) => {
						settings.put({ key: this.#key, value: { version: 1, owner: this.#key, webLock } });
					});
					if (this.#locks) await this.#locks.request(SESSION_ADMISSION_LOCK, { mode: 'exclusive' }, register);
					else await register();
				} catch (error) {
					await this.#releaseHeldLock();
					throw error;
				}
			})();
			const pending = registration.catch((error: unknown) => {
				if (this.#registration === pending) this.#registration = null;
				throw error;
			});
			this.#registration = pending;
		}
		await this.#registration;
		if (this.#released) throw new EditorStoreClosedError();
		return database;
	}

	async release(database: IDBDatabase | null): Promise<void> {
		this.#released = true;
		try {
			await Promise.allSettled([...this.#admissions]);
			if (!this.#registration || !database) return;
			await this.#registration;
			await transact(database, 'settings', 'readwrite', async ({ settings }) => {
				const stored = await request(settings.get(this.#key));
				if (isOwnRecord(stored, this.#key)) settings.delete(this.#key);
			});
		} finally {
			if (this.#memorySessions.owners.has(this.#key)) {
				await this.#withMemoryAdmission(() => { this.#memorySessions.owners.delete(this.#key); });
			}
			await this.#releaseHeldLock();
		}
	}

	hasOtherMemorySession(): boolean {
		return this.#released || !this.#memorySessions.owners.has(this.#key)
			|| this.#memorySessions.owners.size > 1;
	}

	async withSoleSession<Value>(
		database: IDBDatabase | null,
		operation: () => PromiseLike<Value> | Value,
	): Promise<Readonly<{ admitted: false } | { admitted: true; value: Value }>> {
		if (!database) return this.#withMemoryAdmission(async () => {
			if (this.hasOtherMemorySession()) return { admitted: false } as const;
			return { admitted: true, value: await operation() } as const;
		});
		if (!this.#locks) return { admitted: false };
		return this.#locks.request(SESSION_ADMISSION_LOCK, { mode: 'exclusive' }, async (lock) => {
			if (!lock) return { admitted: false } as const;
			await this.reclaimStoppedSessions(database);
			const other = await transact(database, 'settings', 'readonly', ({ settings }) => (
				this.hasOtherOrLostSession(settings)
			));
			if (other) return { admitted: false } as const;
			return { admitted: true, value: await operation() } as const;
		});
	}

	/** Confirm browser-released owners before the separate atomic prune transaction. */
	async reclaimStoppedSessions(database: IDBDatabase): Promise<void> {
		if (!this.#locks) return;
		const records = await transact(database, 'settings', 'readonly', ({ settings }) => (
			readSessionRecords(settings)
		));
		const stopped: string[] = [];
		for (const record of records) {
			if (!isWebLockRecord(record) || record.key === this.#key) continue;
			try {
				const available = await this.#locks.request(record.key, { mode: 'exclusive', ifAvailable: true },
					(lock) => Boolean(lock));
				if (available) stopped.push(record.key);
			} catch { /* An unprovable owner stays protected. */ }
		}
		if (!stopped.length) return;
		await transact(database, 'settings', 'readwrite', async ({ settings }) => {
			for (const key of stopped) {
				const current = await request(settings.get(key));
				if (isWebLockRecord(current) && current.key === key) settings.delete(key);
			}
		});
	}

	async hasOtherOrLostSession(settings: IDBObjectStore): Promise<boolean> {
		const keys = await retentionSessionKeys(settings);
		return !keys.includes(this.#key) || keys.some((key) => key !== this.#key);
	}

	async retainedSessionRecords(settings: IDBObjectStore): Promise<unknown[]> {
		const stored = await request(settings.get(this.#key));
		if (!isOwnRecord(stored, this.#key)) throw new Error('The source retention session was lost.');
		return Promise.all((await retentionSessionKeys(settings)).map((key) => request(settings.get(key))));
	}

	async #acquireLock(): Promise<boolean> {
		if (!this.#locks) return false;
		let acquired!: () => void;
		let rejectAcquisition!: (error: unknown) => void;
		const acquisition = new Promise<void>((resolve, reject) => {
			acquired = resolve;
			rejectAcquisition = reject;
		});
		let release!: () => void;
		const held = new Promise<void>((resolve) => { release = resolve; });
		try {
			const run = this.#locks.request(this.#key, { mode: 'exclusive' }, async () => {
				acquired();
				await held;
			});
			void run.catch(rejectAcquisition);
			await acquisition;
			this.#releaseLock = release;
			this.#lockRun = run;
			return true;
		} catch {
			release();
			return false;
		}
	}

	async #releaseHeldLock(): Promise<void> {
		this.#releaseLock?.();
		this.#releaseLock = null;
		await this.#lockRun?.catch(() => undefined);
		this.#lockRun = null;
	}

	async #withMemoryAdmission<Value>(operation: () => PromiseLike<Value> | Value): Promise<Value> {
		const prior = this.#memorySessions.tail;
		let release!: () => void;
		this.#memorySessions.tail = new Promise<void>((resolve) => { release = resolve; });
		await prior;
		try { return await operation(); }
		finally { release(); }
	}
}

function isOwnRecord(value: unknown, key: string): boolean {
	if (!value || typeof value !== 'object') return false;
	const record = value as Readonly<{ key?: unknown; value?: Readonly<{ owner?: unknown }> }>;
	return record.key === key && record.value?.owner === key;
}

function isWebLockRecord(value: unknown): value is Readonly<{
	readonly key: string;
	readonly value: Readonly<{ readonly owner: string; readonly webLock: true }>;
}> {
	if (!value || typeof value !== 'object') return false;
	const record = value as Readonly<{ key?: unknown; value?: Readonly<{
		owner?: unknown; webLock?: unknown;
	}> }>;
	return typeof record.key === 'string' && record.key.startsWith(SESSION_KEY_PREFIX)
		&& record.value?.owner === record.key && record.value.webLock === true;
}

async function readSessionRecords(settings: IDBObjectStore): Promise<unknown[]> {
	return Promise.all((await retentionSessionKeys(settings)).map((key) => request(settings.get(key))));
}

function retentionSessionKeys(settings: IDBObjectStore): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const keys: string[] = [];
		const cursor = settings.openKeyCursor();
		cursor.onsuccess = () => {
			const entry = cursor.result;
			if (!entry) { resolve(keys); return; }
			if (typeof entry.key === 'string' && entry.key.startsWith(SESSION_KEY_PREFIX)) {
				keys.push(entry.key);
			}
			entry.continue();
		};
		cursor.onerror = () => reject(cursor.error || new Error('Could not inspect source retention sessions.'));
	});
}
