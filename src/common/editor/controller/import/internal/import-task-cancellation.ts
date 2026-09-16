/* SPDX-License-Identifier: AGPL-3.0-only */

import { freezeProjectImportOptions, type NormalizedProjectImportOptions } from './project-import-options.ts';

/** Give the foreground import its own cancel authority while preserving caller cancellation. */
export function createImportTaskCancellation(request: Readonly<NormalizedProjectImportOptions>) {
	const controller = new AbortController();
	const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
	return Object.freeze({
		signal,
		options: freezeProjectImportOptions({ ...request, signal }, Boolean(request.timelineStartExplicit)),
		abort: () => controller.abort(new DOMException('Audio import cancelled.', 'AbortError')),
	});
}
