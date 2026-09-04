/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { disableNativeSavePicker } from './browser/audio-editor-test-helpers.js';

const CASES = Object.freeze({
	'audio-editor-bext-metadata.spec.js': [
		'downloads an offline BWF with authored BEXT v2 metadata and canonical coding history',
		'downloads the same BEXT structure through bounded realtime BWF rendering',
	],
	'audio-editor-effects.spec.js': [
		'renders an Audacity rack effect from the first offline quantum',
		'edits and restores a parametric EQ rack through its graph controls',
	],
	'audio-editor-export-session.spec.js': [
		'streams aligned WAV stems into a local ZIP archive',
		'splits the mix into one file per label and archives the chapters',
		'renders a local WAV mix when OfflineAudioContext is available',
		'falls back to bounded realtime WAV rendering without OfflineAudioContext',
		'validates export choices and cancels a realtime render',
		'generates a complete MP3 with the dedicated browser codec',
	],
});

test('disableNativeSavePicker removes the native save picker before navigation', async () => {
	let initScript = null;
	await disableNativeSavePicker({
		async addInitScript(callback) { initScript = callback; },
	});
	assert.equal(typeof initScript, 'function');

	const original = Object.getOwnPropertyDescriptor(globalThis, 'showSaveFilePicker');
	try {
		Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: () => Promise.resolve(),
		});
		initScript();
		const disabled = Object.getOwnPropertyDescriptor(globalThis, 'showSaveFilePicker');
		assert.equal(disabled?.value, undefined);
		assert.equal(disabled?.configurable, true);
	} finally {
		if (original) Object.defineProperty(globalThis, 'showSaveFilePicker', original);
		else Reflect.deleteProperty(globalThis, 'showSaveFilePicker');
	}
});

for (const [fileName, testNames] of Object.entries(CASES)) {
	test(`${fileName} disables native save only for its browser-fallback workflows`, async () => {
		const source = await readFile(new URL(`./browser/${fileName}`, import.meta.url), 'utf8');
		const calls = [...source.matchAll(/^\s*await disableNativeSavePicker\(page\);$/gmu)];
		assert.equal(calls.length, testNames.length);
		for (const testName of testNames) {
			const block = extractTest(source, testName);
			const disable = block.indexOf('await disableNativeSavePicker(page);');
			const boot = block.indexOf('await bootEditor(page,');
			assert.notEqual(disable, -1, `${testName} must disable the native picker`);
			assert.ok(disable < boot, `${testName} must disable the native picker before bootEditor`);
		}
	});
}

test('the direct native WAV suite retains its File System Access harness', async () => {
	const source = await readFile(
		new URL('./browser/audio-editor-direct-wav-save.spec.js', import.meta.url),
		'utf8',
	);
	assert.doesNotMatch(source, /disableNativeSavePicker/u);
});

function extractTest(source, name) {
	const marker = `\ttest('${name}',`;
	const start = source.indexOf(marker);
	assert.notEqual(start, -1, `missing browser test: ${name}`);
	const remainder = source.slice(start + marker.length);
	const nextTest = remainder.search(/^\ttest\('/mu);
	return nextTest === -1 ? remainder : remainder.slice(0, nextTest);
}
