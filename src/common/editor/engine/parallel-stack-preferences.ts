/* SPDX-License-Identifier: AGPL-3.0-only */

export type ParallelStackWorkerLimit = 'auto' | 1 | 2 | 4 | 8;
export interface ParallelStackPreferences {
	readonly enabled: boolean;
	readonly workerLimit: ParallelStackWorkerLimit;
	readonly pipelineFrames: 768 | 1536;
}

export interface ParallelStackStatus {
	readonly state: 'off' | 'ready' | 'active' | 'unsupported' | 'failed';
	readonly reason?: string;
	readonly sampleRate?: number;
	readonly workerCount?: number;
}

export const PARALLEL_STACK_PREFERENCES_KEY = 'soundscaper.parallel-effect-stacks.v1';
const DEFAULTS: ParallelStackPreferences = Object.freeze({ enabled: false, workerLimit: 'auto', pipelineFrames: 1536 });
const OFF: ParallelStackStatus = Object.freeze({ state: 'off' });
const statuses = new WeakMap<object, ParallelStackStatus>();
const listeners = new Set<() => void>();
let revision = 0;
let configurationRevision = 0;
let sessionPreferences = DEFAULTS;

function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
	try { return typeof window === 'undefined' ? null : window.localStorage; }
	catch { return null; }
}

function validPreferences(value: unknown): value is ParallelStackPreferences {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.enabled === 'boolean'
		&& ['auto', 1, 2, 4, 8].includes(record.workerLimit as string | number)
		&& [768, 1536].includes(record.pipelineFrames as number);
}

/** An application preference, deliberately outside the project and undo history. */
export function readParallelStackPreferences(
	storage: Pick<Storage, 'getItem'> | null = browserStorage(),
): ParallelStackPreferences {
	if (storage === null) return sessionPreferences;
	try {
		const value: unknown = JSON.parse(storage.getItem(PARALLEL_STACK_PREFERENCES_KEY) ?? 'null');
		return validPreferences(value) ? Object.freeze({
			enabled: value.enabled, workerLimit: value.workerLimit, pipelineFrames: value.pipelineFrames,
		}) : DEFAULTS;
	} catch { return DEFAULTS; }
}

export function writeParallelStackPreferences(
	value: ParallelStackPreferences,
	options: Readonly<{
		playing?: boolean;
		recording?: boolean;
		storage?: Pick<Storage, 'setItem'> | null;
	}> = {},
): void {
	if (options.playing === true || options.recording === true) {
		throw new Error('Stop playback and recording before changing parallel effect processing.');
	}
	if (!validPreferences(value)) throw new TypeError('Invalid parallel effect processing settings.');
	const next = Object.freeze({ enabled: value.enabled, workerLimit: value.workerLimit, pipelineFrames: value.pipelineFrames });
	const storage = options.storage === undefined ? browserStorage() : options.storage;
	// If storage exists but refuses the write, keep the previous preference and
	// let the invoking application action report the failure.
	storage?.setItem(PARALLEL_STACK_PREFERENCES_KEY, JSON.stringify(next));
	if (storage === null) sessionPreferences = next;
	configurationRevision += 1;
	publish();
}

export function readParallelStackStatus(engine: object | null | undefined): ParallelStackStatus {
	return engine ? statuses.get(engine) ?? OFF : OFF;
}

export function publishParallelStackStatus(engine: object, status: ParallelStackStatus): void {
	statuses.set(engine, Object.freeze({ ...status }));
	publish();
}

export function subscribeParallelStackPreferences(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

export function parallelStackPreferencesRevision(): number { return revision; }
/** Status publication must not automatically retry a configuration that missed its deadline. */
export function parallelStackConfigurationRevision(): number { return configurationRevision; }

function publish(): void {
	revision += 1;
	for (const listener of listeners) listener();
}
