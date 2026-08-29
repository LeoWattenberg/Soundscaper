/* SPDX-License-Identifier: AGPL-3.0-only */

export const LOCAL_DIAGNOSTICS_ERROR_LIMIT = 32;

export type LocalDiagnosticsErrorSource = 'controller' | 'workspace' | 'desktop';

export interface LocalDiagnosticsErrorEntry {
	readonly occurredAt: string;
	readonly source: LocalDiagnosticsErrorSource;
	readonly name: string;
	readonly code: string;
}

export interface LocalDiagnosticsErrorSnapshot {
	readonly recentErrors: readonly Readonly<LocalDiagnosticsErrorEntry>[];
}

export interface LocalDiagnosticsErrorJournal {
	record(error: unknown, source: LocalDiagnosticsErrorSource): void;
	snapshot(): Readonly<LocalDiagnosticsErrorSnapshot>;
	clear(): void;
}

/** A bounded, memory-only journal that deliberately never reads error prose. */
export function createLocalDiagnosticsErrorJournal(options: Readonly<{
	now?: () => Date;
}> = {}): Readonly<LocalDiagnosticsErrorJournal> {
	const now = options.now ?? (() => new Date());
	let entries: readonly Readonly<LocalDiagnosticsErrorEntry>[] = Object.freeze([]);
	return Object.freeze({ record, snapshot, clear });

	function record(error: unknown, source: LocalDiagnosticsErrorSource): void {
		const entry = Object.freeze({
			occurredAt: timestamp(now()),
			source,
			name: errorName(error),
			code: errorCode(error),
		});
		entries = Object.freeze([...entries, entry].slice(-LOCAL_DIAGNOSTICS_ERROR_LIMIT));
	}

	function snapshot(): Readonly<LocalDiagnosticsErrorSnapshot> {
		return Object.freeze({ recentErrors: entries });
	}

	function clear(): void {
		entries = Object.freeze([]);
	}
}

function timestamp(value: Date): string {
	return Number.isFinite(value.getTime()) ? value.toISOString() : new Date(0).toISOString();
}

function errorName(error: unknown): string {
	try {
		if (error instanceof TypeError) return 'TypeError';
		if (error instanceof RangeError) return 'RangeError';
		if (error instanceof ReferenceError) return 'ReferenceError';
		if (error instanceof SyntaxError) return 'SyntaxError';
		if (error instanceof URIError) return 'URIError';
		if (error instanceof EvalError) return 'EvalError';
		if (error instanceof Error) return normalizeName(ownDataString(error, 'name')) ?? 'Error';
	} catch {
		// Proxies and exotic thrown values are classified without traversing them.
	}
	return 'NonError';
}

function errorCode(error: unknown): string {
	try {
		const code = ownDataString(error, 'code');
		return code !== null && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code) ? code : 'UNCLASSIFIED';
	} catch {
		return 'UNCLASSIFIED';
	}
}

function normalizeName(value: string | null): string | null {
	return value !== null && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(value) ? value : null;
}

function ownDataString(value: unknown, key: string): string | null {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
		? descriptor.value
		: null;
}
