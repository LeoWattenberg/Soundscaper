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
	await handlers.get('external')(null, 'privacy-en');
	assert.match(electron.opened.at(-1), /soundscaper\.org\/privacy\/en\/$/u);
	await handlers.get('external')(null, 'privacy-de');
	assert.match(electron.opened.at(-1), /soundscaper\.org\/privacy\/de\/$/u);
	for (const [destination, url] of [
		['manual', 'https://soundscaper.org/docs/'],
		['tutorials', 'https://soundscaper.org/docs/tutorials/your-first-project/'],
		['manual-fr', 'https://soundscaper.org/docs/fr/'],
		['tutorials-zh-cn', 'https://soundscaper.org/docs/zh-cn/tutorials/your-first-project/'],
	]) {
		await handlers.get('external')(null, destination);
		assert.equal(electron.opened.at(-1), url);
	}
	await assert.rejects(() => handlers.get('external')(null, 'unknown'), /unsupported external destination/iu);
	await assert.rejects(() => handlers.get('external')(null, 'manual-unknown'), /unsupported external destination/iu);
	await assert.rejects(() => handlers.get('external')(null, 'https://soundscaper.org/docs/'), /unsupported external destination/iu);
	const opened = electron.opened.length;
	await assert.rejects(() => handlers.get('external')(null, 'constructor'), /unsupported external destination/iu);
	assert.equal(electron.opened.length, opened);
	assert.throws(() => handlers.get('edit')(null, 'executeJavaScript'), /unsupported text edit command/iu);
});
