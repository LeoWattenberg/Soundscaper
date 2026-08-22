/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

import {
	acquireFramescaperNativeServicesWriterLease,
	releaseFramescaperNativeServicesWriterLease,
	renewFramescaperNativeServicesWriterLease,
	type FramescaperNativeServicesLease,
} from './native-services-database.ts';

export const FRAMESCAPER_NATIVE_SERVICES_RENEW_INTERVAL_MS = 10_000;

export interface FramescaperNativeServicesLeaseCoordinatorOptions {
	readonly database: DatabaseSync;
	readonly leaseId: string;
	readonly instanceId: string;
	readonly processId: number;
	readonly now?: () => number;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancelSchedule?: (handle: unknown) => void;
	readonly onFenced?: (error: unknown) => void;
}

/** Process-lifetime renewal; one failure is a permanent dispatch fence. */
export class FramescaperNativeServicesLeaseCoordinator {
	readonly #database: DatabaseSync;
	readonly #identity: Readonly<{
		leaseId: string; instanceId: string; processId: number;
	}>;
	readonly #now: () => number;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancelSchedule: (handle: unknown) => void;
	readonly #onFenced: (error: unknown) => void;
	#current: FramescaperNativeServicesLease | null = null;
	#timer: unknown = null;
	#fenced: unknown = null;
	#stopped = false;

	constructor(options: FramescaperNativeServicesLeaseCoordinatorOptions) {
		this.#database = options.database;
		this.#identity = Object.freeze({
			leaseId: options.leaseId,
			instanceId: options.instanceId,
			processId: options.processId,
		});
		this.#now = options.now ?? (() => Date.now());
		this.#schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancelSchedule = options.cancelSchedule ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
		this.#onFenced = options.onFenced ?? (() => {});
	}

	start(): FramescaperNativeServicesLease {
		if (this.#current !== null || this.#fenced !== null) {
			throw new Error('The native services writer lease coordinator is already settled.');
		}
		if (this.#stopped) throw new Error('The native services writer lease coordinator was stopped.');
		this.#current = acquireFramescaperNativeServicesWriterLease(this.#database, {
			...this.#identity,
			nowMs: this.#now(),
		});
		this.#replaceTimer();
		return this.#current;
	}

	lease(): FramescaperNativeServicesLease {
		if (this.#fenced !== null) throw new Error('The native services writer lease coordinator is fenced.');
		if (this.#current === null || this.#stopped) {
			throw new Error('The native services writer lease coordinator is not running.');
		}
		return this.#current;
	}

	renewNow(): Promise<FramescaperNativeServicesLease> {
		let current: FramescaperNativeServicesLease;
		try {
			current = this.lease();
			const renewed = renewFramescaperNativeServicesWriterLease(
				this.#database, current, this.#now(),
			);
			this.#current = renewed;
			this.#replaceTimer();
			return Promise.resolve(renewed);
		} catch (error) {
			this.#fence(error);
			return Promise.reject(error);
		}
	}

	stop(): void {
		if (this.#stopped) return;
		this.#stopped = true;
		this.#cancelTimer();
		const current = this.#current;
		this.#current = null;
		if (current !== null) releaseFramescaperNativeServicesWriterLease(this.#database, current);
	}

	#replaceTimer(): void {
		this.#cancelTimer();
		this.#timer = this.#schedule(() => {
			this.#timer = null;
			void this.renewNow().catch(() => undefined);
		}, FRAMESCAPER_NATIVE_SERVICES_RENEW_INTERVAL_MS);
	}

	#cancelTimer(): void {
		if (this.#timer === null) return;
		this.#cancelSchedule(this.#timer);
		this.#timer = null;
	}

	#fence(error: unknown): void {
		if (this.#fenced !== null || this.#stopped) return;
		this.#fenced = error;
		this.#cancelTimer();
		this.#onFenced(error);
	}
}
