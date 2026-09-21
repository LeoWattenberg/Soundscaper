/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import {
	captureCdpWebAssemblyScript,
	createCdpJavaScriptCoverageState,
	javaScriptCoverageEntries,
	observeCdpScript,
} from '../scripts/lib/cdp-javascript-coverage.mjs';

const WASM_URL = 'wasm://wasm/cdb9d07e';
const WASM_BYTES = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

test('protocol-typed canonical WebAssembly is authenticated and excluded from JavaScript coverage', async () => {
	const webAssemblyScriptUrls = new Map<string, string>();
	const work = captureCdpWebAssemblyScript({
		...captureState(webAssemblyScriptUrls),
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
	});
	assert.ok(work);
	await work;
	assert.deepEqual([...webAssemblyScriptUrls], [['11', WASM_URL]]);
	assert.deepEqual(javaScriptCoverageEntries([
		coverageEntry('11', ''),
		coverageEntry('12', 'https://soundscaper.invalid/assets/app.js'),
	], new Map([['11', WASM_URL]]), webAssemblyScriptUrls), [
		coverageEntry('12', 'https://soundscaper.invalid/assets/app.js'),
	]);
});

test('a JavaScript sourceURL cannot masquerade as protocol-typed WebAssembly', () => {
	assert.equal(captureCdpWebAssemblyScript({
		...captureState(),
		event: { scriptId: '11', scriptLanguage: 'JavaScript', url: WASM_URL },
		session: { send: async () => ({}) },
	}), null);
	assert.throws(() => javaScriptCoverageEntries(
		[coverageEntry('11', WASM_URL)],
		new Map([['11', WASM_URL]]),
		new Map(),
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
			...captureState(),
			event: { scriptId: '11', scriptLanguage: 'WebAssembly', url },
			session: { send: async () => ({}) },
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
			...captureState(),
			event: { scriptId: '11', scriptLanguage: 'WebAssembly', url: WASM_URL },
			session: { send: async () => response },
		});
		assert.ok(work);
		await assert.rejects(work, /non-JavaScript WebAssembly bytes/u);
	}
});

test('a noncanonical typed WebAssembly URL needs exact caller authentication', async () => {
	const webAssemblyScriptUrls = new Map<string, string>();
	const url = 'http://127.0.0.1:4332/assets/pffft-BbtAeRsi.wasm';
	let authenticated: { bytes: Buffer, url: string } | null = null;
	const work = captureCdpWebAssemblyScript({
		...captureState(webAssemblyScriptUrls),
		authenticateWebAssembly: async (candidate) => {
			authenticated = candidate;
			return true;
		},
		event: { scriptId: 'built-wasm', scriptLanguage: 'WebAssembly', url },
		session: { send: async () => ({ bytecode: WASM_BYTES.toString('base64'), scriptSource: '' }) },
	});
	assert.ok(work);
	await work;
	assert.deepEqual(authenticated, { bytes: WASM_BYTES, url });
	assert.deepEqual(javaScriptCoverageEntries(
		[coverageEntry('built-wasm', '')],
		new Map([['built-wasm', url]]),
		webAssemblyScriptUrls,
	), []);
	assert.throws(() => javaScriptCoverageEntries(
		[coverageEntry('built-wasm', `${url}?changed=1`)],
		new Map(),
		webAssemblyScriptUrls,
	), /different WebAssembly script URL/u);
});

test('a caller-authenticated WebAssembly URL fails closed without authentication', async () => {
	const work = captureCdpWebAssemblyScript({
		...captureState(),
		authenticateWebAssembly: async () => false,
		event: {
			scriptId: 'built-wasm',
			scriptLanguage: 'WebAssembly',
			url: 'http://127.0.0.1:4332/assets/pffft.wasm',
		},
		session: { send: async () => ({ bytecode: WASM_BYTES.toString('base64'), scriptSource: '' }) },
	});
	assert.ok(work);
	await assert.rejects(work, /not authenticated/u);
});

test('one CDP script identity cannot be rebound to different authenticated WebAssembly', async () => {
	const webAssemblyScriptUrls = new Map([['built-wasm', WASM_URL]]);
	const work = captureCdpWebAssemblyScript({
		...captureState(webAssemblyScriptUrls),
		authenticateWebAssembly: async () => true,
		event: {
			scriptId: 'built-wasm',
			scriptLanguage: 'WebAssembly',
			url: 'http://127.0.0.1:4332/assets/pffft.wasm',
		},
		session: { send: async () => ({ bytecode: WASM_BYTES.toString('base64'), scriptSource: '' }) },
	});
	assert.ok(work);
	await assert.rejects(work, /rebound WebAssembly script/u);
});

test('an authenticated WebAssembly script identity cannot later be rebound as JavaScript', async () => {
	const state = createCdpJavaScriptCoverageState();
	const first = observeCdpScript({
		event: { scriptId: '11', scriptLanguage: 'WebAssembly', url: WASM_URL },
		session: { send: async () => ({ bytecode: WASM_BYTES.toString('base64'), scriptSource: '' }) },
		state,
	});
	assert.ok(first);
	await first;
	const rebound = observeCdpScript({
		event: { scriptId: '11', scriptLanguage: 'JavaScript', url: WASM_URL },
		session: { send: async () => ({}) },
		state,
	});
	assert.ok(rebound);
	await assert.rejects(rebound, /CDP rebound script.*WebAssembly.*JavaScript/u);
});

test('a JavaScript script identity cannot later be rebound as WebAssembly', async () => {
	const state = createCdpJavaScriptCoverageState();
	const javaScript = { scriptId: '11', scriptLanguage: 'JavaScript', url: WASM_URL };
	assert.equal(observeCdpScript({
		event: javaScript,
		session: { send: async () => ({}) },
		state,
	}), null);
	assert.equal(observeCdpScript({
		event: javaScript,
		session: { send: async () => ({}) },
		state,
	}), null, 'an exact duplicate scriptParsed event is harmless');
	const urlRebound = observeCdpScript({
		event: { ...javaScript, url: `${WASM_URL}/changed` },
		session: { send: async () => ({}) },
		state,
	});
	assert.ok(urlRebound);
	await assert.rejects(urlRebound, /CDP rebound script.*JavaScript/u);
	const rebound = observeCdpScript({
		event: { ...javaScript, scriptLanguage: 'WebAssembly' },
		session: { send: async () => ({ bytecode: WASM_BYTES.toString('base64'), scriptSource: '' }) },
		state,
	});
	assert.ok(rebound);
	await assert.rejects(rebound, /CDP rebound script.*JavaScript.*WebAssembly/u);
});

function coverageEntry(scriptId: string, url: string) {
	return {
		functions: [],
		scriptId,
		url,
	};
}

function captureState(webAssemblyScriptUrls = new Map<string, string>()) {
	return {
		scriptIdentities: new Map<string, { language: string, url: unknown }>(),
		scriptUrls: new Map<string, string>(),
		webAssemblyScriptUrls,
	};
}
