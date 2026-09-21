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
import {
	e2eExecutableCoverageKey,
	revisionBoundSource,
	validateCoverageFileRecords,
} from './e2e-coverage-integrity.mjs';

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
			const committed = revisionBoundSource(
				repositoryRoot,
				captureIndex.sourceRevision,
				source.path,
			);
			return {
				path: source.path,
				origin: source.origin,
				sha256: committed.sha256,
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
		const sha256 = fileDigest(resolveInside(artifactRoot, script.artifactPath));
		const coverageKey = e2eExecutableCoverageKey({
			sha256,
			sourceMapSha256: script.sourceMapSha256,
			sources: script.sources,
		});
		if (script.coverageKey !== coverageKey) {
			throw new Error(`Executable script ${script.id} has a stale capture coverage identity.`);
		}
		return {
			id: script.id,
			surface: script.surface,
			artifactPath: script.artifactPath,
			coverageUrl: script.coverageUrl,
			sha256,
			sourceMapSha256: script.sourceMapSha256,
			coverageKey,
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
		const captureCoverage = resolveInside(captureRoot, surface.coverage.inputPath);
		const coverageFailures = validateCoverageFileRecords(
			captureCoverage,
			surface.coverage.files,
			surface.id,
		);
		if (coverageFailures.length > 0) throw new Error(coverageFailures.join('\n'));
		copyEvidencePath(
			captureCoverage,
			destination,
		);
		const value = {
			schemaVersion: E2E_COVERAGE_SCHEMA_VERSION,
			kind: 'soundscaper-e2e-coverage-surface',
			surface: surface.id,
			sourceRevision: inventory.sourceRevision,
			inventoryDigest: inventory.digest,
			coverage: {
				format: surface.coverage.format,
				path: surface.coverage.path,
				files: surface.coverage.files.map((file) => ({ ...file })),
			},
			inventoriedScripts: inventory.scripts
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
	validateBuildEvidence(value.buildEvidence, value.sourceRevision);
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
			|| !sha256OrNull(script.sourceMapSha256) || !sha256(script.coverageKey)
			|| !Array.isArray(script.sources) || script.sources.length === 0) {
			throw new TypeError('Every E2E capture script needs identity, ownership, paths, URL and sources.');
		}
	}
	for (const surface of value.surfaces) {
		const required = configuration.requiredSurfaces.find(({ id }) => id === surface.id);
		if (!object(surface.coverage) || surface.coverage.format !== required.coverageFormat
			|| !safePath(surface.coverage.inputPath) || !safePath(surface.coverage.path)
			|| !coverageFiles(surface.coverage.files)) {
			throw new TypeError(`E2E capture surface ${surface.id} has no safe coverage evidence locator.`);
		}
	}
	return value;
}

function validateBuildEvidence(value, sourceRevision) {
	if (!Array.isArray(value) || value.length === 0) {
		throw new TypeError('The E2E capture index must retain its input build evidence.');
	}
	for (const [index, evidence] of value.entries()) {
		if (!exactKeys(evidence, [
			'digest',
			'documents',
			'excludedRuntimeScripts',
			'executableDigest',
			'executableResources',
			'id',
			'packageArchives',
			'runtime',
			'sourceRevision',
			'webAssemblyResources',
		]) || evidence.id !== `run-${String(index + 1).padStart(3, '0')}`
			|| evidence.sourceRevision !== sourceRevision || !sha256(evidence.digest)
			|| !sha256(evidence.executableDigest) || !object(evidence.runtime)
			|| !exactKeys(evidence.runtime, ['arch', 'platform'])
			|| !['linux', 'win32', 'darwin'].includes(evidence.runtime.platform)
			|| !['x64', 'arm64'].includes(evidence.runtime.arch)
			|| !productEvidence(evidence.documents) || !productEvidence(evidence.executableResources)
			|| !productEvidence(evidence.excludedRuntimeScripts)
			|| !productEvidence(evidence.webAssemblyResources)
			|| !productEvidence(evidence.packageArchives)) {
			throw new TypeError('Every E2E input build needs exact revision, runtime and digest provenance.');
		}
		for (const archive of Object.values(evidence.packageArchives)) {
			if (!exactFileIdentity(archive)) {
				throw new TypeError('Every E2E input build needs exact package-archive evidence.');
			}
		}
		for (const identity of Object.values(evidence.executableResources)) {
			if (!exactResourceIdentity(identity)) {
				throw new TypeError('Every E2E input build needs exact executable-resource evidence.');
			}
		}
		for (const documents of Object.values(evidence.documents)) validateDocuments(documents);
		for (const exclusions of Object.values(evidence.excludedRuntimeScripts)) {
			validateRuntimeExclusions(exclusions);
		}
		for (const resources of Object.values(evidence.webAssemblyResources)) {
			validateWebAssemblyResources(resources);
		}
	}
	if (new Set(value.map(({ executableDigest }) => executableDigest)).size !== 1) {
		throw new Error('E2E input builds do not share one executable evidence digest.');
	}
}

function productEvidence(value) {
	return object(value) && JSON.stringify(Object.keys(value).sort())
		=== JSON.stringify(['framescaper', 'soundscaper']);
}

function exactFileIdentity(value) {
	return exactKeys(value, ['byteLength', 'sha256'])
		&& Number.isSafeInteger(value.byteLength) && value.byteLength >= 0
		&& typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/u.test(value.sha256);
}

function exactResourceIdentity(value) {
	return exactKeys(value, ['fileCount', 'sha256', 'totalBytes'])
		&& Number.isSafeInteger(value.fileCount) && value.fileCount >= 0
		&& Number.isSafeInteger(value.totalBytes) && value.totalBytes >= 0
		&& typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/u.test(value.sha256);
}

function validateDocuments(value) {
	if (!Array.isArray(value) || value.some((document) => (
		!exactKeys(document, ['artifactPath', 'byteLength', 'packagedPath', 'sha256'])
		|| !safePath(document.artifactPath) || !safePath(document.packagedPath)
		|| !/\.html?$/u.test(document.artifactPath) || !exactFileIdentity({
			byteLength: document.byteLength,
			sha256: document.sha256,
		})
	)) || !canonicalPaths(value, 'artifactPath')) {
		throw new TypeError('Every E2E input build needs exact packaged-document evidence.');
	}
}

function validateRuntimeExclusions(value) {
	if (!Array.isArray(value) || value.some((script) => (
		!exactKeys(script, ['byteLength', 'path', 'sha256']) || !safePath(script.path)
		|| !script.path.startsWith('runtime/') || !/\.(?:c|m)?js$/u.test(script.path)
		|| !exactFileIdentity({ byteLength: script.byteLength, sha256: script.sha256 })
	)) || !canonicalPaths(value, 'path')) {
		throw new TypeError('Every E2E input build needs exact runtime-script exclusions.');
	}
}

function validateWebAssemblyResources(value) {
	if (!Array.isArray(value) || value.some((resource) => (
		!exactKeys(resource, ['artifactPath', 'byteLength', 'packagedPath', 'sha256'])
		|| !safePath(resource.artifactPath) || !safePath(resource.packagedPath)
		|| resource.artifactPath !== `webassembly/${resource.packagedPath}`
		|| !/^(?:renderer|runtime)\/.+\.wasm$/u.test(resource.packagedPath)
		|| !exactFileIdentity({ byteLength: resource.byteLength, sha256: resource.sha256 })
	)) || !canonicalPaths(value, 'artifactPath') || !canonicalPaths(value, 'packagedPath')) {
		throw new TypeError('Every E2E input build needs exact packaged WebAssembly evidence.');
	}
}

function canonicalPaths(value, key) {
	const paths = value.map((entry) => entry[key]);
	return JSON.stringify(paths) === JSON.stringify([...new Set(paths)].sort());
}

function exactKeys(value, keys) {
	return object(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
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

function coverageFiles(value) {
	return Array.isArray(value) && value.length > 0
		&& value.every((file) => object(file) && safePath(file.path)
			&& Number.isSafeInteger(file.byteLength) && file.byteLength >= 0 && sha256(file.sha256))
		&& JSON.stringify(value.map(({ path }) => path))
			=== JSON.stringify([...new Set(value.map(({ path }) => path))].sort());
}

function comparePath(left, right) {
	return left.path.localeCompare(right.path);
}

function object(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value) {
	return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function sha256OrNull(value) {
	return value === null || sha256(value);
}
