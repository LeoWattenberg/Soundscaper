/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, sep } from 'node:path';

import {
	e2eExecutableCoverageKey,
} from './e2e-coverage-integrity.mjs';

export {
	validateE2EExecutableObservation,
	validateE2EInventoryFiles,
} from './e2e-coverage-integrity.mjs';

export const E2E_COVERAGE_SCHEMA_VERSION = 1;
export const E2E_EXECUTABLE_URL_PREFIX = 'file:///__soundscaper_e2e__/';
export const E2E_REPOSITORY_URL_PREFIX = 'file:///__soundscaper_repo__/';
export const E2E_COVERAGE_METRICS = Object.freeze([
	'lines',
	'statements',
	'functions',
	'branches',
]);
export const E2E_COVERAGE_CONFIGURATION_URL = new URL(
	'../../config/e2e-coverage-gate.json',
	import.meta.url,
);
export const E2E_COVERAGE_CONFIGURATION = parseE2ECoverageConfiguration(
	JSON.parse(readFileSync(E2E_COVERAGE_CONFIGURATION_URL, 'utf8')),
);

export function parseE2ECoverageConfiguration(value) {
	assertObject(value, 'The E2E coverage configuration');
	if (value.schemaVersion !== E2E_COVERAGE_SCHEMA_VERSION) {
		throw new RangeError(`The E2E coverage configuration schema must be ${E2E_COVERAGE_SCHEMA_VERSION}.`);
	}
	for (const metric of E2E_COVERAGE_METRICS) {
		if (value.thresholds?.[metric] !== 100) {
			throw new RangeError(`The E2E ${metric} threshold must be exactly 100%.`);
		}
	}
	const roots = stringArray(value.repositorySourceRoots, 'repository source roots');
	if (roots.length === 0 || roots.some((root) => (
		!root.endsWith('/') || !safeRelativePath(root.slice(0, -1))
	))) {
		throw new TypeError('E2E repository source roots must be non-empty safe relative directory paths.');
	}
	const requiredSurfaces = value.requiredSurfaces;
	if (!Array.isArray(requiredSurfaces) || requiredSurfaces.length === 0) {
		throw new TypeError('The E2E coverage configuration must list required surfaces.');
	}
	const ids = requiredSurfaces.map((surface) => {
		assertObject(surface, 'Every E2E coverage surface');
		if (!surfaceId(surface.id)) throw new TypeError('Every E2E coverage surface needs a stable id.');
		if (!['istanbul', 'v8'].includes(surface.coverageFormat)) {
			throw new TypeError(`E2E coverage surface ${surface.id} needs an admitted coverage format.`);
		}
		if (typeof surface.description !== 'string' || surface.description.trim().length < 20) {
			throw new TypeError(`E2E coverage surface ${surface.id} needs a description of its owned realms.`);
		}
		return surface.id;
	});
	assertUnique(ids, 'The E2E coverage configuration names a surface twice.');
	assertSorted(ids, 'E2E required surfaces must be sorted by id.');
	if (typeof value.reason !== 'string' || value.reason.trim().length < 80) {
		throw new TypeError('The E2E coverage configuration must explain its strict gate.');
	}
	return Object.freeze({
		schemaVersion: value.schemaVersion,
		thresholds: Object.freeze(Object.fromEntries(E2E_COVERAGE_METRICS.map((metric) => [metric, 100]))),
		repositorySourceRoots: Object.freeze([...roots]),
		requiredSurfaces: Object.freeze(requiredSurfaces.map((surface) => Object.freeze({ ...surface }))),
		reason: value.reason,
	});
}

export function digestE2EInventory(inventory) {
	assertObject(inventory, 'The E2E executable inventory');
	const unsigned = { ...inventory };
	delete unsigned.digest;
	return digest(Buffer.from(stableJson(unsigned)));
}

export function parseE2EInventory(value, configuration = E2E_COVERAGE_CONFIGURATION) {
	assertObject(value, 'The E2E executable inventory');
	if (value.schemaVersion !== E2E_COVERAGE_SCHEMA_VERSION
		|| value.kind !== 'soundscaper-e2e-executable-inventory') {
		throw new TypeError('The E2E executable inventory has an unsupported kind or schema.');
	}
	if (!revision(value.sourceRevision)) throw new TypeError('The E2E inventory needs a full source revision.');
	if (!sha256(value.digest) || value.digest !== digestE2EInventory(value)) {
		throw new Error('The E2E inventory digest does not match its executable inventory.');
	}
	const configuredSurfaces = new Set(configuration.requiredSurfaces.map(({ id }) => id));
	if (!Array.isArray(value.sources) || value.sources.length === 0) {
		throw new TypeError('The E2E inventory must contain executable sources.');
	}
	if (!Array.isArray(value.scripts) || value.scripts.length === 0) {
		throw new TypeError('The E2E inventory must contain executable scripts.');
	}
	const sources = value.sources.map((source) => executableSource(source, configuration, configuredSurfaces));
	assertUnique(sources.map(({ path }) => path), 'The E2E inventory names a source twice.');
	assertSorted(sources.map(({ path }) => path), 'E2E inventory sources must be sorted by path.');
	const sourcesByPath = new Map(sources.map((source) => [source.path, source]));
	const scripts = value.scripts.map((script) => executableScript(script, configuredSurfaces, sourcesByPath));
	assertUnique(scripts.map(({ id }) => id), 'The E2E inventory names a script twice.');
	assertUnique(scripts.map(({ coverageUrl }) => coverageUrl), 'The E2E inventory gives two scripts one coverage URL.');
	assertSorted(scripts.map(({ id }) => id), 'E2E inventory scripts must be sorted by id.');
	for (const surface of configuredSurfaces) {
		if (!scripts.some((script) => script.surface === surface)) {
			throw new Error(`Required E2E surface ${surface} has no executable scripts.`);
		}
	}
	for (const source of sources) {
		if (!scripts.some((script) => script.sources.includes(source.path))) {
			throw new Error(`Executable source ${source.path} is not owned by an inventoried script.`);
		}
	}
	return Object.freeze({
		schemaVersion: value.schemaVersion,
		kind: value.kind,
		sourceRevision: value.sourceRevision,
		digest: value.digest,
		sources: Object.freeze(sources),
		scripts: Object.freeze(scripts),
	});
}

export function parseE2ESurfaceManifest(value, inventory, configuration = E2E_COVERAGE_CONFIGURATION) {
	assertObject(value, 'The E2E surface manifest');
	if (value.schemaVersion !== E2E_COVERAGE_SCHEMA_VERSION
		|| value.kind !== 'soundscaper-e2e-coverage-surface') {
		throw new TypeError('The E2E surface manifest has an unsupported kind or schema.');
	}
	const configured = new Set(configuration.requiredSurfaces.map(({ id }) => id));
	if (!configured.has(value.surface)) throw new Error(`Unknown E2E coverage surface ${String(value.surface)}.`);
	if (value.sourceRevision !== inventory.sourceRevision) {
		throw new Error(`${value.surface} source revision does not match the inventory.`);
	}
	if (value.inventoryDigest !== inventory.digest) {
		throw new Error(`${value.surface} inventory digest does not match the executable inventory.`);
	}
	assertObject(value.coverage, `${value.surface} coverage locator`);
	const configuredSurface = configuration.requiredSurfaces.find(({ id }) => id === value.surface);
	if (value.coverage.format !== configuredSurface.coverageFormat || !safeRelativePath(value.coverage.path)
		|| !coverageFiles(value.coverage.files)) {
		throw new TypeError(`${value.surface} coverage must name a safe Istanbul file or V8 directory.`);
	}
	const attested = value.inventoriedScripts;
	if (!Array.isArray(attested)) throw new TypeError(`${value.surface} must attest its inventoried scripts.`);
	const expected = inventory.scripts
		.filter((script) => script.surface === value.surface)
		.map(({ id, sha256: hash }) => ({ id, sha256: hash }));
	if (stableJson(attested) !== stableJson(expected)) {
		throw new Error(`${value.surface} did not attest every inventoried script with its exact hash.`);
	}
	return Object.freeze({
		schemaVersion: value.schemaVersion,
		kind: value.kind,
		surface: value.surface,
		sourceRevision: value.sourceRevision,
		inventoryDigest: value.inventoryDigest,
		coverage: Object.freeze({
			...value.coverage,
			files: Object.freeze(value.coverage.files.map((file) => Object.freeze({ ...file }))),
		}),
		inventoriedScripts: Object.freeze(attested.map((script) => Object.freeze({ ...script }))),
	});
}

export function validateRawV8Surface(profiles, surface, inventory) {
	if (!Array.isArray(profiles) || profiles.length === 0) {
		return [`${surface} supplied no raw V8 coverage profiles.`];
	}
	const expected = new Map(inventory.scripts
		.filter((script) => script.surface === surface)
		.map((script) => [script.coverageUrl, script]));
	const observed = new Set();
	const failures = [];
	for (const [index, profile] of profiles.entries()) {
		if (!profile || !Array.isArray(profile.result)) {
			failures.push(`${surface} raw V8 profile ${index + 1} has no result array.`);
			continue;
		}
		for (const entry of profile.result) {
			if (typeof entry?.url !== 'string' || entry.url === '') {
				failures.push(`${surface} raw V8 profile ${index + 1} has an entry without a URL.`);
				continue;
			}
			observed.add(entry.url);
		}
	}
	if (![...observed].some((url) => expected.has(url))) {
		failures.push(`${surface} supplied no admitted executable coverage entries.`);
	}
	for (const url of observed) {
		if (!expected.has(url)) failures.push(`${surface} reported un-inventoried executable script ${url}.`);
	}
	return failures;
}

export function analyzeE2ECoverage({
	configuration = E2E_COVERAGE_CONFIGURATION,
	inventory,
	surfaceManifests,
	coverageBySurface,
	coverageUnion,
	expectedRevision,
}) {
	const failures = [];
	if (inventory.sourceRevision !== expectedRevision) {
		failures.push(
			`E2E inventory revision ${inventory.sourceRevision} does not match the checked-out revision ${expectedRevision}.`,
		);
	}
	const required = configuration.requiredSurfaces.map(({ id }) => id);
	const parsedManifests = new Map();
	for (const surface of required) {
		if (!(surface in surfaceManifests)) {
			failures.push(`${surface} is missing its surface manifest.`);
			continue;
		}
		try {
			parsedManifests.set(surface, parseE2ESurfaceManifest(surfaceManifests[surface], inventory, configuration));
		} catch (error) {
			failures.push(errorMessage(error));
		}
	}
	for (const surface of Object.keys(surfaceManifests)) {
		if (!required.includes(surface)) failures.push(`Unexpected E2E surface manifest ${surface}.`);
	}

	const sources = new Map(inventory.sources.map((source) => [source.path, source]));
	const merged = new Map();
	if (coverageUnion !== undefined) {
		if (!coverageUnion || typeof coverageUnion !== 'object' || Array.isArray(coverageUnion)) {
			failures.push('E2E supplied no usable union coverage profile.');
		} else {
			mergeReportedCoverage({
				reported: coverageUnion,
				label: 'E2E union',
				sources,
				merged,
				failures,
			});
		}
	}
	for (const surface of required) {
		const reported = coverageBySurface?.[surface];
		if (!reported || typeof reported !== 'object' || Array.isArray(reported)) {
			failures.push(`${surface} supplied no usable coverage profile.`);
			continue;
		}
		mergeReportedCoverage({ reported, label: surface, surface, sources, merged, failures });
	}
	for (const path of sources.keys()) {
		if (!merged.has(path)) failures.push(`E2E reported no coverage for executable source ${path}.`);
	}
	const metrics = summarizeCoverage([...merged.values()].map(({ coverage }) => coverage));
	for (const metric of E2E_COVERAGE_METRICS) {
		const counts = metrics[metric];
		if (counts.total === 0) {
			failures.push(`E2E ${metric} coverage has no executable points.`);
		} else if (counts.covered !== counts.total) {
			failures.push(
				`E2E ${metric} coverage is ${counts.percentage.toFixed(2)}% `
				+ `(${counts.covered}/${counts.total}), below the required 100%.`,
			);
		}
	}
	return { metrics, failures, files: merged.size, surfaces: parsedManifests.size };
}

function mergeReportedCoverage({ reported, label, surface, sources, merged, failures }) {
	for (const [reportedPath, fileCoverage] of Object.entries(reported)) {
		const path = normalizePath(reportedPath);
		const source = sources.get(path);
		if (!source) {
			failures.push(`${label} reported un-inventoried source ${path}.`);
			continue;
		}
		if (surface !== undefined && !source.surfaces.includes(surface)) {
			failures.push(`${surface} reported source ${path}, which its executable inventory does not own.`);
			continue;
		}
		try {
			const normalized = normalizedFileCoverage(path, fileCoverage);
			const existing = merged.get(path);
			if (existing === undefined) merged.set(path, normalized);
			else if (existing.mapDigest !== normalized.mapDigest) {
				failures.push(`${path} has incompatible coverage maps across E2E surfaces.`);
			} else {
				mergeCounters(existing.coverage, normalized.coverage);
			}
		} catch (error) {
			failures.push(`${label} ${path}: ${errorMessage(error)}`);
		}
	}
}

export function formatE2ECoverageResult(result) {
	const lines = ['End-to-end coverage (Chromium browser + packaged Electron):'];
	for (const metric of E2E_COVERAGE_METRICS) {
		const counts = result.metrics[metric];
		lines.push(`  ${metric} ${counts.percentage.toFixed(2)}% (${counts.covered}/${counts.total})`);
	}
	return `${lines.join('\n')}\n`;
}

function executableSource(value, configuration, configuredSurfaces) {
	assertObject(value, 'Every E2E executable source');
	if (!safeRelativePath(value.path) || !executableExtension(value.path)) {
		throw new TypeError('Every E2E executable source needs a safe JavaScript or TypeScript path.');
	}
	if (!['repository', 'artifact'].includes(value.origin) || !sha256(value.sha256)) {
		throw new TypeError(`Executable source ${value.path} has no valid origin or SHA-256.`);
	}
	const surfaces = admittedSurfaces(value.surfaces, configuredSurfaces, `Executable source ${value.path}`);
	if (value.origin === 'repository') {
		if (!configuration.repositorySourceRoots.some((root) => value.path.startsWith(root))) {
			throw new Error(`Repository source ${value.path} is outside the admitted production roots.`);
		}
		if (value.artifactPath !== undefined) {
			throw new TypeError(`Repository source ${value.path} must not name an artifact path.`);
		}
		return Object.freeze({ path: value.path, origin: value.origin, sha256: value.sha256, surfaces });
	}
	if (!value.path.startsWith('generated/') || !safeRelativePath(value.artifactPath)) {
		throw new TypeError(`Generated source ${value.path} needs a safe generated path and artifact path.`);
	}
	return Object.freeze({
		path: value.path,
		origin: value.origin,
		artifactPath: value.artifactPath,
		sha256: value.sha256,
		surfaces,
	});
}

function executableScript(value, configuredSurfaces, sourcesByPath) {
	assertObject(value, 'Every E2E executable script');
	if (!safeRelativePath(value.id) || !surfaceId(value.surface) || !configuredSurfaces.has(value.surface)) {
		throw new TypeError('Every E2E executable script needs a safe id and configured surface.');
	}
	if (!safeRelativePath(value.artifactPath)
		|| typeof value.coverageUrl !== 'string'
		|| !value.coverageUrl.startsWith(E2E_EXECUTABLE_URL_PREFIX)
		|| !sha256(value.sha256)) {
		throw new TypeError(`Executable script ${value.id} has no valid artifact path, coverage URL or SHA-256.`);
	}
	if ((value.sourceMapSha256 !== null && !sha256(value.sourceMapSha256))
		|| !sha256(value.coverageKey)) {
		throw new TypeError(`Executable script ${value.id} has no valid source-map or coverage identity.`);
	}
	const sources = stringArray(value.sources, `sources for executable script ${value.id}`);
	if (sources.length === 0) throw new TypeError(`Executable script ${value.id} owns no source.`);
	assertUnique(sources, `Executable script ${value.id} names a source twice.`);
	assertSorted(sources, `Executable script ${value.id} sources must be sorted.`);
	for (const path of sources) {
		const source = sourcesByPath.get(path);
		if (!source) throw new Error(`Executable script ${value.id} names unknown source ${path}.`);
		if (!source.surfaces.includes(value.surface)) {
			throw new Error(`Executable script ${value.id} does not share ${path}'s owning surface.`);
		}
	}
	const expectedKey = e2eExecutableCoverageKey({
		sha256: value.sha256,
		sourceMapSha256: value.sourceMapSha256,
		sources,
	});
	if (value.coverageKey !== expectedKey) {
		throw new Error(`Executable script ${value.id} has a mismatched coverage identity.`);
	}
	return Object.freeze({ ...value, sources: Object.freeze([...sources]) });
}

function admittedSurfaces(value, configuredSurfaces, label) {
	const surfaces = stringArray(value, `${label} surfaces`);
	if (surfaces.length === 0 || surfaces.some((surface) => !configuredSurfaces.has(surface))) {
		throw new Error(`${label} names no valid owning surfaces.`);
	}
	assertUnique(surfaces, `${label} names a surface twice.`);
	assertSorted(surfaces, `${label} surfaces must be sorted.`);
	return Object.freeze([...surfaces]);
}

function normalizedFileCoverage(path, value) {
	assertObject(value, `Coverage for ${path}`);
	const maps = {
		statementMap: coverageMap(value.statementMap, value.s, `${path} statements`),
		fnMap: coverageMap(value.fnMap, value.f, `${path} functions`),
		branchMap: coverageMap(value.branchMap, value.b, `${path} branches`, true),
	};
	const coverage = {
		path,
		statementMap: maps.statementMap.map,
		fnMap: maps.fnMap.map,
		branchMap: maps.branchMap.map,
		s: maps.statementMap.counts,
		f: maps.fnMap.counts,
		b: maps.branchMap.counts,
	};
	return {
		coverage,
		mapDigest: digest(Buffer.from(stableJson({
			statementMap: coverage.statementMap,
			fnMap: coverage.fnMap,
			branchMap: coverage.branchMap,
		}))),
	};
}

function coverageMap(map, counters, label, branches = false) {
	assertObject(map, `${label} map`);
	assertObject(counters, `${label} counters`);
	const mapKeys = Object.keys(map).sort();
	const counterKeys = Object.keys(counters).sort();
	if (stableJson(mapKeys) !== stableJson(counterKeys)) throw new Error(`${label} map and counters differ.`);
	for (const key of counterKeys) {
		const counts = branches ? counters[key] : [counters[key]];
		if (!Array.isArray(counts) || counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
			throw new TypeError(`${label} has an invalid counter.`);
		}
		if (branches && (!Array.isArray(map[key]?.locations) || map[key].locations.length !== counts.length)) {
			throw new Error(`${label} locations and counters differ.`);
		}
	}
	return { map, counts: structuredClone(counters) };
}

function mergeCounters(target, incoming) {
	for (const [metric, name] of [['s', 'statementMap'], ['f', 'fnMap']]) {
		for (const key of Object.keys(target[name])) target[metric][key] += incoming[metric][key];
	}
	for (const key of Object.keys(target.branchMap)) {
		target.b[key] = target.b[key].map((count, index) => count + incoming.b[key][index]);
	}
}

function summarizeCoverage(files) {
	const totals = Object.fromEntries(E2E_COVERAGE_METRICS.map((metric) => [metric, { covered: 0, total: 0 }]));
	for (const file of files) {
		const lines = new Map();
		for (const [key, count] of Object.entries(file.s)) {
			const line = file.statementMap[key]?.start?.line;
			if (!Number.isSafeInteger(line) || line < 1) throw new TypeError(`${file.path} has an invalid statement line.`);
			lines.set(line, (lines.get(line) ?? false) || count > 0);
			totals.statements.total += 1;
			if (count > 0) totals.statements.covered += 1;
		}
		for (const covered of lines.values()) {
			totals.lines.total += 1;
			if (covered) totals.lines.covered += 1;
		}
		for (const count of Object.values(file.f)) {
			totals.functions.total += 1;
			if (count > 0) totals.functions.covered += 1;
		}
		for (const counts of Object.values(file.b)) {
			for (const count of counts) {
				totals.branches.total += 1;
				if (count > 0) totals.branches.covered += 1;
			}
		}
	}
	return Object.fromEntries(Object.entries(totals).map(([metric, counts]) => [metric, {
		...counts,
		percentage: counts.total === 0 ? 100 : 100 * counts.covered / counts.total,
	}]));
}

function safeRelativePath(value) {
	return typeof value === 'string' && value !== '' && !isAbsolute(value)
		&& !value.includes('\\') && !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

function executableExtension(path) {
	return /\.(?:[cm]?[jt]sx?)$/u.test(path) && !/\.d\.(?:[cm]?ts)$/u.test(path);
}

function normalizePath(path) {
	return path.split(sep).join('/').replaceAll('\\', '/').replace(/^\.\//u, '');
}

function surfaceId(value) {
	return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function revision(value) {
	return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);
}

function sha256(value) {
	return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function coverageFiles(value) {
	return Array.isArray(value) && value.length > 0
		&& value.every((file) => file && typeof file === 'object' && !Array.isArray(file)
			&& safeRelativePath(file.path) && Number.isSafeInteger(file.byteLength)
			&& file.byteLength >= 0 && sha256(file.sha256))
		&& stableJson(value.map(({ path }) => path))
			=== stableJson([...new Set(value.map(({ path }) => path))].sort());
}

function digest(value) {
	return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function stringArray(value, label) {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
		throw new TypeError(`${label} must be an array of strings.`);
	}
	return value;
}

function assertObject(value, label) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
}

function assertUnique(values, message) {
	if (new Set(values).size !== values.length) throw new Error(message);
}

function assertSorted(values, message) {
	if (stableJson(values) !== stableJson([...values].sort())) throw new Error(message);
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
