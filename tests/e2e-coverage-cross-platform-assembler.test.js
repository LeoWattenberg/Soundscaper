/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { assembleE2ECoverageCapture } from '../scripts/lib/e2e-coverage-assembler.mjs';
import { validateCaptureIndex } from '../scripts/lib/e2e-coverage-builder.mjs';
import {
	cleanupE2ECoverageAssemblerFixtures,
	hash,
	makeFixture,
	readJson,
	readProfiles,
	recordBrowserEvidence,
	refreshPackagedResourceIdentity,
	relocateSourceMapCheckout,
	rewritePackagedLayout,
	write,
	writeJson,
} from './helpers/e2e-coverage-assembler-fixture.mjs';

after(cleanupE2ECoverageAssemblerFixtures);

test('platform runs retain distinct archive provenance behind identical executables', () => {
	const linux = makeFixture();
	const windows = makeFixture();
	rewritePackagedLayout(windows, {
		platform: 'win32',
		executable: (product) => `C:\\Nightly\\${product}\\${product}.exe`,
		url: (product, path) => `file:///C:/Nightly/${product}/resources/app.asar/${path}`,
	});
	relocateSourceMapCheckout(windows.evidenceRoot);
	for (const productId of ['framescaper', 'soundscaper']) {
		const manifestPath = join(windows.evidenceRoot, 'electron', productId, 'manifest.json');
		const manifest = readJson(manifestPath);
		const runtimePath = `runtime/windows-${productId}/index.js`;
		const runtimeSource = `module.exports = ${JSON.stringify(`windows-${productId}`)};\n`;
		manifest.excludedRuntimeScripts = [{
			path: runtimePath,
			byteLength: Buffer.byteLength(runtimeSource),
			sha256: hash(runtimeSource),
		}];
		manifest.packageArchive = {
			byteLength: manifest.packageArchive.byteLength + 1,
			sha256: hash(`${productId} windows archive`),
		};
		writeJson(manifestPath, manifest);
		const profilePath = join(windows.runRoot, `coverage/v8-packaged/packaged-${productId}.json`);
		const profile = readJson(profilePath);
		const runtimeEntry = profile.result.find(({ url }) => url.includes('/runtime/'));
		delete profile['script-source-cache'][runtimeEntry.url];
		runtimeEntry.url = `file:///C:/Nightly/${productId}/resources/${runtimePath}`;
		profile['script-source-cache'][runtimeEntry.url] = runtimeSource;
		profile['soundscaper-packaged-runtime'].appAsar.beforeLaunch = { ...manifest.packageArchive };
		profile['soundscaper-packaged-runtime'].appAsar.afterCollection = { ...manifest.packageArchive };
		writeJson(profilePath, profile);
		const processId = productId === 'framescaper' ? '4100' : '4101';
		const nodePath = join(
			windows.runRoot,
			`coverage/v8-packaged/coverage-${processId}-fixture-0.json`,
		);
		const node = readJson(nodePath);
		node.result.find(({ url }) => url.includes('/runtime/')).url = runtimeEntry.url;
		writeJson(nodePath, node);
		refreshPackagedResourceIdentity(windows, productId);
	}

	const result = assemblePair(linux, windows);
	assert.equal(readProfiles(join(
		result.outputRoot,
		'profiles/nightly-electron-soundscaper-main',
	)).length, 4, 'ordinary and local main profiles are retained for both platforms');
	assert.deepEqual(result.captureIndex.buildEvidence.map(({ runtime }) => runtime), [
		{ platform: 'linux', arch: 'x64' },
		{ platform: 'win32', arch: 'x64' },
	]);
	assert.notEqual(
		result.captureIndex.buildEvidence[0].digest,
		result.captureIndex.buildEvidence[1].digest,
		'target archives keep distinct full provenance',
	);
	assert.equal(
		result.captureIndex.buildEvidence[0].executableDigest,
		result.captureIndex.buildEvidence[1].executableDigest,
		'exact executable and normalized-map evidence is the union identity',
	);
	assert.notDeepEqual(
		result.captureIndex.buildEvidence[0].packageArchives,
		result.captureIndex.buildEvidence[1].packageArchives,
	);
	assert.notDeepEqual(
		result.captureIndex.buildEvidence[0].excludedRuntimeScripts,
		result.captureIndex.buildEvidence[1].excludedRuntimeScripts,
	);
	assert.notDeepEqual(
		result.captureIndex.buildEvidence[0].executableResources,
		result.captureIndex.buildEvidence[1].executableResources,
	);
	assert.doesNotThrow(() => validateCaptureIndex(result.captureIndex));
});

test('platform unions reject changed packaged HTML even when JavaScript is identical', () => {
	const baseline = makeFixture();
	const changed = makeFixture();
	const documentPath = join(changed.evidenceRoot, 'electron/soundscaper/renderer/index.html');
	const source = '<main>different safe packaged document</main>\n';
	write(documentPath, source);
	const manifestPath = join(changed.evidenceRoot, 'electron/soundscaper/manifest.json');
	const manifest = readJson(manifestPath);
	const document = manifest.documents.find(({ artifactPath }) => artifactPath === 'renderer/index.html');
	document.byteLength = Buffer.byteLength(source);
	document.sha256 = hash(source);
	writeJson(manifestPath, manifest);
	refreshPackagedResourceIdentity(changed, 'soundscaper');

	assert.throws(() => assemblePair(baseline, changed), /different executable build-evidence hashes/u);
});

test('same-target unions reject changed authenticated runtime resources', () => {
	const baseline = makeFixture();
	const changed = makeFixture();
	replaceRuntimeExclusion({
		fixture: changed,
		productId: 'soundscaper',
		path: 'runtime/alternate-vendor/index.js',
		source: 'module.exports = "alternate authenticated runtime";\n',
		url: 'file:///opt/soundscaper/resources/runtime/alternate-vendor/index.js',
	});
	assert.throws(() => assemblePair(baseline, changed), /different full build-evidence hashes/u);
});

test('platform runs reject different packaged JavaScript', () => {
	const baseline = makeFixture();
	const changed = makeFixture();
	const electronRoot = join(changed.evidenceRoot, 'electron', 'soundscaper');
	const scriptPath = join(electronRoot, 'app/desktop/main.mjs');
	const changedScript = readFileSync(scriptPath, 'utf8').replace(
		'export const mainProduct = "soundscaper";',
		'export const mainProduct = "changed";',
	);
	write(scriptPath, changedScript);
	const manifestPath = join(electronRoot, 'manifest.json');
	const manifest = readJson(manifestPath);
	const record = manifest.scripts.find(({ artifactPath }) => (
		artifactPath === 'app/desktop/main.mjs'
	));
	record.byteLength = Buffer.byteLength(changedScript);
	record.sha256 = hash(changedScript);
	writeJson(manifestPath, manifest);

	assert.throws(() => assemblePair(baseline, changed), /different executable build-evidence hashes/u);
});

test('platform runs reject different packaged WebAssembly', () => {
	const baseline = makeFixture();
	const changed = makeFixture();
	const electronRoot = join(changed.evidenceRoot, 'electron', 'soundscaper');
	const artifactPath = 'webassembly/renderer/assets/a-b.wasm';
	const bytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x01]);
	write(join(electronRoot, artifactPath), bytes);
	const manifestPath = join(electronRoot, 'manifest.json');
	const manifest = readJson(manifestPath);
	const record = manifest.webAssemblyResources.find((entry) => entry.artifactPath === artifactPath);
	record.byteLength = bytes.byteLength;
	record.sha256 = hash(bytes);
	writeJson(manifestPath, manifest);
	refreshPackagedResourceIdentity(changed, 'soundscaper');

	assert.throws(() => assemblePair(baseline, changed), /different executable build-evidence hashes/u);
});

test('platform runs reject different normalized source maps', () => {
	const baseline = makeFixture();
	const changed = makeFixture();
	const electronRoot = join(changed.evidenceRoot, 'electron', 'soundscaper');
	const mapPath = join(electronRoot, 'renderer-source-maps/app.js.map');
	const map = readJson(mapPath);
	map.mappings = 'AACA';
	writeJson(mapPath, map);
	const manifestPath = join(electronRoot, 'manifest.json');
	const manifest = readJson(manifestPath);
	const mapBytes = readFileSync(mapPath);
	manifest.sourceMaps[0].byteLength = mapBytes.byteLength;
	manifest.sourceMaps[0].sha256 = hash(mapBytes);
	writeJson(manifestPath, manifest);

	assert.throws(() => assemblePair(baseline, changed), /different executable build-evidence hashes/u);
});

test('platform runs reject different authenticated browser evidence', () => {
	const baseline = makeFixture();
	const changed = makeFixture();
	const site = join(changed.evidenceRoot, 'browser/soundscaper/site');
	write(join(site, 'release.txt'), 'different build\n');
	recordBrowserEvidence(site, 'soundscaper', changed.expectedRevision);

	assert.throws(() => assemblePair(baseline, changed), /different executable build-evidence hashes/u);
});

function assemblePair(first, second) {
	return assembleE2ECoverageCapture({
		repositoryRoot: first.repositoryRoot,
		runRoots: [first.runRoot, second.runRoot],
		outputRoot: first.outputRoot,
		expectedRevision: first.expectedRevision,
	});
}

function replaceRuntimeExclusion({ fixture, productId, path, source, url }) {
	const manifestPath = join(fixture.evidenceRoot, 'electron', productId, 'manifest.json');
	const manifest = readJson(manifestPath);
	manifest.excludedRuntimeScripts = [{
		path,
		byteLength: Buffer.byteLength(source),
		sha256: hash(source),
	}];
	writeJson(manifestPath, manifest);
	const profilePath = join(fixture.runRoot, `coverage/v8-packaged/packaged-${productId}.json`);
	const profile = readJson(profilePath);
	const runtimeEntry = profile.result.find(({ url: candidate }) => candidate.includes('/runtime/'));
	delete profile['script-source-cache'][runtimeEntry.url];
	runtimeEntry.url = url;
	profile['script-source-cache'][url] = source;
	writeJson(profilePath, profile);
	const processId = productId === 'framescaper' ? '4100' : '4101';
	const nodePath = join(fixture.runRoot, `coverage/v8-packaged/coverage-${processId}-fixture-0.json`);
	const node = readJson(nodePath);
	node.result.find(({ url: candidate }) => candidate.includes('/runtime/')).url = url;
	writeJson(nodePath, node);
	refreshPackagedResourceIdentity(fixture, productId);
}
