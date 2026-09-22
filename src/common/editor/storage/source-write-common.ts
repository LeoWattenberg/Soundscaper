/* SPDX-License-Identifier: AGPL-3.0-only */

export const PENDING_SOURCE_RETENTION_MS = 24 * 60 * 60 * 1000;

export function cleanupFailure(primary: unknown, cleanup: unknown): AggregateError {
	const aggregate = new AggregateError([primary, cleanup], 'The source write and its cleanup both failed.');
	if (primary instanceof Error && primary.name === 'AbortError') aggregate.name = 'AbortError';
	return aggregate;
}

export function clone<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

export function createId(prefix: string): string {
	if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function positiveInteger(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
