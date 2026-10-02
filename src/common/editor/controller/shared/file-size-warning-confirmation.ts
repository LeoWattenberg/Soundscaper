/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FileSizeWarning, FileSizeWarningConfirmation as ConfirmFileSizeWarning } from './file-size-warning.ts';

export interface FileSizeWarningPrompt extends FileSizeWarning {
	readonly requestId: number;
}

export interface FileSizeWarningConfirmation {
	readonly confirm: ConfirmFileSizeWarning;
	readonly getSnapshot: () => Readonly<FileSizeWarningPrompt> | null;
	readonly settle: (prompt: unknown, accepted: boolean) => boolean;
	readonly subscribe: (listener: () => void) => () => void;
	readonly dispose: () => void;
}

interface PendingDecision {
	readonly prompt: Readonly<FileSizeWarningPrompt>;
	readonly signal: AbortSignal | null;
	readonly abort: () => void;
	readonly resolve: (accepted: boolean) => void;
	readonly reject: (reason: unknown) => void;
}

/** Presentation supplies the decision; the owning operation continues awaiting it. */
export function createFileSizeWarningConfirmation(): FileSizeWarningConfirmation {
	const listeners = new Set<() => void>();
	const queue: PendingDecision[] = [];
	const approvedPolicies = new WeakMap<AbortSignal, Set<string>>();
	let sequence = 0;
	let disposed = false;
	const publish = () => { listeners.forEach((listener) => { listener(); }); };
	const remove = (record: PendingDecision): boolean => {
		const index = queue.indexOf(record);
		if (index < 0) return false;
		queue.splice(index, 1);
		record.signal?.removeEventListener('abort', record.abort);
		if (index === 0) publish();
		return true;
	};
	const confirm: ConfirmFileSizeWarning = (warning, options = {}) => {
		if (disposed) return Promise.reject(abortError());
		if (options.signal?.aborted) return Promise.reject(options.signal.reason ?? abortError());
		if (options.signal && approvedPolicies.get(options.signal)?.has(policyKey(warning))) return Promise.resolve(true);
		const prompt = Object.freeze({ ...warning, requestId: ++sequence });
		return new Promise<boolean>((resolve, reject) => {
			const signal = options.signal ?? null;
			const record: PendingDecision = {
				prompt, signal, resolve, reject,
				abort: () => { if (remove(record)) reject(signal?.reason ?? abortError()); },
			};
			queue.push(record);
			signal?.addEventListener('abort', record.abort, { once: true });
			if (signal?.aborted) record.abort();
			else if (queue.length === 1) publish();
		});
	};
	const settle = (prompt: unknown, accepted: boolean): boolean => {
		const record = queue[0];
		if (!record || record.prompt !== prompt) return false;
		if (typeof accepted !== 'boolean') throw new TypeError('File size warning decision must be boolean.');
		if (!remove(record)) return false;
		if (accepted && record.signal) {
			let policies = approvedPolicies.get(record.signal);
			if (!policies) { policies = new Set(); approvedPolicies.set(record.signal, policies); }
			policies.add(policyKey(record.prompt));
		}
		record.resolve(accepted);
		return true;
	};
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		while (queue.length) {
			const record = queue[0];
			if (!record) break;
			remove(record);
			record.reject(abortError());
		}
		listeners.clear();
	};
	return Object.freeze({
		confirm, settle, dispose,
		getSnapshot: () => queue[0]?.prompt ?? null,
		subscribe: (listener: () => void) => {
			if (disposed) return () => undefined;
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
	});
}

function abortError(): DOMException {
	return new DOMException('The file size warning was canceled.', 'AbortError');
}

function policyKey(warning: Readonly<FileSizeWarning>): string {
	return JSON.stringify([warning.label, warning.thresholdBytes]);
}
