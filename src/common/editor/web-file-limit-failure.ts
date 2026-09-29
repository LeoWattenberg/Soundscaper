/* SPDX-License-Identifier: AGPL-3.0-only */

import { localizedErrorMessage } from '../i18n/presentation-message.ts';

const FILE_LIMIT_CODES = new Set([
	'PROJECT_TOO_LARGE',
	'QUOTA_EXCEEDED',
	'WEB_FILE_STORAGE_FAILED',
	'SHARE_TARGET_TOO_LARGE',
	'SHARE_TARGET_STORAGE_FAILED',
]);

/** Marks a failed file-open/import operation after its underlying limit was identified. */
export class WebFileLoadLimitError extends Error {
	readonly code = 'WEB_FILE_LOAD_LIMIT';

	constructor(cause: unknown) {
		super('A file load exceeded this browser\'s size or storage limits.', { cause });
		this.name = 'WebFileLoadLimitError';
	}
}

export function markWebFileLoadLimitFailure(error: unknown): unknown {
	return error instanceof WebFileLoadLimitError || !isWebFileLimitFailure(error)
		? error : new WebFileLoadLimitError(error);
}

export async function withWebFileLoadLimitContext<Value>(action: () => Value | PromiseLike<Value>): Promise<Value> {
	try { return await action(); }
	catch (error) { throw markWebFileLoadLimitFailure(error); }
}

/** Preserve the underlying storage failure while identifying the browser file-write boundary. */
export class BrowserFileStorageError extends Error {
	readonly code = 'WEB_FILE_STORAGE_FAILED';

	constructor(operation: string, cause: unknown) {
		super(`The browser could not complete the ${operation}.`, { cause });
		this.name = 'BrowserFileStorageError';
	}
}

export function browserFileStorageFailure(operation: string, cause: unknown): unknown {
	if (cause && typeof cause === 'object'
		&& ((cause as { name?: unknown }).name === 'AbortError'
			|| (cause as { code?: unknown }).code === 'ABORTED')) return cause;
	return new BrowserFileStorageError(operation, cause);
}

/** Recognize size and storage refusals, including errors wrapped by rollback cleanup. */
export function isWebFileLimitFailure(error: unknown): boolean {
	return hasFileLimitFailure(error, new Set<object>(), 0);
}

function hasFileLimitFailure(error: unknown, seen: Set<object>, depth: number): boolean {
	if (!error || typeof error !== 'object' || depth > 16 || seen.has(error)) return false;
	seen.add(error);
	const value = error as Readonly<{
		code?: unknown;
		name?: unknown;
		message?: unknown;
		cause?: unknown;
		errors?: unknown;
	}>;
	if (value.name === 'AbortError' || value.code === 'ABORTED') return false;
	if (FILE_LIMIT_CODES.has(String(value.code)) || value.name === 'QuotaExceededError') return true;
	if (localizedErrorMessage(error)?.key === 'insufficientStorage') return true;
	const message = typeof value.message === 'string' ? value.message : '';
	if (/\b(?:not enough local storage|storage quota (?:was )?exceeded)\b/iu.test(message)) return true;
	if (/\b(?:Raw PCM input exceeds the size limit|Streamed media exceeds the fixed .*process-memory media limit|The compressed audio original exceeds the 1 GB import limit)\b/iu.test(message)) return true;
	if (/\bDAWproject media\b[^\n]*\bexceeds the import working memory budget\b/iu.test(message)) return true;
	if (/\b(?:browser|web)\b[^.]*\b(?:too large|exceeds?|size limit|memory limit)\b/iu.test(message)) return true;
	if (/\bLarge audio imports require IndexedDB or OPFS storage\b/iu.test(message)) return true;
	if (Array.isArray(value.errors) && value.errors.some((nested) => hasFileLimitFailure(nested, seen, depth + 1))) return true;
	return hasFileLimitFailure(value.cause, seen, depth + 1);
}
