/* SPDX-License-Identifier: AGPL-3.0-only */

import { watch as watchFileSystem } from 'node:fs';

import { NATIVE_WATCH_RECONCILE_INTERVAL_MS } from '../src/common/editor/native-watch-reconciliation.ts';
import type { FramescaperNativeRootRepository } from './native-services-root-repository.ts';
import type { FramescaperNativeWatchRepository } from './native-services-watch-repository.ts';

export interface FramescaperNativeWatchHandle {
	readonly close: () => void;
}

export type FramescaperNativeWatchFactory = (
	path: string,
	options: Readonly<{ recursive: false }>,
	hint: () => void,
) => FramescaperNativeWatchHandle;

export interface FramescaperNativeWatchCoordinatorOptions {
	readonly repository: FramescaperNativeWatchRepository;
	readonly roots: FramescaperNativeRootRepository;
	readonly reconcile: () => Promise<void>;
	readonly watch?: FramescaperNativeWatchFactory;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancelSchedule?: (handle: unknown) => void;
	readonly onError?: (error: unknown) => void;
}

/**
 * Main-owned lifecycle for watch hints. Events only pull reconciliation
 * forward; a fixed authoritative sweep remains scheduled after every run.
 */
export class FramescaperNativeWatchCoordinator {
	readonly #repository: FramescaperNativeWatchRepository;
	readonly #roots: FramescaperNativeRootRepository;
	readonly #reconcile: () => Promise<void>;
	readonly #watch: FramescaperNativeWatchFactory;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancelSchedule: (handle: unknown) => void;
	readonly #onError: (error: unknown) => void;
	readonly #watchers = new Map<string, FramescaperNativeWatchHandle>();
	#timer: unknown = null;
	#started = false;
	#activeSweep: Promise<void> | null = null;
	#hinted = false;

	constructor(options: FramescaperNativeWatchCoordinatorOptions) {
		this.#repository = options.repository;
		this.#roots = options.roots;
		this.#reconcile = options.reconcile;
		this.#watch = options.watch ?? defaultWatch;
		this.#schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancelSchedule = options.cancelSchedule ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
		this.#onError = options.onError ?? (() => {});
	}

	async start(): Promise<void> {
		if (this.#started) throw new Error('The native watch coordinator is already started.');
		this.#started = true;
		try {
			this.refreshHints();
			await this.#requestSweep();
		} catch (error) {
			this.stop();
			throw error;
		}
	}

	hint(): void {
		if (!this.#started) return;
		this.#hinted = true;
		if (this.#activeSweep !== null) return;
		this.#replaceSchedule(0);
	}

	async reconcileNow(): Promise<void> {
		if (!this.#started) throw new Error('The native watch coordinator is not started.');
		this.#cancelTimer();
		if (this.#activeSweep !== null) {
			this.#hinted = true;
			await this.#activeSweep;
			if (!this.#started) return;
			this.#cancelTimer();
		}
		await this.#requestSweep();
	}

	refreshHints(): void {
		if (!this.#started) return;
		for (const watcher of this.#watchers.values()) watcher.close();
		this.#watchers.clear();
		for (const rule of this.#repository.list()) {
			if (!rule.enabled) continue;
			const root = this.#roots.requireActive(rule.grantId);
			this.#watchers.set(rule.ruleId, this.#watch(
				root.rootPath,
				Object.freeze({ recursive: false }),
				() => this.hint(),
			));
		}
	}

	stop(): void {
		this.#started = false;
		this.#hinted = false;
		this.#cancelTimer();
		for (const watcher of this.#watchers.values()) watcher.close();
		this.#watchers.clear();
	}

	async drain(): Promise<void> {
		this.stop();
		if (this.#activeSweep !== null) await this.#activeSweep;
	}

	#requestSweep(): Promise<void> {
		if (!this.#started) return Promise.resolve();
		if (this.#activeSweep !== null) {
			this.#hinted = true;
			return this.#activeSweep;
		}
		this.#hinted = false;
		const sweep = (async () => { await this.#reconcile(); })();
		const tracked = sweep.finally(() => {
			if (this.#activeSweep === tracked) this.#activeSweep = null;
			if (this.#started) this.#replaceSchedule(this.#hinted ? 0 : NATIVE_WATCH_RECONCILE_INTERVAL_MS);
		});
		this.#activeSweep = tracked;
		return tracked;
	}

	#replaceSchedule(delayMs: number): void {
		this.#cancelTimer();
		this.#timer = this.#schedule(() => {
			this.#timer = null;
			void this.#requestSweep().catch(this.#onError);
		}, delayMs);
	}

	#cancelTimer(): void {
		if (this.#timer === null) return;
		this.#cancelSchedule(this.#timer);
		this.#timer = null;
	}
}

function defaultWatch(
	path: string,
	_options: Readonly<{ recursive: false }>,
	hint: () => void,
): FramescaperNativeWatchHandle {
	const watcher = watchFileSystem(path, { recursive: false }, () => hint());
	return Object.freeze({ close: () => watcher.close() });
}
