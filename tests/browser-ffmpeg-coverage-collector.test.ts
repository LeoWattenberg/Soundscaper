/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after } from 'node:test';

import { createBrowserCoverageCollector } from '../scripts/lib/browser-coverage-profile.mjs';
import { browserFfmpegCoverageContract } from '../scripts/lib/browser-ffmpeg-coverage.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ORIGIN = 'http://127.0.0.1:4322';
const workspaces: string[] = [];

after(() => {
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
});

test('collector authenticates and omits a source-less canonical FFmpeg Wasm parse record', async () => {
	const contract = browserFfmpegCoverageContract(ROOT);
	assert.equal(await collectOrphan({ source: '', url: contract.wasm.url }), null);
});

test('collector rejects stale or missing source for canonical FFmpeg Wasm', async () => {
	const contract = browserFfmpegCoverageContract(ROOT);
	for (const source of ['spoofed JavaScript', undefined]) {
		await assert.rejects(
			collectOrphan({ source, url: contract.wasm.url }),
			/expected empty source.*Wasm|captured no source bytes/iu,
		);
	}
});

test('collector rejects nearby external Wasm parse records without V8 ranges', async () => {
	const contract = browserFfmpegCoverageContract(ROOT);
	for (const url of [`${contract.wasm.url}?cache=1`, `${contract.wasm.url}#fragment`]) {
		await assert.rejects(
			collectOrphan({ source: '', url }),
			/unapproved dynamic script/iu,
		);
	}
});

async function collectOrphan(dynamic: { source: string | undefined, url: string }) {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-ffmpeg-collector-'));
	workspaces.push(workspace);
	const site = join(workspace, 'site');
	mkdirSync(site, { recursive: true });
	const collector = createBrowserCoverageCollector({
		browserName: 'chromium',
		coverageDirectory: join(workspace, 'coverage'),
		environment: {
			SCAPE_BROWSER_COVERAGE: '1',
			SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify([{
				origin: ORIGIN,
				outputDirectory: site,
				productId: 'soundscaper',
			}]),
		},
		repositoryRoot: ROOT,
	});
	assert.ok(collector);
	collector.attach(fakeContext(fakePage(dynamic)));
	return collector.collect('FFmpeg Wasm orphan', new Set<string>());
}

function fakePage(dynamic: { source: string | undefined, url: string }) {
	let parsed: ((value: unknown) => void) | null = null;
	const session = {
		async send(method: string) {
			if (method === 'Debugger.enable') {
				queueMicrotask(() => parsed?.({ scriptId: 'ffmpeg-wasm', url: dynamic.url }));
			}
			if (method === 'Debugger.getScriptSource') return { scriptSource: dynamic.source };
			if (method === 'Profiler.takePreciseCoverage') return { result: [] };
			return {};
		},
		on(event: string, listener: (value: unknown) => void) {
			if (event === 'Debugger.scriptParsed') parsed = listener;
		},
		async detach() {},
	};
	const page = {
		isClosed: () => false,
		context: () => ({
			async newCDPSession(target: unknown) {
				assert.equal(target, page);
				return session;
			},
		}),
	};
	return page;
}

function fakeContext(page: ReturnType<typeof fakePage>) {
	const child = Object.assign(new EventEmitter(), { async send() { return {}; } });
	const browserRoot = Object.assign(new EventEmitter(), {
		createChildSession() { return child; },
	});
	const browserImplementation = Object.assign(new EventEmitter(), { _session: browserRoot });
	const browser = {
		_connection: { toImpl: () => browserImplementation },
		async newBrowserCDPSession() {},
	};
	return {
		browser: () => browser,
		pages: () => [page],
		on() {},
	};
}
