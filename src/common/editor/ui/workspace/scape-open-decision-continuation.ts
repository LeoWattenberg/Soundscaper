/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ScapeOpenDecisionChoice,
	ScapeOpenDecisionKind,
	ScapeOpenDecisionRequest,
	ScapeOpenInspection,
} from '../../controller/scape-open-request-service.ts';

export interface ScapeOpenDecisionPrompt<Inspection extends ScapeOpenInspection> {
	readonly requestId: number;
	readonly kind: ScapeOpenDecisionKind;
	readonly file: Blob;
	readonly inspected: Inspection;
}

export interface ScapeOpenDecisionContinuationRuntime<Inspection extends ScapeOpenInspection> {
	readonly publish: (prompt: ScapeOpenDecisionPrompt<Inspection> | null) => void;
}

interface PendingDecision<Inspection extends ScapeOpenInspection> {
	readonly prompt: ScapeOpenDecisionPrompt<Inspection>;
	readonly signal: AbortSignal;
	readonly resolve: (choice: ScapeOpenDecisionChoice) => void;
	readonly reject: (reason?: unknown) => void;
	readonly abort: () => void;
}

export function createScapeOpenDecisionContinuation<Inspection extends ScapeOpenInspection>(
	runtime: ScapeOpenDecisionContinuationRuntime<Inspection>,
) {
	let pending: PendingDecision<Inspection> | null = null;
	let sequence = 0;
	let disposed = false;

	return Object.freeze({ dispose, request, settle });

	function request(value: ScapeOpenDecisionRequest<Inspection>): Promise<ScapeOpenDecisionChoice> {
		if (disposed) return Promise.reject(abortError('The Scape open decision has been disposed.'));
		if (pending) rejectPending(pending, abortError('The Scape open decision was superseded.'), true);
		const prompt = Object.freeze({
			requestId: ++sequence,
			kind: value.kind,
			file: value.file,
			inspected: value.inspected,
		});
		return new Promise<ScapeOpenDecisionChoice>((resolve, reject) => {
			const record: PendingDecision<Inspection> = {
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

	function settle(prompt: unknown, choice: ScapeOpenDecisionChoice): boolean {
		const record = pending;
		if (!record || record.prompt !== prompt) return false;
		assertChoiceForKind(record.prompt.kind, choice);
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
		if (pending) rejectPending(pending, abortError('The Scape open decision has been disposed.'), false);
	}

	function rejectPending(
		record: PendingDecision<Inspection>,
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

	function clearPending(record: PendingDecision<Inspection>): boolean {
		if (pending !== record) return false;
		pending = null;
		record.signal.removeEventListener('abort', record.abort);
		return true;
	}
}

function assertChoiceForKind(kind: ScapeOpenDecisionKind, choice: ScapeOpenDecisionChoice): void {
	const valid = choice === 'cancel'
		|| (kind === 'compatibility' && choice === 'open-read-only')
		|| (kind === 'collision' && (choice === 'copy' || choice === 'replace'))
		|| (kind === 'compatibility-collision' && choice === 'copy-read-only');
	if (!valid) throw new RangeError(`The ${choice} choice is not available for a ${kind} decision.`);
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
