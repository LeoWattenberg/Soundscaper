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
}

/**
 * Runs a program the way a worker does: the real prelude and the real wrapper,
 * compiled as one module under one filename, so every stack frame carries the
 * line the browser would report.
 */
async function runMacroProgram(program: string): Promise<PostedMessage[]> {
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
			type: 'begin', runId: 'run-1', env: { seed: 'seed' }, limits: {},
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
