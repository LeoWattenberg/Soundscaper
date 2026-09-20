/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
	E2E_COVERAGE_CONFIGURATION,
	E2E_COVERAGE_SCHEMA_VERSION,
	E2E_EXECUTABLE_URL_PREFIX,
	digestE2EInventory,
	parseE2EInventory,
	parseE2ESurfaceManifest,
} from './e2e-coverage-contract.mjs';

export function prepareE2ECoverageArtifacts({
	captureIndex,
	captureRoot,
	artifactRoot,
	repositoryRoot,
	configuration = E2E_COVERAGE_CONFIGURATION,
}) {
	validateCaptureIndex(captureIndex, configuration);
	mkdirSync(artifactRoot, { recursive: true });
	const sources = captureIndex.sources.map((source) => {
		if (source.origin === 'repository') {
			return {
				path: source.path,
				origin: source.origin,
				sha256: fileDigest(resolveInside(repositoryRoot, source.path)),
				surfaces: [...source.surfaces],
			};
		}
		copyEvidence(captureRoot, source.inputPath, artifactRoot, source.artifactPath);
		return {
			path: source.path,
			origin: source.origin,
			artifactPath: source.artifactPath,
			sha256: fileDigest(resolveInside(artifactRoot, source.artifactPath)),
			surfaces: [...source.surfaces],
		};
	}).sort(comparePath);
	const scripts = captureIndex.scripts.map((script) => {
		copyEvidence(captureRoot, script.inputPath, artifactRoot, script.artifactPath);
		return {
			id: script.id,
			surface: script.surface,
			artifactPath: script.artifactPath,
			coverageUrl: script.coverageUrl,
			sha256: fileDigest(resolveInside(artifactRoot, script.artifactPath)),
			sources: [...script.sources].sort(),
		};
	}).sort((left, right) => left.id.localeCompare(right.id));
	const unsigned = {
		schemaVersion: E2E_COVERAGE_SCHEMA_VERSION,
		kind: 'soundscaper-e2e-executable-inventory',
		sourceRevision: captureIndex.sourceRevision,
		sources,
		scripts,
	};
	const inventory = parseE2EInventory(
		{ ...unsigned, digest: digestE2EInventory(unsigned) },
		configuration,
	);
	writeJson(resolve(artifactRoot, 'inventory.json'), inventory);
	const manifests = [];
	for (const surface of captureIndex.surfaces) {
		const surfaceDirectory = resolve(artifactRoot, 'surfaces', surface.id);
		const destination = resolveInside(surfaceDirectory, surface.coverage.path);
		copyEvidencePath(
			resolveInside(captureRoot, surface.coverage.inputPath),
			destination,
		);
		const value = {
			schemaVersion: E2E_COVERAGE_SCHEMA_VERSION,
			kind: 'soundscaper-e2e-coverage-surface',
			surface: surface.id,
			sourceRevision: inventory.sourceRevision,
			inventoryDigest: inventory.digest,
			coverage: { format: surface.coverage.format, path: surface.coverage.path },
			observedScripts: inventory.scripts
				.filter((script) => script.surface === surface.id)
				.map(({ id, sha256 }) => ({ id, sha256 })),
		};
		const manifest = parseE2ESurfaceManifest(value, inventory, configuration);
		writeJson(resolve(surfaceDirectory, 'manifest.json'), manifest);
		manifests.push(manifest);
	}
	return { inventory, manifests: Object.freeze(manifests) };
}

export function validateCaptureIndex(value, configuration = E2E_COVERAGE_CONFIGURATION) {
	if (!object(value) || value.schemaVersion !== E2E_COVERAGE_SCHEMA_VERSION
		|| value.kind !== 'soundscaper-e2e-capture-index') {
		throw new TypeError('The E2E capture index has an unsupported kind or schema.');
	}
	if (!Array.isArray(value.sources) || !Array.isArray(value.scripts) || !Array.isArray(value.surfaces)) {
		throw new TypeError('The E2E capture index must list sources, scripts and surfaces.');
	}
	const configured = configuration.requiredSurfaces.map(({ id }) => id);
	const surfaceIds = value.surfaces.map((surface) => surface?.id);
	if (JSON.stringify(surfaceIds) !== JSON.stringify(configured)) {
		throw new Error('The E2E capture index must list every configured surface in canonical order.');
	}
	for (const source of value.sources) {
		if (!object(source) || !safePath(source.path) || !['repository', 'artifact'].includes(source.origin)
			|| !surfaceList(source.surfaces, configured)) {
			throw new TypeError('Every E2E capture source needs a safe path, origin and owning surfaces.');
		}
		if (source.origin === 'artifact' && (!safePath(source.inputPath) || !safePath(source.artifactPath))) {
			throw new TypeError(`Artifact source ${source.path} needs safe input and artifact paths.`);
		}
	}
	for (const script of value.scripts) {
		if (!object(script) || !safePath(script.id) || !configured.includes(script.surface)
			|| !safePath(script.inputPath) || !safePath(script.artifactPath)
			|| typeof script.coverageUrl !== 'string'
			|| !script.coverageUrl.startsWith(E2E_EXECUTABLE_URL_PREFIX)
			|| !Array.isArray(script.sources) || script.sources.length === 0) {
			throw new TypeError('Every E2E capture script needs identity, ownership, paths, URL and sources.');
		}
	}
	for (const surface of value.surfaces) {
		const required = configuration.requiredSurfaces.find(({ id }) => id === surface.id);
		if (!object(surface.coverage) || surface.coverage.format !== required.coverageFormat
			|| !safePath(surface.coverage.inputPath) || !safePath(surface.coverage.path)) {
			throw new TypeError(`E2E capture surface ${surface.id} has no safe coverage evidence locator.`);
		}
	}
	return value;
}

function copyEvidence(inputRoot, inputPath, outputRoot, outputPath) {
	copyEvidencePath(resolveInside(inputRoot, inputPath), resolveInside(outputRoot, outputPath));
}

function copyEvidencePath(input, output) {
	if (resolve(input) === resolve(output)) return;
	const stats = statSync(input);
	mkdirSync(dirname(output), { recursive: true });
	rmSync(output, { recursive: true, force: true });
	cpSync(input, output, { recursive: stats.isDirectory() });
}

function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}

function fileDigest(path) {
	return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function resolveInside(root, path) {
	const absoluteRoot = resolve(root);
	const resolved = resolve(absoluteRoot, path);
	const child = relative(absoluteRoot, resolved);
	if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
		throw new Error(`Path ${path} escapes ${absoluteRoot}.`);
	}
	return resolved;
}

function safePath(value) {
	return typeof value === 'string' && value !== '' && !isAbsolute(value) && !value.includes('\\')
		&& !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

function surfaceList(value, configured) {
	return Array.isArray(value) && value.length > 0
		&& value.every((surface) => configured.includes(surface))
		&& JSON.stringify(value) === JSON.stringify([...new Set(value)].sort());
}

function comparePath(left, right) {
	return left.path.localeCompare(right.path);
}

function object(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
