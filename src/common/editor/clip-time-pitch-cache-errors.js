/* SPDX-License-Identifier: AGPL-3.0-only */

// The error surface every clip time-and-pitch render reports through. Storage
// quota, cancellation and StaffPad failures all reach the UI, the worker and the
// coordinator as one shape with a stable code, so a caller never has to know
// which layer refused. Split out of clip-time-pitch-cache.js; no behaviour
// changes here.

import { cloneJson } from './clip-time-pitch-cache-values.ts';


/** A stable error surface for UI, worker, and quota reporting. */
export class ClipTimePitchCacheError extends Error {
	constructor(code, message, options = {}) {
		super(message, options.cause ? { cause: options.cause } : undefined);
		this.name = 'ClipTimePitchCacheError';
		this.code = String(code || 'RENDER_FAILED');
		this.details = options.details == null ? null : cloneJson(options.details);
	}
}

export function normalizeCacheError(error) {
	if (error instanceof ClipTimePitchCacheError) return error;
	if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'ABORTED') return abortError();
	if (error?.name === 'QuotaExceededError' || error?.code === 'QuotaExceededError'
		|| error?.code === 'QUOTA_EXCEEDED' || error?.code === 22) {
		return cacheError('QUOTA_EXCEEDED', 'Browser storage quota was exceeded before the clip render could be committed.', null, error);
	}
	return cacheError('RENDER_FAILED', error?.message || 'The StaffPad clip render failed.', null, error);
}
export function cacheError(code, message, details = null, cause = null) {
	return new ClipTimePitchCacheError(code, message, { details, cause });
}
export function abortError() {
	const error = new ClipTimePitchCacheError('ABORTED', 'The clip time-and-pitch render was cancelled.');
	error.name = 'AbortError';
	return error;
}
export function throwIfAborted(signal) {
	if (signal?.aborted) throw abortError();
}
