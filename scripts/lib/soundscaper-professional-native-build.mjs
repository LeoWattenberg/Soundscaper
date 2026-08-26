/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

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
const AUTHENTICATED_BUILD_PLANS = new WeakSet();

/**
 * JUCE 9 moved every hosted plug-in format's vendored SDK into the headless
 * audio-processors module; `juce_audio_processors` now re-exports it. The pin
 * names that module directly because the pre-9 path it used to live under does
 * not exist in JUCE 9.0.1, and a recipe that looked for it there could never
 * configure.
 */
const JUCE_VST3_SDK_CLOSURE = 'modules/juce_audio_processors_headless/format_types/VST3_SDK';
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
	const blockedSources = requiredSourceIds
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
			blockedSources, options, repositoryRoot, requiredSourceIds,
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
	blockedSources, options, repositoryRoot, requiredSourceIds,
	sourceAuthentication, snapshotParent, target,
}) {
	const snapshotRoots = Object.fromEntries(sourceAuthentication.map((witness) => [witness.id, witness.extractedTree.root]));
	assertExtractedJuceVst3Closure(snapshotRoots.juce);
	assertFile(snapshotRoots.clap, 'include/clap/clap.h', 'direct CLAP 1.2.4 ABI');
	assertFile(snapshotRoots['electron-node-api-headers'], 'include/node/node_api.h', 'Electron 43.1.1 Node-API headers');
	if (target.startsWith('win-')) assertFile(snapshotRoots['asio-sdk'], 'common/asio.h', 'ASIO SDK 2.3.4');
	if (target.startsWith('linux-')) assertFile(snapshotRoots.lv2, `${LV2_INCLUDE_ROOT}/lv2/core/lv2.h`, 'LV2 1.18.10 headers');
	const buildRoot = resolve(options.buildRoot);
	const sourceRoot = resolve(repositoryRoot, SOUNDSCAPER_PROFESSIONAL_NATIVE_ROOT);
	const definitions = [
		`-DSOUNDSCAPER_JUCE_ROOT=${snapshotRoots.juce}`,
		`-DSOUNDSCAPER_CLAP_ROOT=${snapshotRoots.clap}`,
		`-DSOUNDSCAPER_NODE_API_INCLUDE=${resolve(snapshotRoots['electron-node-api-headers'], 'include/node')}`,
		`-DSOUNDSCAPER_VST3_PROVENANCE_COMMIT=${EXPECTED['vst3-sdk'].commit}`,
		`-DCMAKE_BUILD_TYPE=Release`,
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
		definitions.push(`-DCMAKE_OSX_SYSROOT=${resolve(options.macosSdkPath)}`);
		definitions.push('-DCMAKE_OSX_ARCHITECTURES=arm64');
	}
	if (target.endsWith('-arm64') && target !== 'mac-arm64') definitions.push('-DCMAKE_SYSTEM_PROCESSOR=arm64');
	const plan = Object.freeze({
		schemaVersion: 1,
		target,
		sourceRoot,
		buildRoot,
		sourceAuthentication: Object.freeze(sourceAuthentication),
		sourceSnapshotRoot: snapshotParent,
		sourceActivation: Object.freeze({
			status: blockedSources.length === 0 ? 'accepted' : 'blocked',
			sourceIds: Object.freeze(requiredSourceIds),
			blockedSources: Object.freeze(blockedSources),
		}),
		vst3Closure: Object.freeze({
			kind: 'juce-embedded-sdk',
			root: resolve(snapshotRoots.juce, JUCE_VST3_SDK_CLOSURE),
			provenanceOnlySourceId: 'vst3-sdk',
			commit: EXPECTED['vst3-sdk'].commit,
		}),
		features: featuresFor(target),
		configure: Object.freeze({ command: 'cmake', argv: Object.freeze(['-S', sourceRoot, '-B', buildRoot, ...definitions]) }),
		build: Object.freeze({ command: 'cmake', argv: Object.freeze(['--build', buildRoot, '--config', 'Release', '--parallel']) }),
	});
	AUTHENTICATED_BUILD_PLANS.add(plan);
	return plan;
}

export function executeSoundscaperProfessionalNativeBuild(plan, options = {}) {
	assert(plan !== null && typeof plan === 'object' && AUTHENTICATED_BUILD_PLANS.has(plan),
		'Professional native execution requires an authenticated build plan.');
	try {
		assert(plan.sourceActivation.status === 'accepted',
			'Professional native source activation is blocked until every required register row is accepted.');
		for (const witness of plan.sourceAuthentication) verifyMilestone5NativeSourceInput(witness);
		const run = options.run ?? spawnSync;
		for (const step of [plan.configure, plan.build]) {
			const result = run(step.command, step.argv, { encoding: 'utf8', stdio: options.stdio ?? 'pipe' });
			assert(result.status === 0, `Professional native build failed: ${result.stderr || result.stdout || 'unknown error'}`);
		}
		for (const witness of plan.sourceAuthentication) verifyMilestone5NativeSourceInput(witness);
		return Object.freeze({
			target: plan.target, buildRoot: plan.buildRoot, status: 'built',
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
