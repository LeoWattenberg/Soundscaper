/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { buildMacroSandboxModule } from '../src/common/editor/macro-script/sandbox-client.ts';

interface Message {
	readonly type: string;
	readonly message?: string;
	readonly entries?: readonly Readonly<{ text: string }>[];
}

async function evaluate(source: string): Promise<Message[]> {
	const prelude = readFileSync(new URL('../src/common/editor/macro-script/sandbox-prelude.js', import.meta.url), 'utf8');
	const messages: Message[] = [];
	const listeners = new Map<string, (event: unknown) => void>();
	const context = vm.createContext({ self: {
		postMessage(message: Message) { messages.push(message); },
		addEventListener(type: string, listener: (event: unknown) => void) { listeners.set(type, listener); },
	} });
	vm.runInContext(`(() => {'use strict';${buildMacroSandboxModule(prelude, source)}\n})();`, context);
	const boot = vm.runInContext('globalThis.__macroBoot()', context) as Promise<void>;
	listeners.get('message')?.({ data: { type: 'begin', runId: 'date-call', env: { seed: 'date-seed' } } });
	await boot;
	return messages;
}

test('ordinary callable Date and constructed Date share the advancing virtual clock', async () => {
	const messages = await evaluate([
		"sound.assertEqual(Date(), new Date(0).toString());",
		'await sound.wait(1000);',
		"sound.assertEqual(Date(), new Date(1000).toString());",
		"sound.assertEqual(Date('ignored'), new Date(1000).toString());",
		"sound.log.info('Date calls completed');",
	].join('\n'));
	assert.equal(messages.find(message => message.type === 'failed')?.message, undefined);
	assert.equal(messages.at(-1)?.type, 'done');
	assert.ok(messages.some(message => message.entries?.some(entry => entry.text === 'Date calls completed')));
});

test('the virtual Date retains explicit constructors, parsing and Date subclasses', async () => {
	const messages = await evaluate([
		"sound.assertEqual(new Date('2000-01-02T03:04:05Z').getTime(), Date.parse('2000-01-02T03:04:05Z'));",
		'sound.assertEqual(new Date(2000, 0, 2).getFullYear(), 2000);',
		'sound.assertEqual(new Date(Date.UTC(2000, 0, 2)).getUTCDate(), 2);',
		'class Timestamp extends Date {}',
		'await sound.wait(1234);',
		'const value = new Timestamp();',
		'sound.assert(value instanceof Date && value instanceof Timestamp);',
		'sound.assertEqual(value.getTime(), 1234);',
	].join('\n'));
	assert.equal(messages.find(message => message.type === 'failed')?.message, undefined);
	assert.equal(messages.at(-1)?.type, 'done');
});
