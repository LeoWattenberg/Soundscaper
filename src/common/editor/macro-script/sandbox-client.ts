/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The host side of a macro program's worker.
 *
 * A program becomes the worker's own module body, delivered as a `blob:` URL,
 * because the shipped content security policy grants no `'unsafe-eval'` in
 * either shell: there is no way to evaluate a string of source, and no need for
 * one. That also means the browser compiles the program, so a program cannot
 * compile any further code once it is running.
 *
 * Cancellation, the deadline and any failure all end the same way — the worker
 * is terminated. A program can loop without ever calling out, so termination is
 * the only stop that always works; it is the same conclusion the Nyquist client
 * reached for the same reason.
 */

import {
	MACRO_DEFAULT_LIMITS,
	MACRO_MAX_SOURCE_BYTES,
	MACRO_PROTOCOL_VERSION,
	type MacroEnvironment,
	type MacroLimits,
	type MacroLogEntry,
	type MacroValue,
	normalizeMacroValue,
	readMacroWorkerMessage,
} from './protocol.ts';

export interface MacroSandboxWorker {
	postMessage(message: unknown): void;
	addEventListener(type: string, listener: (event: never) => void): void;
	terminate(): void;
}

export interface MacroSandboxRuntime {
	/** The prelude, inlined verbatim into the worker the program becomes. */
	readonly preludeSource: string;
	readonly createWorker: (source: string, name: string) => MacroSandboxWorker;
	readonly dispatch: (method: string, args: readonly MacroValue[]) => Promise<MacroValue>;
	readonly onLog?: (entry: MacroLogEntry) => void;
	/** Injected so a test can run the deadline without waiting for it. */
	readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
	readonly clearTimer?: (handle: unknown) => void;
}

export interface MacroSandboxRunRequest {
	readonly runId: string;
	readonly source: string;
	readonly env: MacroEnvironment;
	readonly limits?: Partial<MacroLimits>;
}

export interface MacroSandboxRunResult {
	readonly calls: number;
	readonly log: readonly MacroLogEntry[];
}

export class MacroSandboxError extends Error {
	readonly line: number | null;
	readonly code: string;

	constructor(message: string, options: Readonly<{ line?: number | null; code?: string }> = {}) {
		super(message);
		this.name = 'MacroSandboxError';
		this.line = options.line ?? null;
		this.code = options.code ?? 'MACRO_FAILED';
	}
}

/**
 * The worker's module body.
 *
 * The three lines before the program are fixed, and `MACRO_SOURCE_LINE_OFFSET`
 * is the same three, so every line an engine reports maps back to the line the
 * author is looking at. Putting the program inside a function body also makes a
 * static `import` a syntax error the author sees on their own line, which is a
 * denial the engine performs for us.
 */
export function buildMacroSandboxModule(preludeSource: string, program: string): string {
	return `${preludeSource}
const __macroMain = async (sound) => {
"use strict";
${program}
};
globalThis.__macroBoot(__macroMain);
`;
}

export function createMacroSandboxClient(runtime: MacroSandboxRuntime) {
	let active: MacroSandboxWorker | null = null;
	let abandon: ((reason: MacroSandboxError) => void) | null = null;

	return Object.freeze({ runMacroSandbox, cancelMacroSandbox });

	async function runMacroSandbox(request: MacroSandboxRunRequest): Promise<MacroSandboxRunResult> {
		if (request.source.length > MACRO_MAX_SOURCE_BYTES) {
			throw new MacroSandboxError(
				`A macro program may be at most ${MACRO_MAX_SOURCE_BYTES} characters.`,
				{ code: 'MACRO_SOURCE_TOO_LARGE' },
			);
		}
		const limits: MacroLimits = { ...MACRO_DEFAULT_LIMITS, ...request.limits };
		const worker = runtime.createWorker(
			buildMacroSandboxModule(runtime.preludeSource, request.source),
			`soundscaper-macro-${request.runId}`,
		);
		active = worker;
		const log: MacroLogEntry[] = [];
		let previousCallId = 0;
		let settled = false;

		try {
			return await new Promise<MacroSandboxRunResult>((resolve, reject) => {
				const finish = (settle: () => void) => {
					if (settled) return;
					settled = true;
					if (deadline !== undefined) runtime.clearTimer?.(deadline);
					worker.terminate();
					settle();
				};
				// A terminated worker sends nothing more, so cancelling has to settle
				// the run itself or the caller waits for a message that never comes.
				abandon = (reason) => finish(() => reject(reason));
				const deadline = runtime.setTimer?.(() => finish(() => reject(new MacroSandboxError(
					`The macro ran for longer than ${Math.round(limits.deadlineMs / 1_000)} seconds.`,
					{ code: 'MACRO_DEADLINE_EXCEEDED' },
				))), limits.deadlineMs);

				worker.addEventListener('error', ((event: { message?: string; lineno?: number }) => {
					// A compile error arrives here rather than as a message, because the
					// program never began running.
					finish(() => reject(new MacroSandboxError(
						String(event?.message || 'The macro could not be compiled.'),
						{ line: authorLineOf(event?.lineno), code: 'MACRO_COMPILE_FAILED' },
					)));
				}) as (event: never) => void);

				worker.addEventListener('message', ((event: { data?: unknown }) => {
					let message;
					try {
						message = readMacroWorkerMessage(event?.data, request.runId, previousCallId);
					} catch (cause) {
						// A worker that speaks the protocol wrongly is not one to keep
						// answering; it is either broken or trying something.
						finish(() => reject(new MacroSandboxError(
							cause instanceof Error ? cause.message : String(cause),
							{ code: 'MACRO_PROTOCOL_FAILURE' },
						)));
						return;
					}
					switch (message.type) {
						case 'call':
							previousCallId = message.callId;
							void answer(worker, request.runId, message.callId, message.method, message.args);
							return;
						case 'log':
							for (const entry of message.entries) {
								log.push(entry);
								runtime.onLog?.(entry);
							}
							return;
						case 'done':
							finish(() => resolve({ calls: message.calls, log: Object.freeze([...log]) }));
							return;
						default:
							finish(() => reject(new MacroSandboxError(message.message, { line: message.line })));
					}
				}) as (event: never) => void);

				worker.postMessage({
					protocolVersion: MACRO_PROTOCOL_VERSION,
					type: 'begin',
					runId: request.runId,
					env: request.env,
					limits,
				});
			});
		} finally {
			if (active === worker) active = null;
			abandon = null;
		}
	}

	/** Stops the program that is running, if one is. */
	function cancelMacroSandbox(): boolean {
		if (!active) return false;
		const reject = abandon;
		active = null;
		abandon = null;
		reject?.(new MacroSandboxError('The macro was cancelled.', { code: 'MACRO_CANCELLED' }));
		return true;
	}

	async function answer(
		worker: MacroSandboxWorker,
		runId: string,
		callId: number,
		method: string,
		args: readonly MacroValue[],
	): Promise<void> {
		try {
			const value = await runtime.dispatch(method, args);
			worker.postMessage({
				protocolVersion: MACRO_PROTOCOL_VERSION,
				type: 'result',
				runId,
				callId,
				value: normalizeMacroValue(value, `${method} result`),
			});
		} catch (cause) {
			worker.postMessage({
				protocolVersion: MACRO_PROTOCOL_VERSION,
				type: 'error',
				runId,
				callId,
				message: cause instanceof Error ? cause.message : String(cause),
				code: String((cause as { code?: unknown })?.code ?? 'MACRO_CALL_FAILED'),
			});
		}
	}
}

function authorLineOf(value: unknown): number | null {
	if (!Number.isInteger(value)) return null;
	const line = Number(value) - 3;
	return line > 0 ? line : null;
}
