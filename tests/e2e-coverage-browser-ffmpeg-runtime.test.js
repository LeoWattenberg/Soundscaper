/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { assembleE2ECoverageCapture } from '../scripts/lib/e2e-coverage-assembler.mjs';
import { browserFfmpegCoverageContract } from '../scripts/lib/browser-ffmpeg-coverage.mjs';
import {
	cleanupE2ECoverageAssemblerFixtures,
	makeFixture,
	readJson,
	v8Entry,
	writeJson,
} from './helpers/e2e-coverage-assembler-fixture.mjs';

const ROOT = join(import.meta.dirname, '..');
const SOURCE = readFileSync(join(ROOT, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js'), 'utf8');

after(cleanupE2ECoverageAssemblerFixtures);

test('browser assembly excludes only manifest-pinned FFmpeg bytes at the canonical URL', () => {
	const fixture = makeFixture();
	const contract = browserFfmpegCoverageContract(fixture.repositoryRoot, fixture.expectedRevision);
	addBrowserFfmpeg(fixture, contract.url, SOURCE);
	addBrowserFfmpeg(fixture, contract.wasm.url, '');

	const assembled = assembleE2ECoverageCapture(fixture);
	assert.equal(
		assembled.captureIndex.scripts.some(({ coverageUrl }) => coverageUrl === contract.url),
		false,
	);
	assert.equal(
		assembled.captureIndex.sources.some(({ path }) => path.includes('ffmpeg-core.js')),
		false,
	);
});

test('browser assembly rejects source-cache spoofing and nearby URLs for FFmpeg Wasm', () => {
	const spoofed = makeFixture();
	const spoofedContract = browserFfmpegCoverageContract(spoofed.repositoryRoot, spoofed.expectedRevision);
	addBrowserFfmpeg(spoofed, spoofedContract.wasm.url, 'spoofed JavaScript');
	assert.throws(
		() => assembleE2ECoverageCapture(spoofed),
		/expected empty source.*Wasm/iu,
	);
	const missing = makeFixture();
	const missingContract = browserFfmpegCoverageContract(missing.repositoryRoot, missing.expectedRevision);
	addBrowserFfmpeg(missing, missingContract.wasm.url, undefined);
	assert.throws(
		() => assembleE2ECoverageCapture(missing),
		/expected empty source.*Wasm/iu,
	);

	const nearby = makeFixture();
	const nearbyContract = browserFfmpegCoverageContract(nearby.repositoryRoot, nearby.expectedRevision);
	addBrowserFfmpeg(nearby, `${nearbyContract.wasm.url}?cache=1`, undefined);
	assert.throws(
		() => assembleE2ECoverageCapture(nearby),
		/unmapped first-party browser script/iu,
	);
});

test('browser assembly rejects changed or missing bytes at the canonical FFmpeg URL', () => {
	for (const source of [`${SOURCE} `, undefined]) {
		const fixture = makeFixture();
		const contract = browserFfmpegCoverageContract(fixture.repositoryRoot, fixture.expectedRevision);
		addBrowserFfmpeg(fixture, contract.url, source);
		assert.throws(
			() => assembleE2ECoverageCapture(fixture),
			/captured no source bytes|does not match its committed runtime pin/iu,
		);
	}
});

test('browser assembly rejects exact FFmpeg bytes at non-canonical URLs', () => {
	for (const rewrite of [
		(url) => `${url}?cache=1`,
		(url) => `${url}#fragment`,
		(url) => url.replace('https://', 'https://user@'),
		(url) => url.replace('.org/', '.org:443/'),
		(url) => url.replace('/ffmpeg-core.js', '/FFmpeg-core.js'),
		(url) => url.replace('/ffmpeg-core.js', '/%66mpeg-core.js'),
		(url) => url.replace('assets.soundscaper.org', 'example.invalid'),
	]) {
		const fixture = makeFixture();
		const contract = browserFfmpegCoverageContract(fixture.repositoryRoot, fixture.expectedRevision);
		const url = rewrite(contract.url);
		addBrowserFfmpeg(fixture, url, SOURCE);
		assert.throws(
			() => assembleE2ECoverageCapture(fixture),
			/unmapped first-party browser script/iu,
			url,
		);
	}
});

test('assembly refuses a dirty manifest that jointly pins attacker-controlled browser bytes', () => {
	const fixture = makeFixture();
	const manifestPath = join(fixture.repositoryRoot, 'config/ffmpeg-runtime-manifest.json');
	const manifest = readJson(manifestPath);
	const source = 'globalThis.__dirtyManifestBypass = true;';
	const descriptor = manifest.runtime.files.find(({ name }) => name === 'ffmpeg-core.js');
	descriptor.byteLength = Buffer.byteLength(source);
	descriptor.sha256 = sha256(source);
	writeJson(manifestPath, manifest);
	const contract = browserFfmpegCoverageContract(fixture.repositoryRoot);
	addBrowserFfmpeg(fixture, contract.url, source);

	assert.throws(
		() => assembleE2ECoverageCapture(fixture),
		/config\/ffmpeg-runtime-manifest\.json differs from declared revision/iu,
	);
});

test('packaged Node FFmpeg data URLs use the same revision-bound runtime pin', () => {
	const fixture = makeFixture();
	const contract = browserFfmpegCoverageContract(fixture.repositoryRoot, fixture.expectedRevision);
	const profilePath = join(fixture.runRoot, 'coverage/v8-packaged/coverage-4101-fixture-0.json');
	const profile = readJson(profilePath);
	profile.result.push(v8Entry(`data:text/javascript;base64,${Buffer.from(SOURCE).toString('base64')}`));
	writeJson(profilePath, profile);
	assert.doesNotThrow(() => assembleE2ECoverageCapture(fixture));

	const manifestPath = join(fixture.repositoryRoot, 'config/ffmpeg-runtime-manifest.json');
	const manifest = readJson(manifestPath);
	const source = 'globalThis.__dirtyNodeManifestBypass = true;';
	const descriptor = manifest.runtime.files.find(({ name }) => name === 'ffmpeg-core.js');
	descriptor.byteLength = Buffer.byteLength(source);
	descriptor.sha256 = sha256(source);
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	profile.result.at(-1).url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
	writeJson(profilePath, profile);
	assert.throws(
		() => assembleE2ECoverageCapture(fixture),
		/config\/ffmpeg-runtime-manifest\.json differs from declared revision/iu,
	);
	assert.equal(contract.byteLength, Buffer.byteLength(SOURCE));
});

function addBrowserFfmpeg(fixture, url, source) {
	const path = join(fixture.runRoot, 'coverage/v8-browser/browser.json');
	const profile = readJson(path);
	profile.result.push(v8Entry(url));
	if (source !== undefined) profile['script-source-cache'][url] = source;
	writeJson(path, profile);
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
