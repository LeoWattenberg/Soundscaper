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
	relocateSourceMapCheckout,
	write,
	writeJson,
} from './helpers/e2e-coverage-assembler-fixture.mjs';

after(cleanupE2ECoverageAssemblerFixtures);

test('platform runs retain distinct archive provenance behind identical executables', () => {
	const linux = makeFixture();
	const windows = makeFixture();
	relocateSourceMapCheckout(windows.evidenceRoot);
	const windowsRun = readJson(join(windows.runRoot, 'run.json'));
	windowsRun.runtime = { platform: 'win32', arch: 'x64' };
	writeJson(join(windows.runRoot, 'run.json'), windowsRun);
	for (const productId of ['framescaper', 'soundscaper']) {
		const manifestPath = join(windows.evidenceRoot, 'electron', productId, 'manifest.json');
		const manifest = readJson(manifestPath);
		manifest.packageArchive = {
			byteLength: manifest.packageArchive.byteLength + 1,
			sha256: hash(`${productId} windows archive`),
		};
		writeJson(manifestPath, manifest);
	}

	const result = assemblePair(linux, windows);
	assert.equal(readProfiles(join(
		result.outputRoot,
		'profiles/nightly-electron-soundscaper-main',
	)).length, 2);
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
	assert.doesNotThrow(() => validateCaptureIndex(result.captureIndex));
});

test('platform runs reject different packaged JavaScript', () => {
	const baseline = makeFixture();
	const changed = makeFixture();
	const electronRoot = join(changed.evidenceRoot, 'electron', 'soundscaper');
	const scriptPath = join(electronRoot, 'app/desktop/main.mjs');
	const changedScript = 'export const mainProduct = "changed";\n';
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
