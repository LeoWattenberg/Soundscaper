/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_CLOSE_GAP_BEHAVIORS } from '../../editing-preferences.ts';
import type {
	ConfiguredAudioEditorDeleteBehavior,
	DeleteBehaviorConfirmationDecision,
	DeleteBehaviorConfirmationRequest,
} from '../../delete-behavior-onboarding.ts';

export interface DeleteBehaviorConfirmationPrompt extends DeleteBehaviorConfirmationRequest {
	readonly requestId: number;
}

export interface DeleteBehaviorConfirmation {
	readonly confirm: (
		request: Readonly<DeleteBehaviorConfirmationRequest>,
	) => Promise<Readonly<DeleteBehaviorConfirmationDecision>>;
	readonly dispose: () => void;
	readonly getSnapshot: () => Readonly<DeleteBehaviorConfirmationPrompt> | null;
	readonly settle: (
		prompt: unknown,
		decision: Readonly<DeleteBehaviorConfirmationDecision>,
	) => boolean;
	readonly subscribe: (listener: () => void) => () => void;
}

interface PendingConfirmation {
	readonly prompt: Readonly<DeleteBehaviorConfirmationPrompt>;
	readonly signal: AbortSignal | null;
	readonly abort: () => void;
	readonly resolve: (decision: Readonly<DeleteBehaviorConfirmationDecision>) => void;
	readonly reject: (reason?: unknown) => void;
}

/** Own the continuation between a controller edit task and the browser modal. */
export function createDeleteBehaviorConfirmation(): DeleteBehaviorConfirmation {
	const listeners = new Set<() => void>();
	let pending: PendingConfirmation | null = null;
	let sequence = 0;
	let disposed = false;

	const publish = (): void => { listeners.forEach((listener) => { listener(); }); };
	const clear = (record: PendingConfirmation): boolean => {
		if (pending !== record) return false;
		pending = null;
		record.signal?.removeEventListener('abort', record.abort);
		publish();
		return true;
	};
	const rejectPending = (record: PendingConfirmation, reason: unknown): void => {
		if (clear(record)) record.reject(reason instanceof Error ? reason : abortError('Delete behavior confirmation was aborted.'));
	};
	const confirm = (
		request: Readonly<DeleteBehaviorConfirmationRequest>,
	): Promise<Readonly<DeleteBehaviorConfirmationDecision>> => {
		if (disposed) return Promise.reject(abortError('Delete behavior confirmation is disposed.'));
		if (pending) rejectPending(pending, abortError('Delete behavior confirmation was superseded.'));
		if (request.initialDeleteBehavior !== 'leave-gap') {
			return Promise.reject(new RangeError('Delete behavior onboarding must initially select Leave gap.'));
		}
		const prompt = Object.freeze({
			requestId: ++sequence,
			title: boundedTitle(request.title),
			initialDeleteBehavior: 'leave-gap' as const,
			initialCloseGapBehavior: closeGapBehavior(request.initialCloseGapBehavior),
		});
		return new Promise((resolve, reject) => {
			const signal = request.signal ?? null;
			const record: PendingConfirmation = {
				prompt,
				signal,
				resolve,
				reject,
				abort: () => { rejectPending(record, signal?.reason); },
			};
			pending = record;
			signal?.addEventListener('abort', record.abort, { once: true });
			if (signal?.aborted) {
				record.abort();
				return;
			}
			publish();
		});
	};
	const settle = (
		prompt: unknown,
		decisionValue: Readonly<DeleteBehaviorConfirmationDecision>,
	): boolean => {
		const record = pending;
		if (!record || record.prompt !== prompt) return false;
		const decision = confirmationDecision(decisionValue);
		if (!clear(record)) return false;
		record.resolve(decision);
		return true;
	};
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		if (pending) rejectPending(pending, abortError('Delete behavior confirmation is disposed.'));
		listeners.clear();
	};

	return Object.freeze({
		confirm,
		dispose,
		getSnapshot: () => pending?.prompt ?? null,
		settle,
		subscribe: (listener: () => void) => {
			if (disposed) return () => undefined;
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
	});
}

function confirmationDecision(value: unknown): Readonly<DeleteBehaviorConfirmationDecision> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Delete behavior confirmation requires a decision record.');
	}
	const decision = value as Readonly<Record<string, unknown>>;
	if (decision.accepted === false) return Object.freeze({ accepted: false });
	if (decision.accepted !== true
		|| (decision.deleteBehavior !== 'leave-gap' && decision.deleteBehavior !== 'close-gap')) {
		throw new TypeError('Delete behavior confirmation requires a concrete accepted choice.');
	}
	return Object.freeze({
		accepted: true,
		deleteBehavior: decision.deleteBehavior as ConfiguredAudioEditorDeleteBehavior,
		closeGapBehavior: closeGapBehavior(decision.closeGapBehavior),
	});
}

function closeGapBehavior(value: unknown) {
	if (!AUDIO_EDITOR_CLOSE_GAP_BEHAVIORS.includes(value as never)) {
		throw new RangeError(`Unsupported close-gap behavior: ${String(value)}.`);
	}
	return value as typeof AUDIO_EDITOR_CLOSE_GAP_BEHAVIORS[number];
}

function boundedTitle(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 4_096) {
		throw new TypeError('Delete behavior confirmation title must be bounded text.');
	}
	return value;
}

function abortError(message: string): DOMException {
	return new DOMException(message, 'AbortError');
}
