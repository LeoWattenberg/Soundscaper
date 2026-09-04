/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The wire between a macro program and the editor.
 *
 * A program runs in a worker and can only ask for things; everything it asks
 * for crosses this boundary as plain data. Nothing live is ever passed, and
 * every value is admitted against the same bounds in both directions, so a
 * program cannot reach the editor through a value any more than through a call.
 *
 * The limits are deliberately the same numbers the Nyquist boundary uses where
 * one already exists, because both answer the same question: how much may
 * untrusted code hand us before we stop reading.
 */

export const MACRO_PROTOCOL_VERSION = 1 as const;

/** Matches NYQUIST_DEFAULT_TIMEOUT_MS. */
export const MACRO_DEFAULT_DEADLINE_MS = 120_000;
export const MACRO_MAX_SOURCE_BYTES = 256 * 1024;
/** Matches MAX_MACRO_LINES: a program may ask as many times as a macro has lines. */
export const MACRO_MAX_CALLS = 4_096;
/** Matches MAX_MACRO_EFFECTS: a program may change the project as often as a macro has steps. */
export const MACRO_MAX_MUTATIONS = 256;
export const MACRO_MAX_INFLIGHT_CALLS = 8;
/** Matches NYQUIST_MAX_TEXT_BYTES. */
export const MACRO_MAX_VALUE_BYTES = 1024 * 1024;
/** Matches MAX_VALUE_DEPTH. */
export const MACRO_MAX_VALUE_DEPTH = 12;
/** Matches MAX_LIST_ITEMS. */
export const MACRO_MAX_VALUE_ITEMS = 4_096;
export const MACRO_MAX_LOG_ENTRIES = 1_000;
export const MACRO_MAX_LOG_BYTES = 256 * 1024;

/** The three lines of wrapper a program's own source sits under. */
export const MACRO_SOURCE_LINE_OFFSET = 3;

export type MacroValue =
	| undefined | null | boolean | number | string
	| readonly MacroValue[]
	| { readonly [key: string]: MacroValue };

export interface MacroLimits {
	readonly deadlineMs: number;
	readonly maxCalls: number;
	readonly maxMutations: number;
	readonly maxInflightCalls: number;
	readonly maxLogEntries: number;
	readonly maxLogBytes: number;
}

export const MACRO_DEFAULT_LIMITS: MacroLimits = Object.freeze({
	deadlineMs: MACRO_DEFAULT_DEADLINE_MS,
	maxCalls: MACRO_MAX_CALLS,
	maxMutations: MACRO_MAX_MUTATIONS,
	maxInflightCalls: MACRO_MAX_INFLIGHT_CALLS,
	maxLogEntries: MACRO_MAX_LOG_ENTRIES,
	maxLogBytes: MACRO_MAX_LOG_BYTES,
});

export interface MacroLogEntry {
	readonly level: 'info' | 'warn' | 'error';
	readonly text: string;
	/** The virtual clock, so a run log reads the same twice. */
	readonly at: number;
}

export interface MacroEnvironment extends Readonly<Record<string, MacroValue>> {
	readonly productId: string;
	readonly locale: string;
	readonly seed: string;
	readonly startedAt: string;
	readonly dryRun: boolean;
}

export interface MacroBeginMessage {
	readonly protocolVersion: typeof MACRO_PROTOCOL_VERSION;
	readonly type: 'begin';
	readonly runId: string;
	readonly env: MacroEnvironment;
	readonly limits: MacroLimits;
}

export interface MacroCallMessage {
	readonly protocolVersion: typeof MACRO_PROTOCOL_VERSION;
	readonly type: 'call';
	readonly runId: string;
	readonly callId: number;
	readonly method: string;
	readonly args: readonly MacroValue[];
}

export type MacroResponseMessage =
	| Readonly<{
		protocolVersion: typeof MACRO_PROTOCOL_VERSION; type: 'result';
		runId: string; callId: number; value: MacroValue;
	}>
	| Readonly<{
		protocolVersion: typeof MACRO_PROTOCOL_VERSION; type: 'error';
		runId: string; callId: number; message: string; code: string;
	}>;

export interface MacroLogMessage {
	readonly protocolVersion: typeof MACRO_PROTOCOL_VERSION;
	readonly type: 'log';
	readonly runId: string;
	readonly entries: readonly MacroLogEntry[];
}

export type MacroTerminalMessage =
	| Readonly<{
		protocolVersion: typeof MACRO_PROTOCOL_VERSION; type: 'done';
		runId: string; calls: number;
	}>
	| Readonly<{
		protocolVersion: typeof MACRO_PROTOCOL_VERSION; type: 'failed';
		runId: string; message: string; line: number | null; column: number | null;
	}>;

export type MacroWorkerMessage = MacroCallMessage | MacroLogMessage | MacroTerminalMessage;

export interface MacroValueBudget {
	bytes: number;
	readonly maxBytes: number;
	readonly maxDepth: number;
	readonly maxItems: number;
}

export function createMacroValueBudget(overrides: Partial<Omit<MacroValueBudget, 'bytes'>> = {}): MacroValueBudget {
	return {
		bytes: 0,
		maxBytes: overrides.maxBytes ?? MACRO_MAX_VALUE_BYTES,
		maxDepth: overrides.maxDepth ?? MACRO_MAX_VALUE_DEPTH,
		maxItems: overrides.maxItems ?? MACRO_MAX_VALUE_ITEMS,
	};
}

/**
 * Admit one value crossing the boundary.
 *
 * Only what structured clone would carry losslessly *and* the editor can be
 * told to do something with. A `Date`, a typed array or a class instance is
 * refused not because it cannot be cloned but because accepting it would make
 * the wire shape something nobody can audit at a glance. `NaN` and the
 * infinities are refused for a sharper reason: they are how a program smuggles
 * undefined behaviour into an effect parameter.
 */
export function normalizeMacroValue(
	value: unknown,
	label: string,
	budget: MacroValueBudget = createMacroValueBudget(),
	depth = 0,
): MacroValue {
	if (depth > budget.maxDepth) {
		throw new RangeError(`${label} is nested deeper than ${budget.maxDepth} levels.`);
	}
	if (value === undefined || value === null) return value ?? null;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number.`);
		return value;
	}
	if (typeof value === 'string') {
		budget.bytes += value.length;
		if (budget.bytes > budget.maxBytes) throw new RangeError(`${label} is larger than ${budget.maxBytes} bytes.`);
		return value;
	}
	if (Array.isArray(value)) {
		if (value.length > budget.maxItems) throw new RangeError(`${label} holds more than ${budget.maxItems} items.`);
		return Object.freeze(value.map((entry, index) => (
			normalizeMacroValue(entry, `${label}[${index}]`, budget, depth + 1)
		)));
	}
	if (isPlainObject(value)) {
		const entries = Object.entries(value);
		if (entries.length > budget.maxItems) throw new RangeError(`${label} holds more than ${budget.maxItems} entries.`);
		const output: Record<string, MacroValue> = {};
		for (const [key, entry] of entries) {
			if (entry === undefined) continue;
			budget.bytes += key.length;
			if (budget.bytes > budget.maxBytes) throw new RangeError(`${label} is larger than ${budget.maxBytes} bytes.`);
			output[key] = normalizeMacroValue(entry, `${label}.${key}`, budget, depth + 1);
		}
		return Object.freeze(output);
	}
	throw new TypeError(`${label} must be a plain value: ${describe(value)} cannot cross the boundary.`);
}

/** Admit one message a worker sent, before anything acts on it. */
export function readMacroWorkerMessage(
	value: unknown,
	runId: string,
	previousCallId: number,
): MacroWorkerMessage {
	if (!isPlainObject(value)) throw new TypeError('A macro message must be an object.');
	const message = value as Record<string, unknown>;
	if (message.protocolVersion !== MACRO_PROTOCOL_VERSION) {
		throw new RangeError(`Unsupported macro protocol version: ${String(message.protocolVersion)}.`);
	}
	if (message.runId !== runId) throw new RangeError('A macro message named a different run.');
	switch (message.type) {
		case 'call': {
			// Strictly increasing, so a worker cannot answer a call twice or pair a
			// result with a call that was never made.
			if (message.callId !== previousCallId + 1) {
				throw new RangeError(`Macro call ${String(message.callId)} arrived out of order.`);
			}
			if (typeof message.method !== 'string' || !message.method) {
				throw new TypeError('A macro call must name a method.');
			}
			const args = Array.isArray(message.args) ? message.args : [];
			const budget = createMacroValueBudget();
			return Object.freeze({
				protocolVersion: MACRO_PROTOCOL_VERSION,
				type: 'call',
				runId,
				callId: message.callId,
				method: message.method,
				args: Object.freeze(args.map((arg, index) => (
					normalizeMacroValue(arg, `${message.method as string} argument ${index + 1}`, budget)
				))),
			});
		}
		case 'log':
			return Object.freeze({
				protocolVersion: MACRO_PROTOCOL_VERSION,
				type: 'log',
				runId,
				entries: Object.freeze((Array.isArray(message.entries) ? message.entries : [])
					.map((entry) => readLogEntry(entry))),
			});
		case 'done':
			return Object.freeze({
				protocolVersion: MACRO_PROTOCOL_VERSION,
				type: 'done',
				runId,
				calls: Number(message.calls) || 0,
			});
		case 'failed':
			return Object.freeze({
				protocolVersion: MACRO_PROTOCOL_VERSION,
				type: 'failed',
				runId,
				message: String(message.message ?? 'The macro failed.').slice(0, 4_096),
				line: authorLine(message.line),
				column: Number.isInteger(message.column) ? Number(message.column) : null,
			});
		default:
			throw new RangeError(`Unsupported macro message: ${String(message.type)}.`);
	}
}

/**
 * The author's own line, with the wrapper's lines taken back off.
 *
 * A program is spliced into a fixed three-line prelude, so every line an engine
 * reports is that much further down than the one the author is looking at.
 */
export function authorLine(value: unknown): number | null {
	if (!Number.isInteger(value)) return null;
	const line = Number(value) - MACRO_SOURCE_LINE_OFFSET;
	return line > 0 ? line : null;
}

function readLogEntry(value: unknown): MacroLogEntry {
	const entry = isPlainObject(value) ? value as Record<string, unknown> : {};
	const level = entry.level === 'warn' || entry.level === 'error' ? entry.level : 'info';
	return Object.freeze({
		level,
		text: String(entry.text ?? '').slice(0, 4_096),
		at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : 0,
	});
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function describe(value: unknown): string {
	if (typeof value === 'function') return 'a function';
	if (typeof value === 'symbol') return 'a symbol';
	if (typeof value === 'bigint') return 'a bigint';
	const name = (value as { constructor?: { name?: string } })?.constructor?.name;
	return name ? `a ${name}` : 'that value';
}
