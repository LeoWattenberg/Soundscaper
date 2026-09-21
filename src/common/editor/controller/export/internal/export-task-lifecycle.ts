/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	EDITOR_PROJECT_TASK_SCOPE,
	type EditorCancellableHandle,
	type EditorProjectToken,
	type EditorTaskScope,
} from '../../shared/lifecycle.ts';
import type { EditorExportState } from '../export-state.ts';

interface ExportTaskLifetime {
	startTask(name: string, options: Readonly<{ scope: string }>): EditorTaskScope;
	cancelTask(name: string): void;
}

interface ExportProjectGeneration {
	capture(projectId: string): EditorProjectToken;
	assertCurrent(token: EditorProjectToken): void;
}

interface ExportTaskOptions {
	readonly state: EditorExportState;
	readonly lifetime: ExportTaskLifetime;
	readonly projectGeneration: ExportProjectGeneration;
	readonly projectId: string;
	throwIfAborted(signal: AbortSignal): void;
	abortError(): unknown;
	toggleExport(active: boolean): void;
}

export interface ExportTaskOperation {
	readonly generation: number;
	readonly abort: EditorCancellableHandle;
	readonly signal: AbortSignal;
	assertCurrent(): void;
	finish(progress?: Readonly<{ finish(): unknown }>): void;
}

/** Own one export's shared task, project, generation, and busy-state fences. */
export function beginExportTask(options: ExportTaskOptions): ExportTaskOperation {
	const generation = ++options.state.exportGeneration;
	const projectToken = options.projectGeneration.capture(options.projectId);
	const task = options.lifetime.startTask('export', { scope: EDITOR_PROJECT_TASK_SCOPE });
	const abort = Object.freeze({
		signal: task.signal,
		abort: () => { options.lifetime.cancelTask('export'); },
	});
	const assertCurrent = (): void => {
		options.throwIfAborted(abort.signal);
		task.assertCurrent();
		options.projectGeneration.assertCurrent(projectToken);
		if (generation !== options.state.exportGeneration || options.state.disposed) {
			throw options.abortError();
		}
	};
	let finished = false;
	const finish = (progress?: Readonly<{ finish(): unknown }>): void => {
		if (finished) return;
		finished = true;
		if (generation === options.state.exportGeneration) {
			options.state.exportAbort = null;
			options.toggleExport(false);
		}
		progress?.finish();
		task.finish();
	};
	options.state.exportAbort = abort;
	options.toggleExport(true);
	return Object.freeze({ generation, abort, signal: abort.signal, assertCurrent, finish });
}

interface PendingExportDestination {
	abort(reason: unknown): PromiseLike<unknown> | unknown;
}

interface ExportFailureOptions {
	readonly error: unknown;
	readonly destination: PendingExportDestination | null;
	readonly cleanup: (() => PromiseLike<unknown> | unknown) | null;
	readonly cleanupFailureMessage: string;
	handleError(error: unknown): void;
}

/** Settle a failed export's staged destination and publication cleanup exactly once. */
export async function handleExportFailure(options: ExportFailureOptions): Promise<void> {
	let error = options.error;
	if (options.destination) {
		try {
			await options.destination.abort(error);
		} catch (cleanupError) {
			error = new AggregateError([error, cleanupError], options.cleanupFailureMessage);
		}
	}
	try { await options.cleanup?.(); } catch { /* Publication cleanup remains best-effort. */ }
	if ((error as Readonly<{ name?: string }> | null)?.name !== 'AbortError') options.handleError(error);
}
