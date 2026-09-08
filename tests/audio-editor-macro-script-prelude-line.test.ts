/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import {
	MACRO_SOURCE_LINE_OFFSET,
	authorLine,
} from '../src/common/editor/macro-script/protocol.ts';
import { buildMacroSandboxModule } from '../src/common/editor/macro-script/sandbox-client.ts';

const PRELUDE = readFileSync(
	new URL('../src/common/editor/macro-script/sandbox-prelude.js', import.meta.url),
	'utf8',
);

interface PostedMessage {
	readonly type?: string;
	readonly message?: string;
	readonly line?: number | null;
	readonly callId?: number;
	readonly method?: string;
	readonly args?: readonly unknown[];
	readonly entries?: readonly { readonly level: string; readonly text: string }[];
}

/**
 * Runs a program the way a worker does: the real prelude and the real wrapper,
 * compiled as one module under one filename, so every stack frame carries the
 * line the browser would report.
 */
async function runMacroProgram(
	program: string,
	limits: Readonly<Record<string, number>> = {},
): Promise<PostedMessage[]> {
	const posted: PostedMessage[] = [];
	const listeners = new Map<string, (event: unknown) => void>();
	const context = vm.createContext({
		self: {
			postMessage: (message: PostedMessage) => { posted.push(message); },
			addEventListener: (type: string, listener: (event: unknown) => void) => {
				listeners.set(type, listener);
			},
		},
	});
	// The worker is a module, so the prelude's own declarations are not global
	// properties; the one-line prefix reproduces that scoping without moving any
	// line, so every frame reports the line the browser would.
	vm.runInContext(`(() => {'use strict';${buildMacroSandboxModule(PRELUDE, program)}\n})();`,
		context, { filename: 'blob:soundscaper-macro' });
	const booted = vm.runInContext('globalThis.__macroBoot()', context) as Promise<void>;
	listeners.get('message')?.({
		data: {
			type: 'begin', runId: 'run-1', env: { seed: 'seed' }, limits,
		},
	});
	await booted;
	return posted;
}

function failureOf(posted: readonly PostedMessage[]): PostedMessage {
	const failure = posted.find((message) => message.type === 'failed');
	assert.ok(failure, 'the program must report a failure');
	return failure;
}

test('the author\'s first line sits exactly under the wrapper the offset names', () => {
	const lines = buildMacroSandboxModule(PRELUDE, 'await sound.select.all();\nsound.log.info(1);')
		.split('\n');
	assert.equal(lines[MACRO_SOURCE_LINE_OFFSET], 'await sound.select.all();');
	assert.equal(lines[MACRO_SOURCE_LINE_OFFSET + 1], 'sound.log.info(1);');
});

test('a failed assertion reports the line that asserted, not the prelude\'s own', async () => {
	const posted = await runMacroProgram([
		'sound.log.info(\'checking\');',
		'sound.assert(false, \'no clips selected\');',
	].join('\n'));

	const failure = failureOf(posted);
	assert.equal(failure.message, 'no clips selected');
	assert.equal(authorLine(failure.line), 2);
});

test('a message that reads like a timecode is not mistaken for a line', async () => {
	const posted = await runMacroProgram('throw new Error(\'clip at 00:12:34 is missing\');');

	const failure = failureOf(posted);
	assert.equal(failure.message, 'clip at 00:12:34 is missing');
	assert.equal(authorLine(failure.line), 1);
});

test('a throw from the program\'s own helper reports a line the author wrote', async () => {
	const posted = await runMacroProgram([
		'const check = () => { throw new Error(\'stop here\'); };',
		'sound.log.info(\'about to check\');',
		'check();',
	].join('\n'));

	const failure = failureOf(posted);
	assert.equal(failure.message, 'stop here');
	const line = authorLine(failure.line);
	assert.ok(line !== null && line >= 1 && line <= 3, `expected an author line, saw ${String(line)}`);
});

test('a dropped-log notice bypasses the exhausted macro log budget', async () => {
	const posted = await runMacroProgram([
		"sound.log.info('one');",
		"sound.log.info('two');",
		"sound.log.info('three');",
		"sound.log.info('four');",
		"sound.log.info('five');",
	].join('\n'), { maxLogEntries: 3, maxLogBytes: 262_144 });
	const logs = posted.filter(({ type }) => type === 'log');

	assert.deepEqual(logs.flatMap(({ entries }) => entries?.map(({ text }) => text) ?? []), [
		'one',
		'two',
		'three',
		'2 further messages were dropped.',
	]);
	assert.ok(posted.indexOf(logs.at(-1)!) < posted.findIndex(({ type }) => type === 'done'));
});

test('an uncloneable editor call does not consume call or in-flight capacity', async () => {
	const posted: PostedMessage[] = [];
	const listeners = new Map<string, (event: unknown) => void>();
	const context = vm.createContext({
		self: {
			postMessage: (message: PostedMessage) => {
				if (message.type === 'call' && message.args?.some(containsFunction)) {
					throw new DOMException('The value could not be cloned.', 'DataCloneError');
				}
				posted.push(message);
				if (message.type === 'call') queueMicrotask(() => listeners.get('message')?.({
					data: { type: 'result', runId: 'run-1', callId: message.callId, value: null },
				}));
			},
			addEventListener: (type: string, listener: (event: unknown) => void) => {
				listeners.set(type, listener);
			},
		},
	});
	const program = [
		'for (let index = 0; index < 10; index += 1) {',
		'  try { await sound.effect(\'x\', { fn: () => {} }); } catch {}',
		'}',
		'await sound.select.all();',
	].join('\n');
	vm.runInContext(`(() => {'use strict';${buildMacroSandboxModule(PRELUDE, program)}\n})();`,
		context, { filename: 'blob:soundscaper-macro' });
	const booted = vm.runInContext('globalThis.__macroBoot()', context) as Promise<void>;
	listeners.get('message')?.({ data: {
		type: 'begin', runId: 'run-1', env: { seed: 'seed' }, limits: {},
	} });
	await booted;

	const calls = posted.filter(({ type }) => type === 'call');
	assert.deepEqual(calls.map(({ callId, method }) => ({ callId, method })), [
		{ callId: 1, method: 'select.all' },
	]);
});

function containsFunction(value: unknown): boolean {
	if (typeof value === 'function') return true;
	if (!value || typeof value !== 'object') return false;
	return Object.values(value).some(containsFunction);
}
