/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ScapeCollisionChoice,
	ScapeCollisionRequest,
	ScapeOpenInspection,
} from '../../controller/scape-open-request-service.ts';

export interface ScapeCollisionPrompt<Inspection extends ScapeOpenInspection> {
	readonly requestId: number;
	readonly file: Blob;
	readonly inspected: Inspection;
}

export interface ScapeCollisionContinuationRuntime<Inspection extends ScapeOpenInspection> {
	readonly publish: (prompt: ScapeCollisionPrompt<Inspection> | null) => void;
}

interface PendingCollision<Inspection extends ScapeOpenInspection> {
	readonly prompt: ScapeCollisionPrompt<Inspection>;
	readonly signal: AbortSignal;
	readonly resolve: (choice: ScapeCollisionChoice) => void;
	readonly reject: (reason?: unknown) => void;
	readonly abort: () => void;
}

export function createScapeCollisionContinuation<Inspection extends ScapeOpenInspection>(
	runtime: ScapeCollisionContinuationRuntime<Inspection>,
) {
	let pending: PendingCollision<Inspection> | null = null;
	let sequence = 0;
	let disposed = false;

	return Object.freeze({ dispose, request, settle });

	function request(value: ScapeCollisionRequest<Inspection>): Promise<ScapeCollisionChoice> {
		if (disposed) return Promise.reject(abortError('The Scape collision prompt has been disposed.'));
		if (pending) rejectPending(pending, abortError('The Scape collision prompt was superseded.'), true);
		const prompt = Object.freeze({
			requestId: ++sequence,
			file: value.file,
			inspected: value.inspected,
		});
		return new Promise<ScapeCollisionChoice>((resolve, reject) => {
			const record: PendingCollision<Inspection> = {
				prompt,
				signal: value.signal,
				resolve,
				reject,
				abort: () => rejectPending(
					record,
					value.signal.reason,
					true,
				),
			};
			pending = record;
			value.signal.addEventListener('abort', record.abort, { once: true });
			if (value.signal.aborted) {
				record.abort();
				return;
			}
			try {
				runtime.publish(prompt);
			} catch (error) {
				rejectPending(record, error, false);
			}
		});
	}

	function settle(prompt: unknown, choice: ScapeCollisionChoice): boolean {
		if (choice !== 'copy' && choice !== 'replace' && choice !== 'cancel') {
			throw new RangeError('Unknown Scape collision choice.');
		}
		const record = pending;
		if (!record || record.prompt !== prompt) return false;
		clearPending(record);
		try {
			runtime.publish(null);
		} catch (error) {
			record.reject(error);
			return true;
		}
		record.resolve(choice);
		return true;
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		if (pending) rejectPending(pending, abortError('The Scape collision prompt has been disposed.'), false);
	}

	function rejectPending(
		record: PendingCollision<Inspection>,
		reason: unknown,
		publish: boolean,
	): void {
		if (!clearPending(record)) return;
		record.reject(reason);
		if (publish) {
			try {
				runtime.publish(null);
			} catch {
				// Ownership is already rejected; publication failure cannot change its outcome.
			}
		}
	}

	function clearPending(record: PendingCollision<Inspection>): boolean {
		if (pending !== record) return false;
		pending = null;
		record.signal.removeEventListener('abort', record.abort);
		return true;
	}
}

export function isExpectedWorkspaceCancellation(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const candidate = error as Readonly<{ code?: unknown; name?: unknown }>;
	return candidate.name === 'AbortError'
		|| candidate.code === 'PROJECT_CHANGED'
		|| candidate.code === 'DISPOSED';
}

function abortError(message: string): DOMException {
	return new DOMException(message, 'AbortError');
}
