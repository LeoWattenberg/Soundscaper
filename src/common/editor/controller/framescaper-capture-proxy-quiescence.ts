/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The two captured-video proxy ports the editor composes synchronously.
 *
 * Save quiescence and active-project synchronization are built while the
 * controller is still constructing, before any capture gesture, so they cannot
 * sit behind the deferred capture runtime the rest of the capture stack loads
 * through. They live apart from the derivative scheduler so that scheduler can
 * be deferred without dragging these two eager ports with it.
 */

type MaybePromise<Value> = PromiseLike<Value> | Value;

export interface FramescaperCapturedVideoProxyActiveUpdate {
	readonly projectId: string;
	readonly project: Readonly<Record<string, unknown>>;
	readonly history: Readonly<Record<string, unknown>>;
}

export interface FramescaperCaptureProxyActiveProjectSyncOptions {
	getActiveProject(): Readonly<Record<string, unknown>> | null;
	setActiveProject(project: Readonly<Record<string, unknown>>): void;
	setActiveHistory(history: Readonly<Record<string, unknown>>): void;
	applyProjectToPlaybackEngine(project: Readonly<Record<string, unknown>>): MaybePromise<unknown>;
	publishProjectState(): void;
}

export interface FramescaperCaptureProxySaveLease {
	release(): boolean;
}

export interface FramescaperCaptureProxySaveQuiescenceOptions {
	getActiveProjectId(): string | null;
	hasUnsavedProjectChanges(): boolean;
	readonly saves: Readonly<{
		suspendProject(projectId: string): void;
		resumeProject(projectId: string): boolean;
		scheduleAutosave(): boolean;
		drain(): PromiseLike<unknown> | unknown;
	}>;
}

/**
 * Regardless of which tab is active, close only the origin project's save
 * admission, then drain every admitted snapshot before final proxy CAS.
 * Unrelated active-project saves remain available; release reschedules only
 * when the origin is active and still dirty.
 */
export function createFramescaperCaptureProxySaveQuiescence(
	options: FramescaperCaptureProxySaveQuiescenceOptions,
): (projectId: string, signal?: AbortSignal) => Promise<FramescaperCaptureProxySaveLease> {
	if (!options || typeof options !== 'object'
		|| typeof options.getActiveProjectId !== 'function'
		|| typeof options.hasUnsavedProjectChanges !== 'function'
		|| !options.saves || typeof options.saves !== 'object'
		|| typeof options.saves.suspendProject !== 'function'
		|| typeof options.saves.resumeProject !== 'function'
		|| typeof options.saves.scheduleAutosave !== 'function'
		|| typeof options.saves.drain !== 'function') {
		throw new TypeError('Captured proxy save quiescence requires the exact editor save ports.');
	}
	return async (projectId, signal) => {
		if (typeof projectId !== 'string' || !projectId) {
			throw new TypeError('Captured proxy save quiescence requires a project ID.');
		}
		options.saves.suspendProject(projectId);
		let released = false;
		const lease = Object.freeze({
			release(): boolean {
				if (released) return false;
				released = true;
				if (!options.saves.resumeProject(projectId)) {
					throw new Error('Captured proxy project save suspension ownership was lost.');
				}
				if (options.getActiveProjectId() === projectId
					&& options.hasUnsavedProjectChanges()) options.saves.scheduleAutosave();
				return true;
			},
		});
		try {
			await abortableSaveDrain(options.saves.drain(), signal);
			return lease;
		} catch (error) {
			try { lease.release(); }
			catch (releaseError) {
				throw new AggregateError(
					[error, releaseError], 'Captured proxy save drain and resume both failed.', { cause: error },
				);
			}
			throw error;
		}
	};
}

/** Keep the app closure, playback engine, and published snapshot aligned with an active background attachment. */
export function createFramescaperCaptureProxyActiveProjectSynchronizer(
	options: FramescaperCaptureProxyActiveProjectSyncOptions,
): (update: FramescaperCapturedVideoProxyActiveUpdate) => Promise<boolean> {
	for (const field of [
		'getActiveProject', 'setActiveProject', 'setActiveHistory',
		'applyProjectToPlaybackEngine', 'publishProjectState',
	] as const) {
		if (typeof options?.[field] !== 'function') {
			throw new TypeError(`Captured proxy active synchronization requires ${field}.`);
		}
	}
	return async (update) => {
		const active = options.getActiveProject();
		if (!active || active.id !== update.projectId) return false;
		const present = (update.history as Readonly<{ readonly present?: unknown }>).present;
		if (present !== update.project) {
			throw new Error('Captured proxy active synchronization requires one installed project/history identity.');
		}
		options.setActiveProject(update.project);
		options.setActiveHistory(update.history);
		await options.applyProjectToPlaybackEngine(update.project);
		options.publishProjectState();
		return true;
	};
}

async function abortableSaveDrain(value: PromiseLike<unknown> | unknown, signal?: AbortSignal): Promise<void> {
	if (!signal) { await value; return; }
	if (signal.aborted) throw signal.reason ?? new DOMException('Captured proxy save drain was cancelled.', 'AbortError');
	let onAbort: (() => void) | null = null;
	try {
		await Promise.race([
			Promise.resolve(value),
			new Promise<never>((_resolve, reject) => {
				onAbort = () => { reject(signal.reason ?? new DOMException(
					'Captured proxy save drain was cancelled.', 'AbortError',
				)); };
				signal.addEventListener('abort', onAbort, { once: true });
			}),
		]);
	} finally {
		if (onAbort) signal.removeEventListener('abort', onAbort);
	}
}
