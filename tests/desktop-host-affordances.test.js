/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const ELECTRON_STUB = 'stub-electron:main';
const ELECTRON_STUB_SOURCE = `
export const opened = [];
export const shell = { openExternal: async (url) => { opened.push(url); } };
`;

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'electron/main') return { url: ELECTRON_STUB, shortCircuit: true };
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url === ELECTRON_STUB) return { format: 'module', source: ELECTRON_STUB_SOURCE, shortCircuit: true };
		return nextLoad(url, context);
	},
});

const electron = await import('electron/main');
const { registerHostAffordances } = await import('../desktop/host-affordances.mjs');

test('text-edit affordances resolve the live application window at invocation time', () => {
	const handlers = new Map();
	let current = null;
	registerHostAffordances({
		channels: { editText: 'edit', openExternal: 'external' },
		handle: (channel, listener) => handlers.set(channel, listener),
		windowFor: () => current,
	});
	assert.throws(() => handlers.get('edit')(null, 'copy'), /window is unavailable/iu);

	const first = [];
	current = { isDestroyed: () => false, webContents: { copy: () => first.push('copy') } };
	assert.equal(handlers.get('edit')(null, 'copy'), true);
	assert.deepEqual(first, ['copy']);

	const second = [];
	current = { isDestroyed: () => false, webContents: { paste: () => second.push('paste') } };
	assert.equal(handlers.get('edit')(null, 'paste'), true);
	assert.deepEqual(first, ['copy']);
	assert.deepEqual(second, ['paste']);
});

test('host affordances retain their closed command and destination sets', async () => {
	const handlers = new Map();
	registerHostAffordances({
		channels: { editText: 'edit', openExternal: 'external' },
		handle: (channel, listener) => handlers.set(channel, listener),
		windowFor: () => ({ isDestroyed: () => false, webContents: {} }),
	});
	await handlers.get('external')(null, 'source');
	assert.match(electron.opened.at(-1), /github\.com\/LeoWattenberg\/Soundscaper$/u);
	await assert.rejects(() => handlers.get('external')(null, 'unknown'), /unsupported external destination/iu);
	assert.throws(() => handlers.get('edit')(null, 'executeJavaScript'), /unsupported text edit command/iu);
});
