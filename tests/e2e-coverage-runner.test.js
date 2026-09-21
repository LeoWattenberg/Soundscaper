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
	materializeV8CoverageUnion,
	materializeV8SurfaceCoverage,
	rebasePortableV8Profile,
	runE2ECoverageGate,
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

test('the V8 adapter rejects a profile whose explicit source topology was erased', () => {
	const fixture = makeFixture();
	const originalProfiles = join(fixture.workspace, 'forged-original-v8');
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
	assert.ok(scriptCoverage);
	const rootFunction = scriptCoverage.functions.find(({ ranges }) => (
		ranges[0]?.startOffset === 0 && ranges[0]?.endOffset === fixture.body.length
	));
	assert.ok(rootFunction);
	const v8Directory = join(fixture.surfaceDirectory, 'v8');
	mkdirSync(v8Directory, { recursive: true });
	writeFileSync(join(v8Directory, 'coverage.json'), JSON.stringify({
		result: [{ ...scriptCoverage, functions: [rootFunction], url: TOKEN_URL }],
		'source-map-cache': {},
	}));

	const result = materializeV8SurfaceCoverage({
		repositoryRoot: REPOSITORY_ROOT,
		artifactRoot: fixture.artifactRoot,
		surfaceDirectory: fixture.surfaceDirectory,
		reportDirectory: join(fixture.workspace, 'forged-report'),
		manifest: fixture.manifest,
		inventory: fixture.inventory,
	});

	assert.match(result.failures.join('\n'), /missing the source-derived explicit function/u);
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

test('complementary raw V8 observations union before coverage-dependent branch maps materialize', () => {
	const fixture = makeComplementaryFixture();
	const separate = fixture.surfaces.map((surface, index) => materializeV8SurfaceCoverage({
		repositoryRoot: REPOSITORY_ROOT,
		artifactRoot: fixture.artifactRoot,
		surfaceDirectory: surface.directory,
		reportDirectory: join(fixture.workspace, `separate-report-${index}`),
		manifest: surface.manifest,
		inventory: fixture.inventory,
	}));
	assert.notDeepEqual(
		separate[0].coverage[fixture.sourcePath].branchMap,
		separate[1].coverage[fixture.sourcePath].branchMap,
		'V8-to-Istanbul branch discovery must reproduce the map mismatch this union prevents',
	);

	const union = materializeV8CoverageUnion({
		repositoryRoot: REPOSITORY_ROOT,
		artifactRoot: fixture.artifactRoot,
		reportDirectory: join(fixture.workspace, 'union-report'),
		surfaces: fixture.surfaces.map(({ directory, manifest }) => ({
			surfaceDirectory: directory,
			manifest,
		})),
		inventory: fixture.inventory,
	});

	assert.deepEqual(union.failures, []);
	assert.deepEqual(Object.keys(union.coverage), [fixture.sourcePath]);
	const measured = union.coverage[fixture.sourcePath];
	assert.ok(Object.values(measured.s).every((count) => count > 0));
	assert.ok(Object.values(measured.f).every((count) => count > 0));
	assert.ok(Object.values(measured.b).flat().every((count) => count > 0));

	writeFileSync(join(fixture.artifactRoot, 'inventory.json'), JSON.stringify(fixture.inventory));
	for (const { directory, manifest } of fixture.surfaces) {
		writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
	}
	const gated = runE2ECoverageGate({
		repositoryRoot: REPOSITORY_ROOT,
		artifactRoot: fixture.artifactRoot,
		reportRoot: join(fixture.workspace, 'gate-report'),
		configuration: fixture.configuration,
		expectedRevision: REVISION,
	});
	assert.deepEqual(gated.failures, []);
	assert.equal(gated.metrics.branches.percentage, 100);
});

test('a surface cannot contribute another surface\'s complementary raw V8 ranges', () => {
	const fixture = makeComplementaryFixture();
	const [first, second] = fixture.surfaces;
	const firstProfilePath = join(first.directory, 'v8/coverage.json');
	const firstProfile = JSON.parse(readFileSync(firstProfilePath, 'utf8'));
	const secondProfile = JSON.parse(readFileSync(join(second.directory, 'v8/coverage.json'), 'utf8'));
	firstProfile.result[0].url = secondProfile.result[0].url;
	writeFileSync(firstProfilePath, JSON.stringify(firstProfile));
	first.manifest = parseE2ESurfaceManifest({
		...first.manifest,
		coverage: {
			...first.manifest.coverage,
			files: coverageFileRecords(join(first.directory, 'v8')),
		},
	}, fixture.inventory, fixture.configuration);

	const union = materializeV8CoverageUnion({
		repositoryRoot: REPOSITORY_ROOT,
		artifactRoot: fixture.artifactRoot,
		reportDirectory: join(fixture.workspace, 'cross-surface-report'),
		surfaces: fixture.surfaces.map(({ directory, manifest }) => ({
			surfaceDirectory: directory,
			manifest,
		})),
		inventory: fixture.inventory,
	});

	assert.match(union.failures.join('\n'), /reported un-inventoried executable script/u);
	assert.ok(
		Object.values(union.coverage[fixture.sourcePath].b).flat().some((count) => count === 0),
		'invalid cross-surface ranges must not contribute to the materialized union',
	);
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

function makeComplementaryFixture() {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-e2e-union-'));
	workspaces.push(workspace);
	const artifactRoot = join(workspace, 'e2e');
	const scriptPath = 'executables/complementary.mjs';
	const sourcePath = 'generated/complementary.mjs';
	const body = [
		'export function choose(value) {',
		'\tif (value === "first" || value === "second") return "chosen";',
		'\treturn "other";',
		'}',
		'for (const value of process.env.CASES.split(",")) choose(value);',
		'',
	].join('\n');
	mkdirSync(join(artifactRoot, 'executables'), { recursive: true });
	writeFileSync(join(artifactRoot, scriptPath), body);
	const surfaceIds = ['browser-complementary-first', 'browser-complementary-second'];
	const configuration = parseE2ECoverageConfiguration({
		schemaVersion: 1,
		thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 },
		repositorySourceRoots: ['src/'],
		requiredSurfaces: surfaceIds.map((id) => ({
			id,
			coverageFormat: 'v8',
			description: `A complete complementary raw V8 fixture for ${id}.`,
		})),
		reason: 'This fixture proves that complementary raw V8 observations union before coverage-dependent Istanbul maps are constructed.',
	});
	const scripts = surfaceIds.map((surface, index) => {
		const script = {
			id: `${surface}/complementary.mjs`,
			surface,
			artifactPath: scriptPath,
			coverageUrl: `file:///__soundscaper_e2e__/browser/complementary-${index}.mjs`,
			sha256: sha256(body),
			sourceMapSha256: null,
			sources: [sourcePath],
		};
		return { ...script, coverageKey: e2eExecutableCoverageKey(script) };
	});
	const unsigned = {
		schemaVersion: 1,
		kind: 'soundscaper-e2e-executable-inventory',
		sourceRevision: REVISION,
		sources: [{
			path: sourcePath,
			origin: 'artifact',
			artifactPath: scriptPath,
			sha256: sha256(body),
			surfaces: surfaceIds,
		}],
		scripts,
	};
	const inventory = parseE2EInventory(
		{ ...unsigned, digest: digestE2EInventory(unsigned) },
		configuration,
	);
	const cases = ['first,other', 'second'];
	const surfaces = surfaceIds.map((surface, index) => {
		const originalDirectory = join(workspace, `original-${index}`);
		mkdirSync(originalDirectory);
		execFileSync(process.execPath, [join(artifactRoot, scriptPath)], {
			env: { ...process.env, CASES: cases[index], NODE_V8_COVERAGE: originalDirectory },
		});
		const original = JSON.parse(readFileSync(join(
			originalDirectory,
			readdirSync(originalDirectory).find((name) => name.endsWith('.json')),
		), 'utf8'));
		const artifactUrl = pathToFileURL(join(artifactRoot, scriptPath)).href;
		const scriptCoverage = original.result.find(({ url }) => url === artifactUrl);
		assert.ok(scriptCoverage, 'Node must measure the complementary fixture');
		const directory = join(artifactRoot, 'surfaces', surface);
		const coverageDirectory = join(directory, 'v8');
		mkdirSync(coverageDirectory, { recursive: true });
		writeFileSync(join(coverageDirectory, 'coverage.json'), JSON.stringify({
			result: [{ ...scriptCoverage, url: scripts[index].coverageUrl }],
			'source-map-cache': {},
		}));
		const manifest = parseE2ESurfaceManifest({
			schemaVersion: 1,
			kind: 'soundscaper-e2e-coverage-surface',
			surface,
			sourceRevision: REVISION,
			inventoryDigest: inventory.digest,
			coverage: {
				format: 'v8',
				path: 'v8',
				files: coverageFileRecords(coverageDirectory),
			},
			inventoriedScripts: [{ id: scripts[index].id, sha256: scripts[index].sha256 }],
		}, inventory, configuration);
		return { directory, manifest };
	});
	return { artifactRoot, configuration, inventory, sourcePath, surfaces, workspace };
}

function sha256(value) {
	return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function v8Entry(url) {
	return { url, functions: [] };
}
