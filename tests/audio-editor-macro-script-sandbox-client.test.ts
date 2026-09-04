/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MACRO_MAX_SOURCE_BYTES,
	MACRO_PROTOCOL_VERSION,
	MACRO_SOURCE_LINE_OFFSET,
	type MacroValue,
} from '../src/common/editor/macro-script/protocol.ts';
import {
	buildMacroSandboxModule,
	createMacroSandboxClient,
} from '../src/common/editor/macro-script/sandbox-client.ts';

const ENV = Object.freeze({
	productId: 'soundscaper', locale: 'en', seed: 'abc', startedAt: '2026-01-01T00:00:00.000Z', dryRun: false,
});

function createHarness(options: {
	readonly dispatch?: (method: string, args: readonly MacroValue[]) => Promise<MacroValue>;
} = {}) {
	const sent: unknown[] = [];
	const listeners = new Map<string, (event: unknown) => void>();
	let terminated = 0;
	let timer: (() => void) | null = null;
	const worker = {
		postMessage: (message: unknown) => { sent.push(message); },
		addEventListener: (type: string, listener: (event: never) => void) => {
			listeners.set(type, listener as (event: unknown) => void);
		},
		terminate: () => { terminated += 1; },
	};
	const client = createMacroSandboxClient({
		preludeSource: '// prelude\n',
		createWorker: () => worker,
		dispatch: options.dispatch ?? (async () => null),
		setTimer: (callback) => { timer = callback; return 1; },
		clearTimer: () => { timer = null; },
	});
	return {
		client,
		sent,
		terminated: () => terminated,
		fireDeadline: () => timer?.(),
		emit: (type: string, event: unknown) => listeners.get(type)?.(event),
		message: (data: unknown) => listeners.get('message')?.({ data }),
	};
}

const call = (callId: number, method: string, args: readonly unknown[] = []) => ({
	protocolVersion: MACRO_PROTOCOL_VERSION, type: 'call', runId: 'run-1', callId, method, args,
});

test('the program is the worker module\'s own body, under a fixed wrapper', () => {
	const module = buildMacroSandboxModule('// prelude', 'await sound.select.all();');
	const lines = module.split('\n');
	assert.equal(lines[0], '// prelude');
	assert.equal(lines[MACRO_SOURCE_LINE_OFFSET], 'await sound.select.all();',
		'the author\'s first line must sit exactly under the wrapper the offset names');
	assert.match(module, /globalThis\.__macroBoot\(__macroMain\);/u);
});

test('a call is answered, and its result crosses back as plain data', async () => {
	const methods: string[] = [];
	const harness = createHarness({
		dispatch: async (method) => { methods.push(method); return { tracks: 2 }; },
	});
	const run = harness.client.runMacroSandbox({ runId: 'run-1', source: '', env: ENV });

	harness.message(call(1, 'project.snapshot'));
	await Promise.resolve();
	await Promise.resolve();
	harness.message({ protocolVersion: MACRO_PROTOCOL_VERSION, type: 'done', runId: 'run-1', calls: 1 });

	assert.deepEqual(await run, { calls: 1, log: [] });
	assert.deepEqual(methods, ['project.snapshot']);
	assert.deepEqual(harness.sent.at(-1), {
		protocolVersion: MACRO_PROTOCOL_VERSION, type: 'result', runId: 'run-1', callId: 1, value: { tracks: 2 },
	});
	assert.equal(harness.terminated(), 1, 'the worker is discarded after every run');
});

test('a refused call is reported to the program rather than ending the run', async () => {
	const harness = createHarness({
		dispatch: async () => { throw Object.assign(new Error('nope'), { code: 'MACRO_GRANT_DENIED' }); },
	});
	const run = harness.client.runMacroSandbox({ runId: 'run-1', source: '', env: ENV });

	harness.message(call(1, 'effect.apply', ['audacity-invert']));
	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(harness.sent.at(-1), {
		protocolVersion: MACRO_PROTOCOL_VERSION, type: 'error', runId: 'run-1', callId: 1,
		message: 'nope', code: 'MACRO_GRANT_DENIED',
	});

	harness.message({ protocolVersion: MACRO_PROTOCOL_VERSION, type: 'done', runId: 'run-1', calls: 1 });
	await run;
});

test('a worker that speaks the protocol wrongly is not kept answering', async () => {
	const harness = createHarness();
	const run = harness.client.runMacroSandbox({ runId: 'run-1', source: '', env: ENV });
	harness.message(call(7, 'project.snapshot'));
	await assert.rejects(run, /out of order/u);
	assert.equal(harness.terminated(), 1);
});

test('a compile error carries the author\'s own line', async () => {
	const harness = createHarness();
	const run = harness.client.runMacroSandbox({ runId: 'run-1', source: '', env: ENV });
	harness.emit('error', { message: 'Unexpected token', lineno: MACRO_SOURCE_LINE_OFFSET + 4 });
	await assert.rejects(run, (error: Error & { line?: number; code?: string }) => {
		assert.equal(error.line, 4);
		assert.equal(error.code, 'MACRO_COMPILE_FAILED');
		return true;
	});
});

test('the deadline and cancellation both end in a terminated worker', async () => {
	const deadlineHarness = createHarness();
	const deadlineRun = deadlineHarness.client.runMacroSandbox({ runId: 'run-1', source: '', env: ENV });
	deadlineHarness.fireDeadline();
	await assert.rejects(deadlineRun, /longer than 120 seconds/u);
	assert.equal(deadlineHarness.terminated(), 1);

	// A terminated worker sends nothing more, so cancelling settles the run
	// itself; otherwise the caller waits for a message that never comes.
	const cancelHarness = createHarness();
	const cancelRun = cancelHarness.client.runMacroSandbox({ runId: 'run-2', source: '', env: ENV });
	assert.equal(cancelHarness.client.cancelMacroSandbox(), true);
	await assert.rejects(cancelRun, (error: Error & { code?: string }) => {
		assert.equal(error.code, 'MACRO_CANCELLED');
		return true;
	});
	assert.equal(cancelHarness.terminated(), 1);
	assert.equal(cancelHarness.client.cancelMacroSandbox(), false, 'there is nothing left to cancel');
});

test('an oversized program is refused before a worker is ever made', async () => {
	let created = 0;
	const client = createMacroSandboxClient({
		preludeSource: '',
		createWorker: () => { created += 1; throw new Error('unreachable'); },
		dispatch: async () => null,
	});
	await assert.rejects(
		() => client.runMacroSandbox({ runId: 'run-1', source: 'x'.repeat(MACRO_MAX_SOURCE_BYTES + 1), env: ENV }),
		/at most 262144 characters/u,
	);
	assert.equal(created, 0);
});
