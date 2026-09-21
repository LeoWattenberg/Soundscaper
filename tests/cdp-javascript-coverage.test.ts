/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import {
	captureCdpWebAssemblyScript,
	javaScriptCoverageEntries,
} from '../scripts/lib/cdp-javascript-coverage.mjs';

const WASM_URL = 'wasm://wasm/cdb9d07e';
const WASM_BYTES = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

test('protocol-typed canonical WebAssembly is authenticated and excluded from JavaScript coverage', async () => {
	const webAssemblyScriptIds = new Set<string>();
	const work = captureCdpWebAssemblyScript({
		event: {
			scriptId: '11',
			scriptLanguage: 'WebAssembly',
			url: WASM_URL,
		},
		session: {
			send: async () => ({
				bytecode: WASM_BYTES.toString('base64'),
				scriptSource: '',
			}),
		},
		webAssemblyScriptIds,
	});
	assert.ok(work);
	await work;
	assert.deepEqual([...webAssemblyScriptIds], ['11']);
	assert.deepEqual(javaScriptCoverageEntries([
		coverageEntry('11', ''),
		coverageEntry('12', 'https://soundscaper.invalid/assets/app.js'),
	], new Map([['11', WASM_URL]]), webAssemblyScriptIds), [
		coverageEntry('12', 'https://soundscaper.invalid/assets/app.js'),
	]);
});

test('a JavaScript sourceURL cannot masquerade as protocol-typed WebAssembly', () => {
	assert.equal(captureCdpWebAssemblyScript({
		event: { scriptId: '11', scriptLanguage: 'JavaScript', url: WASM_URL },
		session: { send: async () => ({}) },
		webAssemblyScriptIds: new Set(),
	}), null);
	assert.throws(() => javaScriptCoverageEntries(
		[coverageEntry('11', WASM_URL)],
		new Map([['11', WASM_URL]]),
		new Set(),
	), /without protocol WebAssembly attestation/u);
});

test('typed WebAssembly rejects noncanonical URLs and non-binary source replies', async () => {
	for (const url of [
		'wasm://wasm/CDB9D07E',
		'wasm://wasm/cdb9d07e/source',
		'wasm://wasm/cdb9d07',
		'wasm://other/cdb9d07e',
	]) {
		const work = captureCdpWebAssemblyScript({
			event: { scriptId: '11', scriptLanguage: 'WebAssembly', url },
			session: { send: async () => ({}) },
			webAssemblyScriptIds: new Set(),
		});
		assert.ok(work);
		await assert.rejects(work, /noncanonical WebAssembly script URL/u);
	}
	for (const response of [
		{ bytecode: WASM_BYTES.toString('base64'), scriptSource: 'void 0;' },
		{ bytecode: Buffer.from('not wasm').toString('base64'), scriptSource: '' },
		{ bytecode: 'not-base64', scriptSource: '' },
	]) {
		const work = captureCdpWebAssemblyScript({
			event: { scriptId: '11', scriptLanguage: 'WebAssembly', url: WASM_URL },
			session: { send: async () => response },
			webAssemblyScriptIds: new Set(),
		});
		assert.ok(work);
		await assert.rejects(work, /non-JavaScript WebAssembly bytes/u);
	}
});

function coverageEntry(scriptId: string, url: string) {
	return {
		functions: [],
		scriptId,
		url,
	};
}
