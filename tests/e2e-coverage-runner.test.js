/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';

import {
	digestE2EInventory,
	parseE2ECoverageConfiguration,
	parseE2EInventory,
	parseE2ESurfaceManifest,
} from '../scripts/lib/e2e-coverage-contract.mjs';
import {
	materializeV8SurfaceCoverage,
	rebasePortableV8Profile,
} from '../scripts/lib/e2e-coverage-runner.mjs';
import {
	coverageFileRecords,
	e2eExecutableCoverageKey,
} from '../scripts/lib/e2e-coverage-integrity.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const REVISION = execFileSync('git', ['rev-parse', 'HEAD'], {
	cwd: REPOSITORY_ROOT,
	encoding: 'utf8',
}).trim();
const SURFACE = 'browser-chromium-soundscaper-renderer';
const TOKEN_URL = 'file:///__soundscaper_e2e__/browser/soundscaper/app.mjs';
const workspaces = [];

after(() => {
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
});

test('portable V8 tokens rebase to verified artifacts and current repository sources', () => {
	const fixture = makeFixture();
	const repositorySource = 'src/common/url.ts';
	const profile = {
		result: [{ url: TOKEN_URL, functions: [] }],
		'source-map-cache': {
			[TOKEN_URL]: {
				lineLengths: [10],
				data: {
					version: 3,
					sources: [`file:///__soundscaper_repo__/${repositorySource}`],
					sourcesContent: ['export const value = true;\n'],
					names: [],
					mappings: 'AAAA',
				},
			},
		},
	};

	const rebased = rebasePortableV8Profile(
		profile,
		fixture.inventory,
		REPOSITORY_ROOT,
		fixture.artifactRoot,
	);
	const artifactUrl = pathToFileURL(join(fixture.artifactRoot, fixture.scriptPath)).href;

	assert.equal(rebased.result[0].url, artifactUrl);
	assert.deepEqual(Object.keys(rebased['source-map-cache']), [artifactUrl]);
	assert.deepEqual(rebased['source-map-cache'][artifactUrl].data.sources, [
		pathToFileURL(join(REPOSITORY_ROOT, repositorySource)).href,
	]);
	assert.equal(profile.result[0].url, TOKEN_URL, 'rebasing must not mutate uploaded evidence');
});

test('the V8 adapter produces an Istanbul file map for an exact generated executable', () => {
	const fixture = makeFixture();
	const originalProfiles = join(fixture.workspace, 'original-v8');
	mkdirSync(originalProfiles);
	execFileSync(process.execPath, [join(fixture.artifactRoot, fixture.scriptPath)], {
		env: { ...process.env, NODE_V8_COVERAGE: originalProfiles },
	});
	const original = JSON.parse(readFileSync(join(
		originalProfiles,
		readdirSync(originalProfiles).find((name) => name.endsWith('.json')),
	), 'utf8'));
	const artifactUrl = pathToFileURL(join(fixture.artifactRoot, fixture.scriptPath)).href;
	const scriptCoverage = original.result.find(({ url }) => url === artifactUrl);
	assert.ok(scriptCoverage, 'Node must have measured the fixture script');
	const v8Directory = join(fixture.surfaceDirectory, 'v8');
	mkdirSync(v8Directory, { recursive: true });
	writeFileSync(join(v8Directory, 'coverage.json'), JSON.stringify({
		result: [{ ...scriptCoverage, url: TOKEN_URL }],
		'source-map-cache': {},
	}));

	const result = materializeV8SurfaceCoverage({
		repositoryRoot: REPOSITORY_ROOT,
		artifactRoot: fixture.artifactRoot,
		surfaceDirectory: fixture.surfaceDirectory,
		reportDirectory: join(fixture.workspace, 'report'),
		manifest: fixture.manifest,
		inventory: fixture.inventory,
	});

	assert.deepEqual(result.failures, []);
	assert.deepEqual(Object.keys(result.coverage), [fixture.sourcePath]);
	const measured = result.coverage[fixture.sourcePath];
	assert.ok(Object.keys(measured.s).length > 0, 'the Istanbul report must contain statements');
	assert.ok(Object.keys(measured.f).length > 0, 'the Istanbul report must contain functions');
});

test('source-map dependencies are excluded after remapping while repository code remains', () => {
	const fixture = makeFixture({ repositorySource: true });
	const originalProfiles = join(fixture.workspace, 'mapped-original-v8');
	mkdirSync(originalProfiles);
	execFileSync(process.execPath, [join(fixture.artifactRoot, fixture.scriptPath)], {
		env: { ...process.env, NODE_V8_COVERAGE: originalProfiles },
	});
	const original = JSON.parse(readFileSync(join(
		originalProfiles,
		readdirSync(originalProfiles).find((name) => name.endsWith('.json')),
	), 'utf8'));
	const artifactUrl = pathToFileURL(join(fixture.artifactRoot, fixture.scriptPath)).href;
	const scriptCoverage = original.result.find(({ url }) => url === artifactUrl);
	const repositoryContent = readFileSync(join(REPOSITORY_ROOT, fixture.sourcePath), 'utf8');
	const dependencyPath = 'node_modules/debug/src/index.js';
	const dependencyContent = readFileSync(join(REPOSITORY_ROOT, dependencyPath), 'utf8');
	const v8Directory = join(fixture.surfaceDirectory, 'v8');
	mkdirSync(v8Directory, { recursive: true });
	writeFileSync(join(v8Directory, 'coverage.json'), JSON.stringify({
		result: [{ ...scriptCoverage, url: TOKEN_URL }],
		'source-map-cache': {
			[TOKEN_URL]: {
				lineLengths: fixture.body.replace(/\n$/u, '').split('\n').map((line) => line.length),
				data: {
					version: 3,
					sources: [
						`file:///__soundscaper_repo__/${fixture.sourcePath}`,
						'file:///__soundscaper_external__/node_modules/debug/src/index.js',
					],
					sourcesContent: [repositoryContent, dependencyContent],
					names: [],
					mappings: 'AAAA;ACAA',
				},
				url: null,
			},
		},
	}));

	const result = materializeV8SurfaceCoverage({
		repositoryRoot: REPOSITORY_ROOT,
		artifactRoot: fixture.artifactRoot,
		surfaceDirectory: fixture.surfaceDirectory,
		reportDirectory: join(fixture.workspace, 'mapped-report'),
		manifest: fixture.manifest,
		inventory: fixture.inventory,
	});

	assert.deepEqual(result.failures, []);
	assert.deepEqual(Object.keys(result.coverage), [fixture.sourcePath]);
});

test('a prepared raw profile cannot be replaced or supplemented after manifest binding', () => {
	const fixture = makeFixture();
	const directory = join(fixture.surfaceDirectory, 'v8');
	mkdirSync(directory, { recursive: true });
	const profile = join(directory, 'coverage.json');
	writeFileSync(profile, JSON.stringify({ result: [], 'source-map-cache': {} }));
	const manifest = fixture.manifest;
	writeFileSync(profile, JSON.stringify({ result: [v8Entry(TOKEN_URL)], 'source-map-cache': {} }));

	assert.throws(() => materializeV8SurfaceCoverage({
		repositoryRoot: REPOSITORY_ROOT,
		artifactRoot: fixture.artifactRoot,
		surfaceDirectory: fixture.surfaceDirectory,
		reportDirectory: join(fixture.workspace, 'tampered-report'),
		manifest,
		inventory: fixture.inventory,
	}), /coverage-file inventory or bytes do not match/u);
});

function makeFixture({ repositorySource = false } = {}) {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-e2e-runner-'));
	workspaces.push(workspace);
	const artifactRoot = join(workspace, 'e2e');
	const scriptPath = 'executables/app.mjs';
	const sourcePath = repositorySource
		? 'src/common/url.ts'
		: 'generated/browser-chromium-soundscaper-renderer/app.mjs';
	const body = [
		'export function choose(value) {',
		'\treturn value ? "yes" : "no";',
		'}',
		'choose(true);',
		'choose(false);',
		'',
	].join('\n');
	mkdirSync(join(artifactRoot, 'executables'), { recursive: true });
	writeFileSync(join(artifactRoot, scriptPath), body);
	const configuration = parseE2ECoverageConfiguration({
		schemaVersion: 1,
		thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 },
		repositorySourceRoots: ['src/'],
		requiredSurfaces: [{
			id: SURFACE,
			coverageFormat: 'v8',
			description: 'The complete Soundscaper Chromium renderer runtime surface.',
		}],
		reason: 'This isolated fixture keeps the same literal one hundred percent end-to-end contract while exercising the raw V8 adapter.',
	});
	const unsigned = {
		schemaVersion: 1,
		kind: 'soundscaper-e2e-executable-inventory',
		sourceRevision: REVISION,
		sources: [repositorySource ? {
			path: sourcePath,
			origin: 'repository',
			sha256: sha256(readFileSync(join(REPOSITORY_ROOT, sourcePath))),
			surfaces: [SURFACE],
		} : {
			path: sourcePath,
			origin: 'artifact',
			artifactPath: scriptPath,
			sha256: sha256(body),
			surfaces: [SURFACE],
		}],
		scripts: [{
			id: `${SURFACE}/app.mjs`,
			surface: SURFACE,
			artifactPath: scriptPath,
			coverageUrl: TOKEN_URL,
			sha256: sha256(body),
			sourceMapSha256: null,
			coverageKey: e2eExecutableCoverageKey({
				sha256: sha256(body),
				sourceMapSha256: null,
				sources: [sourcePath],
			}),
			sources: [sourcePath],
		}],
	};
	const inventory = parseE2EInventory(
		{ ...unsigned, digest: digestE2EInventory(unsigned) },
		configuration,
	);
	const surfaceDirectory = join(artifactRoot, 'surfaces', SURFACE);
	mkdirSync(surfaceDirectory, { recursive: true });
	return {
		workspace,
		artifactRoot,
		body,
		surfaceDirectory,
		scriptPath,
		sourcePath,
		inventory,
		get manifest() {
			return parseE2ESurfaceManifest({
				schemaVersion: 1,
				kind: 'soundscaper-e2e-coverage-surface',
				surface: SURFACE,
				sourceRevision: REVISION,
				inventoryDigest: inventory.digest,
				coverage: {
					format: 'v8',
					path: 'v8',
					files: coverageFileRecords(join(surfaceDirectory, 'v8')),
				},
				inventoriedScripts: [{ id: `${SURFACE}/app.mjs`, sha256: sha256(body) }],
			}, inventory, configuration);
		},
	};
}

function sha256(value) {
	return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function v8Entry(url) {
	return { url, functions: [] };
}
