/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
	authenticateMilestone5NativeSourceInput,
	readMilestone5NativeSourceAcquisitions,
	removeMilestone5NativeSourceSnapshot,
	requireMilestone5NativeSource,
	snapshotMilestone5NativeSourceInput,
	verifyMilestone5NativeSourceInput,
} from './milestone-5-native-source-acquisitions.mjs';

export const SOUNDSCAPER_PROFESSIONAL_NATIVE_ROOT = 'native/soundscaper-professional-host';
export const SOUNDSCAPER_PROFESSIONAL_NATIVE_TARGETS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const TARGET_NATIVE_RUNNERS = Object.freeze({
	'Linux/X64': 'linux-x64',
	'Linux/ARM64': 'linux-arm64',
	'macOS/ARM64': 'mac-arm64',
	'Windows/X64': 'win-x64',
	'Windows/ARM64': 'win-arm64',
});
const AUTHENTICATED_BUILD_PLANS = new WeakSet();
const MAXIMUM_BUILD_STEP_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * JUCE 9 moved every hosted plug-in format's vendored SDK into the headless
 * audio-processors module; `juce_audio_processors` now re-exports it. The pin
 * names that module directly because the pre-9 path it used to live under does
 * not exist in JUCE 9.0.1, and a recipe that looked for it there could never
 * configure.
 */
const JUCE_VST3_SDK_CLOSURE = 'modules/juce_audio_processors_headless/format_types/VST3_SDK';
const JUCE_VST3_VERSION_HEADER = `${JUCE_VST3_SDK_CLOSURE}/pluginterfaces/vst/vsttypes.h`;
/** LV2 1.18.10 ships its headers under `include/`, so `<lv2/core/lv2.h>` resolves only from there. */
const LV2_INCLUDE_ROOT = 'include';

const EXPECTED = Object.freeze({
	'electron-node-api-headers': Object.freeze({ version: '43.1.1', commit: null, license: 'MIT' }),
	juce: Object.freeze({ version: '9.0.1', commit: 'e18f7f506c0b96f2c738a0bcd7fe6467a5005ad8', license: 'AGPL-3.0-only' }),
	clap: Object.freeze({ version: '1.2.4', commit: '00113aabdccf69c2e27ac269c35b369770e8fa73', license: 'MIT' }),
	'vst3-sdk': Object.freeze({ version: '3.8.0_build_66', commit: '9fad9770f2ae8542ab1a548a68c1ad1ac690abe0', license: 'MIT' }),
	'asio-sdk': Object.freeze({ version: '2.3.4', commit: null, license: 'GPL-3.0-only' }),
	lv2: Object.freeze({ version: '1.18.10', commit: '0bcde338db1c63bbc503b4d1f6d7b55ed43154af', license: 'ISC' }),
});

export function createSoundscaperProfessionalNativeSnapshotRoot(value) {
	const snapshotRoot = resolve(value);
	mkdirSync(dirname(snapshotRoot), { recursive: true, mode: 0o700 });
	mkdirSync(snapshotRoot, { recursive: false, mode: 0o700 });
	return snapshotRoot;
}

export function resolveSoundscaperProfessionalNativeRunnerTarget({
	target, runnerOs, runnerArch,
}) {
	const runnerTarget = TARGET_NATIVE_RUNNERS[`${String(runnerOs)}/${String(runnerArch)}`];
	if (runnerTarget === undefined || runnerTarget !== target) {
		throw new TypeError(
			`Professional native target ${String(target)} requires its exact target-native runner.`,
		);
	}
	return runnerTarget;
}

/** Resolve Xcode's MacOSX.sdk alias to the exact versioned SDK used by CMake. */
export function canonicalSoundscaperProfessionalNativeMacosSdkPath(value) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError('The macOS SDK root must be an absolute normalized path.');
	}
	const path = realpathSync(value);
	const metadata = lstatSync(path);
	assert(metadata.isDirectory() && !metadata.isSymbolicLink() && realpathSync(path) === path,
		'The macOS SDK root must be one canonical non-symbolic directory.');
	return path;
}

export function createSoundscaperProfessionalNativeBuildPlan(options) {
	const repositoryRoot = resolve(options.repositoryRoot);
	const target = String(options.target);
	assert(SOUNDSCAPER_PROFESSIONAL_NATIVE_TARGETS.includes(target), `Unsupported professional native target ${target}.`);
	const sourceManifestPath = options.sourceManifestPath;
	const register = readMilestone5NativeSourceAcquisitions(repositoryRoot, sourceManifestPath);
	const sources = Object.fromEntries(Object.entries(EXPECTED).map(([id, expected]) => (
		[id, assertSource(register, id, expected)]
	)));
	const requiredSourceIds = [
		'electron-node-api-headers', 'juce', 'clap', 'vst3-sdk',
		...(target.startsWith('win-') ? ['asio-sdk'] : []),
		...(target.startsWith('linux-') ? ['lv2'] : []),
	];
	const pendingReleaseReviewSources = requiredSourceIds
		.filter((id) => sources[id].activationStatus !== 'accepted')
		.map((id) => Object.freeze({ id, blockedBy: sources[id].blockedBy }));
	const sourceRoots = normalizeSourceRoots(options.sourceRoots);
	const sourceArchives = normalizeSourceArchives(options.sourceArchives);
	const authenticatedInputs = requiredSourceIds.map((sourceId) => (
		authenticateMilestone5NativeSourceInput({
			repositoryRoot,
			...(sourceManifestPath === undefined ? {} : { manifestPath: sourceManifestPath }),
			sourceId,
			archivePath: sourceArchives[sourceId],
			sourceRoot: sourceRoots[sourceId],
		})
	));
	const snapshotParent = canonicalEmptyDirectory(options.sourceSnapshotRoot,
		'Professional native source snapshot parent');
	const sourceAuthentication = [];
	try {
		for (const witness of authenticatedInputs) {
			sourceAuthentication.push(snapshotMilestone5NativeSourceInput(witness, {
				snapshotRoot: join(snapshotParent, witness.id),
			}));
		}
		return authenticatedBuildPlan({
			pendingReleaseReviewSources, options, repositoryRoot, requiredSourceIds,
			sourceAuthentication, snapshotParent, target,
		});
	} catch (error) {
		for (const snapshot of sourceAuthentication) removeMilestone5NativeSourceSnapshot(snapshot);
		throw error;
	}
}

/**
 * Builds the plan from sources already snapshotted onto disk.
 *
 * Kept separate so every step after the snapshots are taken runs inside the
 * caller's cleanup: a failure here — an unusable SDK layout, a missing build
 * root — would otherwise strand the extracted trees, and the snapshot parent
 * must be empty for the next plan to claim it.
 */
function authenticatedBuildPlan({
	pendingReleaseReviewSources, options, repositoryRoot, requiredSourceIds,
	sourceAuthentication, snapshotParent, target,
}) {
	const snapshotRoots = Object.fromEntries(sourceAuthentication.map((witness) => [witness.id, witness.extractedTree.root]));
	const vst3Closure = assertExtractedJuceVst3Closure(snapshotRoots.juce);
	assertFile(snapshotRoots.clap, 'include/clap/clap.h', 'direct CLAP 1.2.4 ABI');
	assertFile(snapshotRoots['electron-node-api-headers'], 'include/node/node_api.h', 'Electron 43.1.1 Node-API headers');
	if (target.startsWith('win-')) assertFile(snapshotRoots['asio-sdk'], 'common/asio.h', 'ASIO SDK 2.3.4');
	if (target.startsWith('linux-')) assertFile(snapshotRoots.lv2, `${LV2_INCLUDE_ROOT}/lv2/core/lv2.h`, 'LV2 1.18.10 headers');
	const buildRoot = resolve(options.buildRoot);
	const installRoot = resolve(options.installRoot ?? `${options.buildRoot}-install`);
	const sourceRoot = resolve(repositoryRoot, SOUNDSCAPER_PROFESSIONAL_NATIVE_ROOT);
	const targetSelection = target.startsWith('win-')
		? ['-A', target === 'win-arm64' ? 'ARM64' : 'x64']
		: ['-G', 'Ninja'];
	const definitions = [
		`-DSOUNDSCAPER_JUCE_ROOT=${snapshotRoots.juce}`,
		`-DSOUNDSCAPER_CLAP_ROOT=${snapshotRoots.clap}`,
		`-DSOUNDSCAPER_NODE_API_INCLUDE=${resolve(snapshotRoots['electron-node-api-headers'], 'include/node')}`,
		`-DSOUNDSCAPER_VST3_PROVENANCE_COMMIT=${EXPECTED['vst3-sdk'].commit}`,
		`-DSOUNDSCAPER_NATIVE_TARGET=${target}`,
		`-DCMAKE_BUILD_TYPE=Release`,
		'-DBUILD_TESTING=ON',
	];
	if (target.startsWith('win-')) {
		definitions.push(`-DSOUNDSCAPER_ASIO_ROOT=${snapshotRoots['asio-sdk']}`);
		definitions.push('-DCMAKE_SYSTEM_VERSION=10.0.26100');
	}
	if (target.startsWith('linux-')) {
		definitions.push(`-DSOUNDSCAPER_LV2_ROOT=${resolve(snapshotRoots.lv2, LV2_INCLUDE_ROOT)}`);
	}
	if (target === 'mac-arm64') {
		assert(typeof options.macosSdkPath === 'string' && options.macosSdkPath.length > 0,
			'mac-arm64 requires the selected macOS SDK path.');
		definitions.push(`-DCMAKE_OSX_SYSROOT=${canonicalSoundscaperProfessionalNativeMacosSdkPath(options.macosSdkPath)}`);
		definitions.push('-DCMAKE_OSX_ARCHITECTURES=arm64');
	}
	if (target === 'linux-arm64') definitions.push('-DCMAKE_SYSTEM_PROCESSOR=arm64');
	const plan = Object.freeze({
		schemaVersion: 1,
		target,
		sourceRoot,
		buildRoot,
		installRoot,
		sourceAuthentication: Object.freeze(sourceAuthentication),
		sourceSnapshotRoot: snapshotParent,
		m9ReleaseReview: Object.freeze({
			status: pendingReleaseReviewSources.length === 0 ? 'complete' : 'pending',
			sourceIds: Object.freeze(requiredSourceIds),
			pendingSources: Object.freeze(pendingReleaseReviewSources),
		}),
		vst3Closure: Object.freeze({
			kind: 'juce-embedded-sdk',
			root: vst3Closure.root,
			version: vst3Closure.version,
			versionHeaderSha256: vst3Closure.versionHeaderSha256,
			provenanceOnlySourceId: 'vst3-sdk',
			commit: EXPECTED['vst3-sdk'].commit,
		}),
		features: featuresFor(target),
		configure: Object.freeze({
			command: 'cmake',
			argv: Object.freeze(['-S', sourceRoot, '-B', buildRoot, ...targetSelection, ...definitions]),
		}),
		build: Object.freeze({ command: 'cmake', argv: Object.freeze(['--build', buildRoot, '--config', 'Release', '--parallel']) }),
		test: Object.freeze({ command: 'ctest', argv: Object.freeze([
			'--test-dir', buildRoot, '-C', 'Release', '--output-on-failure', '--no-tests=error',
		]) }),
		install: Object.freeze({ command: 'cmake', argv: Object.freeze([
			'--install', buildRoot, '--config', 'Release', '--prefix', installRoot,
		]) }),
	});
	AUTHENTICATED_BUILD_PLANS.add(plan);
	return plan;
}

export function executeSoundscaperProfessionalNativeBuild(plan, options = {}) {
	assert(plan !== null && typeof plan === 'object' && AUTHENTICATED_BUILD_PLANS.has(plan),
		'Professional native execution requires an authenticated build plan.');
	try {
		for (const witness of plan.sourceAuthentication) verifyMilestone5NativeSourceInput(witness);
		const run = options.run ?? spawnSync;
		for (const step of [plan.configure, plan.build, plan.test, plan.install]) {
			const result = run(step.command, step.argv, {
				encoding: 'utf8', maxBuffer: MAXIMUM_BUILD_STEP_OUTPUT_BYTES,
				stdio: options.stdio ?? 'pipe',
			});
			assert(result.status === 0, `Professional native build failed: ${result.stderr || result.stdout || 'unknown error'}`);
		}
		for (const witness of plan.sourceAuthentication) verifyMilestone5NativeSourceInput(witness);
		return Object.freeze({
			target: plan.target, buildRoot: plan.buildRoot, installRoot: plan.installRoot, status: 'built',
			sourceAuthentication: sourceAuthenticationSummary(plan.sourceAuthentication),
		});
	} finally {
		for (const snapshot of plan.sourceAuthentication) removeMilestone5NativeSourceSnapshot(snapshot);
	}
}

function sourceAuthenticationSummary(witnesses) {
	return Object.freeze({
		schemaVersion: 1,
		status: 'authenticated',
		sources: Object.freeze(witnesses.map((witness) => Object.freeze({
			id: witness.id,
			authenticationStatus: 'authenticated',
			archiveEvidence: Object.freeze({
				byteLength: witness.archive.byteLength, sha256: witness.archive.sha256,
			}),
			extractedTreeEvidence: Object.freeze({
				algorithm: witness.extractedTree.algorithm,
				fileCount: witness.extractedTree.fileCount,
				sha256: witness.extractedTree.sha256,
			}),
		}))),
	});
}

function normalizeSourceRoots(value) {
	assert(value && typeof value === 'object' && !Array.isArray(value), 'Native sourceRoots must be a record.');
	const roots = {};
	for (const id of ['electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'asio-sdk', 'lv2']) {
		if (value[id] !== undefined) roots[id] = resolve(String(value[id]));
	}
	assert(roots['electron-node-api-headers'] && roots.juce && roots.clap && roots['vst3-sdk'],
		'Electron Node-API headers, JUCE, direct CLAP, and VST3 provenance extracted source roots are required.');
	return roots;
}

function normalizeSourceArchives(value) {
	assert(value && typeof value === 'object' && !Array.isArray(value),
		'Native sourceArchives must be a record.');
	const archives = {};
	for (const id of ['electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'asio-sdk', 'lv2']) {
		if (value[id] !== undefined) archives[id] = resolve(String(value[id]));
	}
	assert(archives['electron-node-api-headers'] && archives.juce && archives.clap && archives['vst3-sdk'],
		'Electron Node-API headers, JUCE, direct CLAP, and VST3 provenance source archives are required.');
	return archives;
}

function assertSource(register, id, expected) {
	const source = requireMilestone5NativeSource(register, id);
	assert(source.version === expected.version, `${id}: unexpected source version.`);
	assert(source.git.commit === expected.commit, `${id}: unexpected source commit.`);
	assert(source.licenseSelection === expected.license, `${id}: unexpected license selection.`);
	assert(source.authenticationStatus === 'pinned-metadata',
		`${id}: checked-in metadata must not claim runtime source authentication.`);
	return source;
}

function assertExtractedJuceVst3Closure(juceRoot) {
	assertFile(juceRoot, 'CMakeLists.txt', 'JUCE 9.0.1 source tree');
	assertFile(juceRoot, 'modules/juce_audio_processors/format_types/juce_VST3PluginFormat.cpp', 'JUCE VST3 adapter');
	const closure = resolve(juceRoot, JUCE_VST3_SDK_CLOSURE);
	assert(existsSync(closure), 'JUCE 9.0.1 embedded VST3 SDK closure is missing.');
	const versionHeader = readFileSync(resolve(juceRoot, JUCE_VST3_VERSION_HEADER));
	const version = /^[\t ]*#[\t ]*define[\t ]+kVstVersionString[\t ]+"([^"\r\n]+)"[\t ]*(?:\/\/[^\r\n]*)?$/mu
		.exec(versionHeader.toString('utf8'))?.[1];
	assert(version === 'VST 3.8.0',
		'The JUCE embedded VST3 SDK is not exact API version 3.8.0.');
	return Object.freeze({
		root: closure,
		version: '3.8.0',
		versionHeaderSha256: createHash('sha256').update(versionHeader).digest('hex'),
	});
}

function assertFile(root, relativePath, label) {
	assert(typeof root === 'string' && existsSync(resolve(root, relativePath)), `${label} is missing ${relativePath}.`);
}

function canonicalEmptyDirectory(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`${label} must be an absolute normalized path.`);
	}
	const metadata = lstatSync(value);
	assert(metadata.isDirectory() && !metadata.isSymbolicLink() && realpathSync(value) === value,
		`${label} must be one canonical non-symbolic directory.`);
	assert(readdirSync(value).length === 0, `${label} must be empty and unique to one build plan.`);
	return value;
}

function featuresFor(target) {
	return Object.freeze({
		audioStreaming: Object.freeze(target.startsWith('linux-')
			? ['pipewire', 'alsa']
			: target === 'mac-arm64' ? ['coreaudio'] : ['wasapi', 'asio']),
		discoveryOnly: Object.freeze(target.startsWith('linux-') ? ['jack'] : []),
		plugins: Object.freeze(target.startsWith('linux-')
			? ['vst3', 'clap', 'lv2']
			: target === 'mac-arm64' ? ['vst3', 'clap', 'au'] : ['vst3', 'clap']),
	});
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
