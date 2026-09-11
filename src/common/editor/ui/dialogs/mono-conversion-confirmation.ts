/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MonoConversionConfirmationRequest {
	readonly title: string;
	readonly body: string;
	readonly plan: unknown;
	readonly signal?: AbortSignal;
}

export interface MonoConversionConfirmationDecision {
	readonly accepted: boolean;
	readonly dontShowAgain: boolean;
}

export interface MonoConversionConfirmationPrompt extends MonoConversionConfirmationRequest {
	readonly requestId: number;
}

export interface MonoConversionConfirmation {
	readonly confirm: (
		request: Readonly<MonoConversionConfirmationRequest>,
	) => Promise<Readonly<MonoConversionConfirmationDecision>>;
	readonly dispose: () => void;
	readonly getSnapshot: () => Readonly<MonoConversionConfirmationPrompt> | null;
	readonly settle: (
		prompt: unknown,
		decision: Readonly<MonoConversionConfirmationDecision>,
	) => boolean;
	readonly subscribe: (listener: () => void) => () => void;
}

interface PendingConfirmation {
	readonly prompt: Readonly<MonoConversionConfirmationPrompt>;
	readonly signal: AbortSignal | null;
	readonly abort: () => void;
	readonly resolve: (decision: Readonly<MonoConversionConfirmationDecision>) => void;
	readonly reject: (reason?: unknown) => void;
}

/** Own the promise that lets the controller await the browser's modal decision. */
export function createMonoConversionConfirmation(): MonoConversionConfirmation {
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
		if (clear(record)) record.reject(reason);
	};
	const confirm = (
		request: Readonly<MonoConversionConfirmationRequest>,
	): Promise<Readonly<MonoConversionConfirmationDecision>> => {
		if (disposed) return Promise.reject(abortError('Mono conversion confirmation is disposed.'));
		if (pending) rejectPending(pending, abortError('Mono conversion confirmation was superseded.'));
		const prompt = Object.freeze({
			requestId: ++sequence,
			title: boundedText(request.title, 'title'),
			body: boundedText(request.body, 'body'),
			plan: request.plan,
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
		decisionValue: Readonly<MonoConversionConfirmationDecision>,
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
		if (pending) rejectPending(pending, abortError('Mono conversion confirmation is disposed.'));
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

function confirmationDecision(value: unknown): Readonly<MonoConversionConfirmationDecision> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Mono conversion confirmation requires a decision record.');
	}
	const decision = value as Readonly<Record<string, unknown>>;
	if (typeof decision.accepted !== 'boolean' || typeof decision.dontShowAgain !== 'boolean') {
		throw new TypeError('Mono conversion confirmation decision fields must be boolean.');
	}
	return Object.freeze({
		accepted: decision.accepted,
		dontShowAgain: decision.accepted && decision.dontShowAgain,
	});
}

function boundedText(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 4_096) {
		throw new TypeError(`Mono conversion confirmation ${field} must be bounded text.`);
	}
	return value;
}

function abortError(message: string): DOMException {
	return new DOMException(message, 'AbortError');
}
