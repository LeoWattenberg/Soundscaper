/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	MACRO_PROTOCOL_VERSION,
	MACRO_SOURCE_LINE_OFFSET,
} from '../src/common/editor/macro-script/protocol.ts';
import {
	buildMacroSandboxModule,
	createMacroSandboxClient,
} from '../src/common/editor/macro-script/sandbox-client.ts';

// The prelude the browser sandbox actually inlines, not a stand-in: the
// regression was that its length leaked into the line the author was shown,
// and a one-line stand-in is the one prelude for which that could not show.
const PRELUDE = readFileSync(
	new URL('../src/common/editor/macro-script/sandbox-prelude.js', import.meta.url),
	'utf8',
);

const ENV = Object.freeze({
	productId: 'soundscaper', locale: 'en', seed: 'abc', startedAt: '2026-01-01T00:00:00.000Z', dryRun: false,
});

const PROGRAM = [
	'await sound.select.all();',
	'await sound.effect(\'audacity-invert\');',
	'throw new Error(\'stop here\');',
].join('\n');

/** The line an engine would report for one line of the author's program. */
function moduleLineOf(program: string, authorLine: number): number {
	const lines = buildMacroSandboxModule(PRELUDE, program).split('\n');
	const index = lines.indexOf(program.split('\n')[authorLine - 1] ?? '');
	assert.ok(index >= 0, 'the author\'s line must appear in the worker module');
	return index + 1;
}

function createHarness() {
	const listeners = new Map<string, (event: unknown) => void>();
	const worker = {
		postMessage: () => {},
		addEventListener: (type: string, listener: (event: never) => void) => {
			listeners.set(type, listener as (event: unknown) => void);
		},
		terminate: () => {},
	};
	const client = createMacroSandboxClient({
		preludeSource: PRELUDE,
		createWorker: () => worker,
		dispatch: async () => null,
		setTimer: () => 1,
		clearTimer: () => {},
	});
	return {
		client,
		emit: (type: string, event: unknown) => listeners.get(type)?.(event),
		message: (data: unknown) => listeners.get('message')?.({ data }),
	};
}

test('a throw under the shipped prelude reports the author\'s own line', async () => {
	const harness = createHarness();
	const run = harness.client.runMacroSandbox({ runId: 'run-1', source: PROGRAM, env: ENV });

	harness.message({
		protocolVersion: MACRO_PROTOCOL_VERSION, type: 'failed', runId: 'run-1',
		message: 'stop here', line: moduleLineOf(PROGRAM, 3), column: 1,
	});

	await assert.rejects(run, (error: Error & { line?: number | null }) => {
		assert.equal(error.line, 3, 'the prelude\'s own lines must not reach the author');
		return true;
	});
});

test('a compile error under the shipped prelude reports the author\'s own line', async () => {
	const harness = createHarness();
	const run = harness.client.runMacroSandbox({ runId: 'run-1', source: PROGRAM, env: ENV });

	harness.emit('error', { message: 'Unexpected token', lineno: moduleLineOf(PROGRAM, 1) });

	await assert.rejects(run, (error: Error & { line?: number | null; code?: string }) => {
		assert.equal(error.line, 1, 'the prelude\'s own lines must not reach the author');
		assert.equal(error.code, 'MACRO_COMPILE_FAILED');
		return true;
	});
});

test('a line inside the wrapper is not the author\'s code at all', async () => {
	const harness = createHarness();
	const run = harness.client.runMacroSandbox({ runId: 'run-1', source: PROGRAM, env: ENV });

	harness.emit('error', { message: 'Unexpected token', lineno: MACRO_SOURCE_LINE_OFFSET });

	await assert.rejects(run, (error: Error & { line?: number | null }) => {
		assert.equal(error.line, null);
		return true;
	});
});
