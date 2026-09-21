/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after } from 'node:test';

import { browserCoverageProfile } from '../scripts/lib/browser-coverage-profile.mjs';
import {
	browserFfmpegCoverageContract,
	isBrowserFfmpegCoverage,
	retainedBrowserFfmpegCoverageScript,
} from '../scripts/lib/browser-ffmpeg-coverage.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const workspaces: string[] = [];

after(() => {
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
});

test('the browser FFmpeg contract binds the canonical production URL to exact shipped bytes', () => {
	const contract = browserFfmpegCoverageContract(ROOT);
	const source = readFileSync(join(ROOT, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js'), 'utf8');
	const retained = retainedBrowserFfmpegCoverageScript(contract.url, source, contract);
	assert.deepEqual(contract, {
		byteLength: 111_804,
		sha256: '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3',
		url: 'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/ffmpeg-core.js',
		wasm: {
			byteLength: 32_232_419,
			sha256: '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7',
			url: 'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/ffmpeg-core.wasm',
		},
	});
	assert.deepEqual(retained, {
		coverageUrl: contract.url,
		path: '/__soundscaper_dynamic__/ffmpeg-core.js',
		retainSource: true,
		source,
	});
	assert.throws(
		() => retainedBrowserFfmpegCoverageScript(contract.wasm.url, '', contract),
		/typed CDP bytecode attestation/u,
	);

	const profile = browserCoverageProfile([{
		functions: [],
		scriptId: 'ffmpeg',
		source,
		url: contract.url,
	}], (url, captured) => retainedBrowserFfmpegCoverageScript(url, captured, contract));
	assert.deepEqual(profile.result.map(({ url }) => url), [contract.url]);
	assert.equal(profile['script-source-cache'][contract.url], source);
	assert.deepEqual(Object.keys(profile['source-map-cache']), []);
	assert.equal(isBrowserFfmpegCoverage({
		contract,
		entry: profile.result[0],
		profile,
	}), true);
});

test('the browser FFmpeg contract rejects source mutation and missing captured bytes', () => {
	const contract = browserFfmpegCoverageContract(ROOT);
	const source = readFileSync(join(ROOT, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js'), 'utf8');
	for (const changed of [undefined, `${source} `]) {
		assert.throws(
			() => retainedBrowserFfmpegCoverageScript(contract.url, changed, contract),
			/captured no source bytes|does not match its committed runtime pin/iu,
		);
	}
	assert.throws(() => isBrowserFfmpegCoverage({
		contract,
		entry: { url: contract.url },
		profile: { 'script-source-cache': {} },
	}), /captured no source bytes/iu);
	assert.throws(() => isBrowserFfmpegCoverage({
		contract,
		entry: { url: contract.wasm.url },
		profile: { 'script-source-cache': {} },
	}), /bypassed typed CDP bytecode attestation/iu);
	assert.throws(
		() => retainedBrowserFfmpegCoverageScript(contract.wasm.url, undefined, contract),
		/typed CDP bytecode attestation/iu,
	);
});

test('nearby and normalized URLs never inherit the canonical FFmpeg admission', () => {
	const contract = browserFfmpegCoverageContract(ROOT);
	const source = readFileSync(join(ROOT, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js'), 'utf8');
	for (const url of [
		`${contract.url}?cache=1`,
		`${contract.url}#fragment`,
		contract.url.replace('https://', 'https://user@'),
		contract.url.replace('.org/', '.org:443/'),
		contract.url.replace('/ffmpeg-core.js', '/FFmpeg-core.js'),
		contract.url.replace('/ffmpeg-core.js', '/%66mpeg-core.js'),
		contract.url.replace('assets.soundscaper.org', 'example.invalid'),
	]) {
		assert.equal(retainedBrowserFfmpegCoverageScript(url, source, contract), null, url);
		assert.equal(isBrowserFfmpegCoverage({
			contract,
			entry: { url },
			profile: { 'script-source-cache': { [url]: source } },
		}), false, url);
	}
	assert.equal(
		retainedBrowserFfmpegCoverageScript(`${contract.wasm.url}?cache=1`, '', contract),
		null,
	);
	assert.equal(
		retainedBrowserFfmpegCoverageScript(`${contract.wasm.url}#fragment`, '', contract),
		null,
	);
});

test('the runtime publication policy must match its manifest pin', () => {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-ffmpeg-contract-'));
	workspaces.push(workspace);
	cpSync(join(ROOT, 'config'), join(workspace, 'config'), { recursive: true });
	const policyPath = join(workspace, 'config/ffmpeg-runtime-publication-policy.json');
	writeFileSync(policyPath, `${readFileSync(policyPath, 'utf8')} `);
	assert.throws(
		() => browserFfmpegCoverageContract(workspace),
		/browser FFmpeg coverage contract is invalid/iu,
	);
});
