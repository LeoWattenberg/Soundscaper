/* SPDX-License-Identifier: AGPL-3.0-only */
import { acquireProjectLock } from '../common/editor/project-lock.js';
import { motionId, motionInteger, motionRecord } from '../common/editor/motion-values.ts';
import { request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import { MOTIONSCAPER_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile.ts';

export class MotionProjectConflictError extends Error {
	constructor(message = 'The saved motion project changed in another session; reopen before saving.') { super(message); this.name = 'MotionProjectConflictError'; }
}
export class MotionProjectLeaseError extends MotionProjectConflictError {
	constructor() { super('Another Motionscaper session owns this project, or its write access was lost. Close that editor and reopen the project.'); this.name = 'MotionProjectLeaseError'; }
}
export const MOTION_PROJECT_LEASE_STORE = 'writeLeases';
const DURATION = 15000, HEARTBEAT = 5000;
interface PhysicalLease { readonly readOnly: boolean; readonly method: string; readonly lost?: Promise<unknown>; readonly finished?: Promise<unknown>; release(): void }
interface LeaseRecord { readonly id: string; readonly token: string; readonly expiresAt: number }
export interface MotionProjectWriteLease { readonly projectId: string; readonly token: string }
interface Held { readonly lease: MotionProjectWriteLease; readonly physical: PhysicalLease | null; timer: ReturnType<typeof setInterval> | null; active: boolean; releasing: Promise<void> | null }
type Stores = Readonly<Record<string, IDBObjectStore>>;
export interface MotionProjectLeaseOptions {
	readonly database: () => Promise<IDBDatabase>; readonly physicalLocks: boolean;
	readonly now?: () => number;
}

/** Physical leases give live-tab exclusion; transactionally checked tokens fence delayed writes after loss. */
export class MotionProjectWriteLeases {
	readonly #options: MotionProjectLeaseOptions; readonly #held = new Map<MotionProjectWriteLease, Held>();
	readonly #defaults = new Map<string, Promise<MotionProjectWriteLease>>(); #closed = false;
	readonly #claims = new Set<Promise<MotionProjectWriteLease>>();
	constructor(options: MotionProjectLeaseOptions) { this.#options = options; }
	#now(): number { return motionInteger((this.#options.now ?? Date.now)(), 'lease clock'); }
	async acquire(projectId: string): Promise<MotionProjectWriteLease> {
		motionId(projectId); if (this.#closed) throw new MotionProjectLeaseError();
		// A setup/import writer may be transferred once into an owning document session.
		const prior = this.#defaults.get(projectId);
		if (prior) { this.#defaults.delete(projectId); return prior; }
		return this.#startClaim(projectId);
	}
	defaultLease(projectId: string): Promise<MotionProjectWriteLease> {
		let value = this.#defaults.get(projectId);
		if (!value) {
			value = this.#startClaim(projectId); this.#defaults.set(projectId, value);
			void value.catch(() => { if (this.#defaults.get(projectId) === value) this.#defaults.delete(projectId); });
		}
		return value;
	}
	#startClaim(projectId: string): Promise<MotionProjectWriteLease> {
		const claim = this.#claim(projectId); this.#claims.add(claim);
		void claim.then(() => this.#claims.delete(claim), () => this.#claims.delete(claim)); return claim;
	}
	async #claim(projectId: string): Promise<MotionProjectWriteLease> {
		motionId(projectId); if (this.#closed) throw new MotionProjectLeaseError();
		const physical: PhysicalLease | null = this.#options.physicalLocks
			? await acquireProjectLock(projectId, { projectStorageProfile: MOTIONSCAPER_PROJECT_STORAGE_PROFILE }) : null;
		if (physical?.readOnly) { physical.release(); await physical.finished; throw new MotionProjectLeaseError(); }
		const lease = Object.freeze({ projectId, token: crypto.randomUUID() });
		const held: Held = { lease, physical, timer: null, active: true, releasing: null };
		void physical?.lost?.then(() => this.#lose(held), () => this.#lose(held));
		try {
			const database = await this.#options.database();
			await transact(database, [MOTION_PROJECT_LEASE_STORE], 'readwrite', async stores => {
				const prior: unknown = await request(stores[MOTION_PROJECT_LEASE_STORE]!.get(projectId));
				if (prior !== undefined && physical?.method !== 'navigator-locks' && read(prior, projectId).expiresAt > this.#now()) throw new MotionProjectLeaseError();
				if (this.#closed || !held.active) throw new MotionProjectLeaseError();
				await request(stores[MOTION_PROJECT_LEASE_STORE]!.put({ id: projectId, token: lease.token, expiresAt: this.#now() + DURATION } satisfies LeaseRecord));
			});
			this.#held.set(lease, held);
			if (this.#closed || !held.active) throw new MotionProjectLeaseError();
			held.timer = setInterval(() => { void this.#renew(held).catch(() => this.#lose(held)); }, HEARTBEAT);
			return lease;
		} catch (error) {
			if (this.#held.has(lease)) await this.release(lease);
			else { this.#lose(held); physical?.release(); await physical?.finished; }
			throw error;
		}
	}
	#lose(held: Held): void { held.active = false; if (held.timer !== null) clearInterval(held.timer); held.timer = null; }
	async #renew(held: Held): Promise<void> {
		const database = await this.#options.database();
		await transact(database, [MOTION_PROJECT_LEASE_STORE], 'readwrite', stores => this.assert(stores, held.lease, true));
	}
	async assert(stores: Stores, lease: MotionProjectWriteLease, renew = false): Promise<void> {
		const held = this.#held.get(lease);
		if (this.#closed || !held?.active) throw new MotionProjectLeaseError();
		const value: unknown = await request(stores[MOTION_PROJECT_LEASE_STORE]!.get(lease.projectId));
		const current = value === undefined ? null : read(value, lease.projectId);
		if (!held.active || current?.token !== lease.token || held.physical?.method !== 'navigator-locks' && current.expiresAt <= this.#now()) {
			this.#lose(held); throw new MotionProjectLeaseError();
		}
		if (renew) await request(stores[MOTION_PROJECT_LEASE_STORE]!.put({ ...current, expiresAt: this.#now() + DURATION }));
	}
	async release(lease: MotionProjectWriteLease): Promise<void> {
		const held = this.#held.get(lease); if (!held) return;
		this.#lose(held);
		held.releasing ??= this.#release(held);
		try { await held.releasing; } finally { held.releasing = null; }
	}
	async #release(held: Held): Promise<void> {
		const { lease } = held;
		const database = await this.#options.database();
		await transact(database, [MOTION_PROJECT_LEASE_STORE], 'readwrite', async stores => {
			const value: unknown = await request(stores[MOTION_PROJECT_LEASE_STORE]!.get(lease.projectId));
			if (value !== undefined && read(value, lease.projectId).token === lease.token) await request(stores[MOTION_PROJECT_LEASE_STORE]!.delete(lease.projectId));
		});
		// Keep both the token and physical exclusion until durable release succeeds.
		held.physical?.release(); await held.physical?.finished;
		this.#held.delete(lease);
	}
	async close(): Promise<void> {
		this.#closed = true;
		await Promise.allSettled(this.#claims); this.#defaults.clear();
		const results = await Promise.allSettled([...this.#held.keys()].map(lease => this.release(lease)));
		const failures = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown);
		if (failures.length) throw new AggregateError(failures, 'Motion write lease cleanup failed.');
	}
}
function read(value: unknown, id: string): LeaseRecord {
	const record = motionRecord(value, ['id', 'token', 'expiresAt'], 'Motion write lease');
	if (record.id !== id) throw new Error('Motion write lease identity differs from its project.');
	return { id, token: motionId(record.token), expiresAt: motionInteger(record.expiresAt, 'Motion lease expiry') };
}
