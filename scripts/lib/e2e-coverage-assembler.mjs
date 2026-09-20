/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	cpSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { loadE2EBuildEvidence } from './e2e-coverage-build-evidence.mjs';
import { validateCaptureIndex } from './e2e-coverage-builder.mjs';
import {
	E2E_COVERAGE_CONFIGURATION,
	E2E_COVERAGE_SCHEMA_VERSION,
} from './e2e-coverage-contract.mjs';
import {
	coverageFileRecords,
	e2eExecutableCoverageKey,
	sha256Digest,
	stableSha256Digest,
	validateE2EExecutableObservation,
} from './e2e-coverage-integrity.mjs';
import { assembleE2ERawProfiles } from './e2e-coverage-profile-assembly.mjs';

export function assembleE2ECoverageCapture({
	repositoryRoot,
	runRoot,
	runRoots,
	outputRoot,
	expectedRevision = repositoryRevision(repositoryRoot),
	configuration = E2E_COVERAGE_CONFIGURATION,
}) {
	const roots = normalizedRunRoots(runRoot, runRoots);
	const destination = resolve(outputRoot ?? join(roots[0], 'coverage/e2e-capture'));
	assertOutputRoot(roots, resolve(repositoryRoot), destination);
	const captures = roots.map((root) => loadRunCapture({
		expectedRevision,
		repositoryRoot: resolve(repositoryRoot),
		runRoot: root,
	}));
	assertCompatibleCaptures(captures);
	const profiles = mergeProfiles(captures.map(({ profiles }) => profiles));
	assertRequiredSurfaceProfiles(profiles, configuration);

	const staging = `${destination}.staging-${process.pid}-${randomUUID()}`;
	rmSync(staging, { recursive: true, force: true });
	try {
		mkdirSync(staging, { recursive: true });
		const captureIndex = createCaptureIndex({
			configuration,
			evidence: captures[0].evidence,
			outputRoot: staging,
			profiles,
			sourceRevision: captures[0].sourceRevision,
		});
		validateCaptureIndex(captureIndex, configuration);
		const observationFailures = validateE2EExecutableObservation(
			[...profiles.values()].flatMap((values) => values.flatMap(({ profile }) => (
				profile.result.map(({ url }) => url)
			))),
			captureIndex.scripts,
		);
		if (observationFailures.length > 0) throw new Error(observationFailures.join('\n'));
		writeJson(join(staging, 'capture-index.json'), captureIndex);
		rmSync(destination, { recursive: true, force: true });
		mkdirSync(dirname(destination), { recursive: true });
		renameSync(staging, destination);
		return Object.freeze({ captureIndex, outputRoot: destination });
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
}

function loadRunCapture({ expectedRevision, repositoryRoot, runRoot }) {
	const envelope = readJson(join(runRoot, 'run.json'), `nightly run envelope at ${runRoot}`);
	if (!record(envelope) || envelope.schemaVersion !== 2
		|| envelope.kind !== 'soundscaper-desktop-nightly-tests'
		|| !/^[0-9a-f]{40}$/u.test(envelope.sourceRevision ?? '')) {
		throw new Error(`Nightly run ${runRoot} has no valid source revision envelope.`);
	}
	if (envelope.status !== 'passed' || typeof envelope.finishedAt !== 'string') {
		throw new Error(`Nightly run ${runRoot} did not finish successfully.`);
	}
	if (envelope.sourceRevision !== expectedRevision) {
		throw new Error(
			`Nightly run revision ${envelope.sourceRevision} does not match ${expectedRevision}.`,
		);
	}
	const evidence = loadE2EBuildEvidence({
		evidenceRoot: join(runRoot, 'coverage/build-evidence'),
		repositoryRoot,
		sourceRevision: envelope.sourceRevision,
	});
	return Object.freeze({
		evidence,
		profiles: assembleE2ERawProfiles({ evidence, repositoryRoot, runRoot }),
		runRoot,
		sourceRevision: envelope.sourceRevision,
	});
}

function createCaptureIndex({ configuration, evidence, outputRoot, profiles, sourceRevision }) {
	const descriptors = evidenceScripts(evidence);
	const generated = generatedArtifacts(descriptors);
	const sources = new Map();
	const scripts = descriptors.map((descriptor) => {
		const surface = surfaceForScript(descriptor);
		let artifactPath;
		let ownedSources;
		if (descriptor.repositorySources.length > 0) {
			artifactPath = `executables/${surface}/${descriptor.artifactPath}`;
			copyFile(descriptor.inputFile, join(outputRoot, artifactPath));
			ownedSources = [...descriptor.repositorySources];
			for (const path of ownedSources) addRepositorySource(sources, path, surface);
		} else {
			const artifact = generated.get(generatedKey(descriptor));
			artifactPath = artifact.artifactPath;
			ownedSources = [artifact.sourcePath];
			addArtifactSource(sources, artifact, surface);
			if (!artifact.copied) {
				copyFile(descriptor.inputFile, join(outputRoot, artifactPath));
				artifact.copied = true;
			}
		}
		const sourceMapSha256 = descriptor.fullSourceMap === null
			? null : stableSha256Digest(descriptor.fullSourceMap);
		const executableSha256 = sha256Digest(descriptor.source);
		return {
			id: `${surface}/${descriptor.artifactPath}`,
			surface,
			inputPath: artifactPath,
			artifactPath,
			coverageUrl: descriptor.coverageUrl,
			sources: ownedSources.sort(),
			sourceMapSha256,
			coverageKey: e2eExecutableCoverageKey({
				sha256: executableSha256,
				sourceMapSha256,
				sources: ownedSources,
			}),
		};
	}).sort((left, right) => left.id.localeCompare(right.id));

	const surfaces = configuration.requiredSurfaces.map(({ id, coverageFormat }) => {
		const inputPath = `profiles/${id}`;
		const directory = join(outputRoot, inputPath);
		writeProfiles(directory, profiles.get(id));
		return {
			id,
			coverage: {
				format: coverageFormat,
				inputPath,
				path: 'v8',
				files: coverageFileRecords(directory),
			},
		};
	});
	return {
		schemaVersion: E2E_COVERAGE_SCHEMA_VERSION,
		kind: 'soundscaper-e2e-capture-index',
		sourceRevision,
		sources: [...sources.values()]
			.map((source) => ({ ...source, surfaces: [...source.surfaces].sort() }))
			.sort((left, right) => left.path.localeCompare(right.path)),
		scripts,
		surfaces,
	};
}

function generatedArtifacts(descriptors) {
	const generated = new Map();
	for (const descriptor of descriptors.filter(({ repositorySources }) => repositorySources.length === 0)) {
		const key = generatedKey(descriptor);
		if (generated.has(key)) continue;
		const hash = sha256(descriptor.source);
		const extension = extname(descriptor.artifactPath).toLowerCase();
		generated.set(key, {
			artifactPath: `executables/generated/${hash}${extension}`,
			copied: false,
			sourcePath: `generated/${hash}${extension}`,
		});
	}
	return generated;
}

function generatedKey(descriptor) {
	return `${extname(descriptor.artifactPath).toLowerCase()}:${sha256(descriptor.source)}`;
}

function addRepositorySource(sources, path, surface) {
	const source = sources.get(path) ?? { path, origin: 'repository', surfaces: new Set() };
	source.surfaces.add(surface);
	sources.set(path, source);
}

function addArtifactSource(sources, artifact, surface) {
	const source = sources.get(artifact.sourcePath) ?? {
		path: artifact.sourcePath,
		origin: 'artifact',
		inputPath: artifact.artifactPath,
		artifactPath: artifact.artifactPath,
		surfaces: new Set(),
	};
	source.surfaces.add(surface);
	sources.set(source.path, source);
}

function evidenceScripts(evidence) {
	return [
		...[...evidence.browser.values()].flatMap(({ electronScripts, scripts }) => [
			...scripts,
			...electronScripts,
		]),
		...[...evidence.electron.values()].flatMap(({ scripts }) => scripts),
	]
		.filter(({ owned }) => owned)
		.sort((left, right) => (
			`${surfaceForScript(left)}/${left.artifactPath}`
				.localeCompare(`${surfaceForScript(right)}/${right.artifactPath}`)
		));
}

function surfaceForScript(script) {
	return script.runtime === 'browser'
		? `browser-chromium-${script.productId}-renderer`
		: `nightly-electron-${script.productId}-${script.realm}`;
}

function mergeProfiles(profileMaps) {
	const merged = new Map();
	for (const [runIndex, profiles] of profileMaps.entries()) {
		for (const [surface, values] of profiles) {
			const target = merged.get(surface) ?? [];
			for (const value of values) target.push({
				name: `${String(runIndex + 1).padStart(3, '0')}-${value.name}`,
				profile: value.profile,
			});
			merged.set(surface, target);
		}
	}
	return merged;
}

function assertRequiredSurfaceProfiles(profiles, configuration) {
	for (const { id } of configuration.requiredSurfaces) {
		const values = profiles.get(id) ?? [];
		if (values.length === 0 || !values.some(({ profile }) => profile.result.length > 0)) {
			throw new Error(`Required E2E surface ${id} supplied no executable coverage profile.`);
		}
	}
}

function assertCompatibleCaptures(captures) {
	const first = captures[0];
	for (const capture of captures.slice(1)) {
		if (capture.sourceRevision !== first.sourceRevision) {
			throw new Error('Nightly run roots name different source revisions.');
		}
		if (capture.evidence.digest !== first.evidence.digest) {
			throw new Error('Nightly run roots contain different build-evidence hashes.');
		}
	}
}

function normalizedRunRoots(runRoot, runRoots) {
	if (runRoot !== undefined && runRoots !== undefined) {
		throw new TypeError('Use either runRoot or runRoots, not both.');
	}
	const supplied = runRoots ?? (runRoot === undefined ? [] : [runRoot]);
	if (!Array.isArray(supplied) || supplied.length === 0
		|| supplied.some((root) => typeof root !== 'string' || !isAbsolute(root))) {
		throw new TypeError('E2E assembly needs one or more absolute nightly run roots.');
	}
	const roots = supplied.map((root) => resolve(root));
	if (new Set(roots).size !== roots.length) throw new Error('A nightly run root was supplied twice.');
	return roots;
}

function assertOutputRoot(runRoots, repositoryRoot, outputRoot) {
	if (!isAbsolute(outputRoot)) throw new TypeError('The E2E capture output root must be absolute.');
	const coverageRoots = [resolve(repositoryRoot, 'coverage'), ...runRoots.map((root) => resolve(root, 'coverage'))];
	const admitted = coverageRoots.some((coverageRoot) => {
		const child = relative(coverageRoot, outputRoot);
		return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
			&& !['build-evidence', 'v8-browser', 'v8-packaged'].includes(child.split(sep)[0]);
	});
	if (!admitted) {
		throw new Error(
			'The E2E capture output must be a dedicated directory below the repository or a run coverage root.',
		);
	}
}

function writeProfiles(directory, profiles) {
	mkdirSync(directory, { recursive: true });
	const names = new Set();
	for (const { name, profile } of profiles) {
		if (names.has(name)) throw new Error(`Two raw E2E profiles resolve to ${name}.`);
		names.add(name);
		writeJson(join(directory, name), profile);
	}
}

function copyFile(source, destination) {
	mkdirSync(dirname(destination), { recursive: true });
	cpSync(source, destination, { force: false, errorOnExist: true });
}

function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}

function readJson(path, label) {
	try { return JSON.parse(readFileSync(path, 'utf8')); }
	catch (error) { throw new Error(`The ${label} is not readable JSON.`, { cause: error }); }
}

function repositoryRevision(repositoryRoot) {
	const outcome = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' });
	if (outcome.error) throw outcome.error;
	if (outcome.status !== 0) throw new Error(`Could not read the checked-out revision: ${outcome.stderr.trim()}`);
	return outcome.stdout.trim();
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
