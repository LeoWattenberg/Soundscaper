/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { prepareE2ECoverageArtifacts } from '../scripts/lib/e2e-coverage-builder.mjs';
import { parseE2ECoverageConfiguration } from '../scripts/lib/e2e-coverage-contract.mjs';

const REVISION = '0123456789abcdef0123456789abcdef01234567';
const BROWSER = 'browser-chromium-soundscaper-renderer';
const MAIN = 'nightly-electron-soundscaper-main';
const workspaces = [];

after(() => {
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
});

test('the capture-index builder copies exact evidence and emits a canonical bound contract', () => {
	const fixture = makeFixture();
	const result = prepareE2ECoverageArtifacts(fixture);
	const inventoryOnDisk = JSON.parse(readFileSync(join(fixture.artifactRoot, 'inventory.json'), 'utf8'));

	assert.deepEqual(inventoryOnDisk, result.inventory);
	assert.equal(result.inventory.sources.length, 2);
	assert.equal(result.inventory.scripts.length, 2);
	assert.equal(result.manifests.length, 2);
	assert.equal(
		readFileSync(join(fixture.artifactRoot, 'executables/nightly-main.mjs'), 'utf8'),
		'export const packaged = true;\n',
	);
	assert.deepEqual(
		JSON.parse(readFileSync(join(fixture.artifactRoot, 'surfaces', MAIN, 'v8/profile.json'), 'utf8')),
		{ result: [{ url: 'file:///__soundscaper_e2e__/nightly/main.mjs' }] },
	);
	const mainManifest = JSON.parse(readFileSync(
		join(fixture.artifactRoot, 'surfaces', MAIN, 'manifest.json'),
		'utf8',
	));
	assert.equal(mainManifest.inventoryDigest, result.inventory.digest);
	assert.deepEqual(mainManifest.observedScripts, [{
		id: `${MAIN}/main.mjs`,
		sha256: result.inventory.scripts.find(({ surface }) => surface === MAIN).sha256,
	}]);
});

test('the builder refuses a capture that omits a mandatory surface before writing a contract', () => {
	const fixture = makeFixture();
	fixture.captureIndex.surfaces.pop();

	assert.throws(
		() => prepareE2ECoverageArtifacts(fixture),
		/must list every configured surface/u,
	);
});

function makeFixture() {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-e2e-builder-'));
	workspaces.push(workspace);
	const repositoryRoot = join(workspace, 'repository');
	const captureRoot = join(workspace, 'capture');
	const artifactRoot = join(workspace, 'prepared');
	write(join(repositoryRoot, 'src/browser.js'), 'export const browser = true;\n');
	write(join(captureRoot, 'browser/app.js'), 'globalThis.browser = true;\n');
	write(join(captureRoot, 'nightly/main.mjs'), 'export const packaged = true;\n');
	writeProfile(
		join(captureRoot, 'profiles/browser/profile.json'),
		'file:///__soundscaper_e2e__/browser/app.js',
	);
	writeProfile(
		join(captureRoot, 'profiles/main/profile.json'),
		'file:///__soundscaper_e2e__/nightly/main.mjs',
	);
	const configuration = parseE2ECoverageConfiguration({
		schemaVersion: 1,
		thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 },
		repositorySourceRoots: ['src/'],
		requiredSurfaces: [
			{ id: BROWSER, coverageFormat: 'v8', description: 'The complete Soundscaper browser renderer surface.' },
			{ id: MAIN, coverageFormat: 'v8', description: 'The complete packaged Soundscaper main process surface.' },
		],
		reason: 'The fixture preserves the strict one hundred percent gate while exercising deterministic capture artifact preparation.',
	});
	const captureIndex = {
		schemaVersion: 1,
		kind: 'soundscaper-e2e-capture-index',
		sourceRevision: REVISION,
		sources: [
			{
				path: 'src/browser.js',
				origin: 'repository',
				surfaces: [BROWSER],
			},
			{
				path: `generated/${MAIN}/main.mjs`,
				origin: 'artifact',
				inputPath: 'nightly/main.mjs',
				artifactPath: 'executables/nightly-main.mjs',
				surfaces: [MAIN],
			},
		],
		scripts: [
			{
				id: `${BROWSER}/app.js`,
				surface: BROWSER,
				inputPath: 'browser/app.js',
				artifactPath: 'executables/browser-app.js',
				coverageUrl: 'file:///__soundscaper_e2e__/browser/app.js',
				sources: ['src/browser.js'],
			},
			{
				id: `${MAIN}/main.mjs`,
				surface: MAIN,
				inputPath: 'nightly/main.mjs',
				artifactPath: 'executables/nightly-main.mjs',
				coverageUrl: 'file:///__soundscaper_e2e__/nightly/main.mjs',
				sources: [`generated/${MAIN}/main.mjs`],
			},
		],
		surfaces: [
			{ id: BROWSER, coverage: { format: 'v8', inputPath: 'profiles/browser', path: 'v8' } },
			{ id: MAIN, coverage: { format: 'v8', inputPath: 'profiles/main', path: 'v8' } },
		],
	};
	return { repositoryRoot, captureRoot, artifactRoot, configuration, captureIndex };
}

function writeProfile(path, url) {
	write(path, `${JSON.stringify({ result: [{ url }] })}\n`);
}

function write(path, value) {
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, value);
}
