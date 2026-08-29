/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { unzipSync } from 'fflate';

import closure from '../config/desktop-bundled-codec-corresponding-source.json' with { type: 'json' };
import {
	createDesktopBundledCodecCorrespondingSourceZip,
	fetchVerifiedDesktopBundledCodecSource,
	validateDesktopBundledCodecSourceCheckout,
} from '../scripts/lib/desktop-bundled-codec-corresponding-source.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CODECS = Object.freeze(['flac', 'lame', 'mpg123', 'opus', 'twolame', 'vorbis', 'wavpack']);

test('the desktop corresponding-source checkout binds all seven shipped codec modules', async () => {
	const result = await validateDesktopBundledCodecSourceCheckout({ repositoryRoot: ROOT });
	assert.deepEqual(result.codecs.map(({ id }) => id), CODECS);
	assert.deepEqual(result.archives.map(({ fileName }) => fileName), [
		'flac-1.5.0.tar.xz',
		'lame-4.0.tar.gz',
		'libogg-1.3.6.tar.xz',
		'libvorbis-1.3.7.tar.xz',
		'mpg123-1.33.7-signing-key.asc',
		'mpg123-1.33.7.tar.bz2',
		'mpg123-1.33.7.tar.bz2.sig',
		'opus-1.6.1.tar.gz',
		'twolame-0.4.0.tar.gz',
	]);
	assert.equal(result.files.some(({ path }) => path.endsWith('.wasm')), false);
	assert.equal(result.files.some(({ path }) => path === 'scripts/lib/bundled-codec-source-input.mjs'), true);
	assert.equal(result.files.some(({ path }) => path === 'scripts/lib/wavpack-wasm-toolchain.mjs'), true);
	const sourcePaths = new Set(result.files.map(({ path }) => path));
	for (const codec of result.codecs) {
		assert.match(codec.wasm.sha256, /^[a-f\d]{64}$/u);
		assert.ok(codec.wasm.byteLength > 0);
		assert.equal(sourcePaths.has(`src/common/editor/${codec.id}/source-manifest.json`), true);
		assert.equal(sourcePaths.has(`scripts/build-${codec.id}-wasm.mjs`), true);
		assert.equal(sourcePaths.has(
			`src/common/editor/${codec.id}/native/soundscaper_${codec.id}.c`,
		), true);
	}
	for (const path of [
		'src/common/editor/lame/licenses/LGPL-2.0.txt',
		'src/common/editor/mpg123/licenses/MPG123.txt',
		'src/common/editor/twolame/licenses/TWOLAME.txt',
	]) assert.equal(sourcePaths.has(path), true);
});

test('the desktop corresponding-source checkout fails closed on a pinned input drift', async () => {
	const changed = structuredClone(closure);
	changed.codecs[0].buildScript.sha256 = '0'.repeat(64);
	await assert.rejects(
		validateDesktopBundledCodecSourceCheckout({ repositoryRoot: ROOT, closure: changed }),
		/reviewed evidence|digest/iu,
	);
});

test('corresponding-source upstream acquisition requires exact bounded bytes', async () => {
	const bytes = Buffer.from('reviewed-upstream-source');
	const descriptor = {
		url: 'https://sources.example.test/codec.tar.xz',
		fileName: 'codec.tar.xz',
		byteLength: bytes.byteLength,
		sha256: sha256(bytes),
	};
	const response = (body) => {
		const value = new Response(body, { status: 200 });
		Object.defineProperty(value, 'url', { value: descriptor.url });
		return value;
	};
	assert.deepEqual(
		await fetchVerifiedDesktopBundledCodecSource(descriptor, {
			fetchImpl: async () => response(bytes),
		}),
		bytes,
	);
	await assert.rejects(
		fetchVerifiedDesktopBundledCodecSource(descriptor, {
			fetchImpl: async () => response('changed-source'),
		}),
		/byte length|digest/iu,
	);
});

test('corresponding-source ZIPs are deterministic, self-describing, and exclude binaries', () => {
	const files = [
		{ path: 'src/wrapper.c', bytes: Buffer.from('wrapper') },
		{ path: 'upstream/codec.tar.xz', bytes: Buffer.from('source') },
	];
	const codecs = [{
		id: 'codec',
		buildScriptSha256: '2'.repeat(64),
		sourceManifestSha256: '3'.repeat(64),
		wasm: { path: 'codec.wasm', byteLength: 7, sha256: '1'.repeat(64) },
	}];
	const first = createDesktopBundledCodecCorrespondingSourceZip({
		applicationVersion: '1.2.3', codecs, files,
	});
	const second = createDesktopBundledCodecCorrespondingSourceZip({
		applicationVersion: '1.2.3', codecs, files: [...files].reverse(),
	});
	assert.equal(first.fileName, 'Soundscaper-1.2.3-bundled-codecs-corresponding-source.zip');
	assert.deepEqual(first.bytes, second.bytes);
	const entries = unzipSync(first.bytes);
	const root = 'Soundscaper-1.2.3-bundled-codecs-corresponding-source';
	assert.equal(String(Buffer.from(entries[`${root}/src/wrapper.c`])), 'wrapper');
	const receipt = JSON.parse(String(Buffer.from(entries[`${root}/BUNDLE-MANIFEST.json`])));
	assert.equal(receipt.applicationVersion, '1.2.3');
	assert.deepEqual(receipt.buildEnvironment, {
		nodeVersion: '26.5.0',
		emscriptenVersion: '3.1.64',
		dockerImage: 'emscripten/emsdk:3.1.64@sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc',
	});
	assert.deepEqual(receipt.files.map(({ path }) => path), ['src/wrapper.c', 'upstream/codec.tar.xz']);
	assert.equal(Object.keys(entries).some((path) => path.endsWith('.wasm')), false);
});

test('the checkout closure orders its files by code unit, not by host collation', async () => {
	const result = await validateDesktopBundledCodecSourceCheckout({ repositoryRoot: ROOT });
	const paths = result.files.map(({ path }) => path);
	assert.notDeepEqual(
		[...paths].sort(), [...paths].sort((left, right) => left.localeCompare(right)),
		'if collation ever agrees on this closure the hazard is gone, not the requirement',
	);
	assert.deepEqual(paths, [...paths].sort());
});

test('corresponding-source ZIPs order their entries by code unit, not by host collation', () => {
	const paths = ['config/closure.json', 'LICENSE', 'README.md', 'src/codec/NOTICE.md', 'src/codec/native/wrap.c'];
	const byCodeUnit = [...paths].sort();
	assert.notDeepEqual(byCodeUnit, [...paths].sort((left, right) => left.localeCompare(right)),
		'if collation ever agrees on these paths the hazard is gone, not the requirement');
	const built = createDesktopBundledCodecCorrespondingSourceZip({
		applicationVersion: '1.2.3',
		codecs: [{
			id: 'codec',
			buildScriptSha256: '2'.repeat(64),
			sourceManifestSha256: '3'.repeat(64),
			wasm: { path: 'codec.wasm', byteLength: 7, sha256: '1'.repeat(64) },
		}],
		files: paths.map((path) => ({ path, bytes: Buffer.from(path) })),
	});
	const root = 'Soundscaper-1.2.3-bundled-codecs-corresponding-source';
	assert.deepEqual(built.receipt.files.map(({ path }) => path), byCodeUnit);
	assert.deepEqual(
		Object.keys(unzipSync(built.bytes)).filter((entry) => !entry.endsWith('/BUNDLE-MANIFEST.json')),
		byCodeUnit.map((path) => `${root}/${path}`),
	);
});

test('desktop release assembly emits source before computing release checksums', async () => {
	const script = await readFile(resolve(ROOT, 'scripts/desktop-release-assets.mjs'), 'utf8');
	const sourceOffset = script.indexOf('await stageDesktopBundledCodecCorrespondingSource');
	const checksumOffset = script.indexOf("filter((name) => name !== 'SHA256SUMS')");
	assert.ok(sourceOffset >= 0 && sourceOffset < checksumOffset);
});

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
