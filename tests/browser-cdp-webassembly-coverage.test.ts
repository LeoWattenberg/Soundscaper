/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createBrowserCoverageCollector } from '../scripts/lib/browser-coverage-profile.mjs';

const ORIGIN = 'http://127.0.0.1:4322';
const SCRIPT_URL = `${ORIGIN}/assets/app.js`;
const WASM_URL = 'wasm://wasm/00091612';

test('portable page collection excludes CDP-authenticated binary WebAssembly', async (context) => {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-browser-wasm-'));
	context.after(() => rmSync(workspace, { recursive: true, force: true }));
	const built = join(workspace, 'sites/soundscaper');
	mkdirSync(join(built, 'assets'), { recursive: true });
	writeFileSync(join(built, 'assets/app.js'), 'globalThis.measured = true;\n');
	mkdirSync(join(workspace, 'sites/soundscaper-source-maps'), { recursive: true });
	writeFileSync(join(workspace, 'sites/soundscaper-source-maps/app.js.map'), JSON.stringify({
		mappings: 'AAAA',
		names: [],
		sources: ['file:///checkout/src/measured.ts'],
		sourcesContent: ['globalThis.measured = true;\n'],
		version: 3,
	}));
	mkdirSync(join(workspace, 'src'), { recursive: true });
	writeFileSync(join(workspace, 'src/measured.ts'), 'globalThis.measured = true;\n');
	mkdirSync(join(workspace, 'config'), { recursive: true });
	for (const path of [
		'config/ffmpeg-runtime-manifest.json',
		'config/ffmpeg-runtime-publication-policy.json',
	]) writeFileSync(join(workspace, path), readFileSync(join(process.cwd(), path)));
	const coverageDirectory = join(workspace, 'coverage');
	const collector = createBrowserCoverageCollector({
		browserName: 'chromium',
		coverageDirectory,
		environment: {
			SCAPE_BROWSER_COVERAGE: '1',
			SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify([{
				origin: ORIGIN,
				outputDirectory: built,
				productId: 'soundscaper',
			}]),
		},
		repositoryRoot: workspace,
	});
	assert.ok(collector);
	collector.attach(fakeContext());
	await collector.collect('page with wasm', new Set());

	const [name] = readdirSync(coverageDirectory);
	const profile = JSON.parse(readFileSync(join(coverageDirectory, name), 'utf8')) as {
		result: Array<{ url: string }>;
		'script-source-cache': Record<string, string>;
	};
	assert.deepEqual(profile.result.map(({ url }) => url), [
		'file:///__soundscaper_e2e__/browser/soundscaper/assets/app.js',
	]);
	assert.equal(WASM_URL in profile['script-source-cache'], false);
});

function fakeContext() {
	const pageSession = new EventEmitter() as EventEmitter & {
		detach(): Promise<void>;
		send(method: string, parameters?: { scriptId?: string }): Promise<unknown>;
	};
	pageSession.detach = async () => {};
	pageSession.send = async (method, parameters) => {
		if (method === 'Debugger.enable') queueMicrotask(() => pageSession.emit('Debugger.scriptParsed', {
			scriptId: 'wasm',
			scriptLanguage: 'WebAssembly',
			url: WASM_URL,
		}));
		if (method === 'Debugger.getScriptSource' && parameters?.scriptId === 'wasm') {
			return { bytecode: 'AGFzbQEAAAA=', scriptSource: '' };
		}
		if (method === 'Profiler.takePreciseCoverage') return { result: [
			coverage('app', SCRIPT_URL, 28),
			coverage('wasm', WASM_URL, 8),
		] };
		return {};
	};
	const browserRoot = Object.assign(new EventEmitter(), {
		createChildSession() { throw new Error('No child target expected.'); },
	});
	const browserImplementation = Object.assign(new EventEmitter(), { _session: browserRoot });
	const browser = {
		_connection: { toImpl: () => browserImplementation },
		async newBrowserCDPSession() {},
	};
	const page = {
		context: pageContext,
		isClosed: () => false,
	};
	const context = {
		browser: () => browser,
		newCDPSession: async () => pageSession,
		on() {},
		pages: () => [page],
	};
	return context;

	function pageContext() { return context; }
}

function coverage(scriptId: string, url: string, endOffset: number) {
	return {
		functions: [{
			functionName: '',
			isBlockCoverage: true,
			ranges: [{ count: 1, endOffset, startOffset: 0 }],
		}],
		scriptId,
		url,
	};
}
