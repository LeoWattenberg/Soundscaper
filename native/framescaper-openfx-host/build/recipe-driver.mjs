#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	addBoostClosureWitness,
	addSourceTreeWitness,
	verifySourceAuthenticationWitness,
} from './source-authentication.mjs';

const HOST_ROOT = 'native/framescaper-openfx-host';
const MEDIA_HOST_ROOT = 'native/framescaper-media-host';
const SOURCE_RECEIPT = '.framescaper-source-identity.json';
const DIGEST = /^[a-f0-9]{64}$/u;
const SOURCE_DATE_EPOCH = 1786492800;
const OPENFX_COMMIT_SHA = 'ab779510b2655b4d11a7e01e5c521f9aa8c88976';
const OPENFX_ARCHIVE_SHA256 = '7f4fcde6c4bff3ee1f95a0b73a805e662a3e030999523165b40cfbe76c1ab9f5';
const BOOST_ARCHIVE_SHA256 = '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c';
const MEDIA_CONTRACT_SOURCES = Object.freeze([
	'legacy_plan_semantics.cpp', 'legacy_plan_v8_filter_semantics.cpp',
	'media_file_grants.cpp', 'media_plan.cpp', 'sha256.cpp', 'strict_json.cpp',
]);
const TARGETS = Object.freeze([
	Object.freeze({ id: 'linux-x64', runtime: 'linux-x64', hostRuntime: 'linux-x64', preset: 'linux-x64', toolchainFile: 'build/toolchains/linux-x64.cmake', architectureDirectory: 'Linux-x86-64' }),
	Object.freeze({ id: 'linux-arm64', runtime: 'linux-arm64', hostRuntime: 'linux-arm64', preset: 'linux-arm64', toolchainFile: 'build/toolchains/linux-arm64.cmake', architectureDirectory: 'Linux-aarch64' }),
	Object.freeze({ id: 'mac-arm64', runtime: 'darwin-arm64', hostRuntime: 'darwin-arm64', preset: 'mac-arm64', toolchainFile: 'build/toolchains/mac-arm64.cmake', architectureDirectory: 'MacOS' }),
	Object.freeze({ id: 'win-x64', runtime: 'win32-x64', hostRuntime: 'win32-x64', preset: 'win-x64', toolchainFile: 'build/toolchains/win-x64.cmake', architectureDirectory: 'Win64' }),
	Object.freeze({ id: 'win-arm64', runtime: 'win32-arm64', hostRuntime: 'win32-arm64', preset: 'win-arm64ec', toolchainFile: 'build/toolchains/win-arm64.cmake', architectureDirectory: 'Win-arm64ec' }),
]);
const OPTION_FIELDS = Object.freeze([
	'repositoryRoot', 'targetId', 'hostRuntime', 'toolchainReceipt', 'toolchainIdentity',
	'openfxSourceRoot', 'boostSourceRoot', 'outputRoot',
]);
const TOOL_ROLES = Object.freeze(['c', 'cmake', 'cxx', 'ninja']);
const TOOLCHAIN_ENVIRONMENT = new Set([
	'INCLUDE', 'LIB', 'LIBPATH', 'MACOSX_DEPLOYMENT_TARGET', 'PATH', 'SDKROOT', 'SYSTEMROOT',
]);
const RECIPES = new WeakMap();
const EXECUTED = new WeakSet();

export const FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS = TARGETS;

export function fingerprintFramescaperOpenFxHostToolchainReceipt(value) {
	const receipt = closedRecord(value, [
		'schemaVersion', 'targetId', 'hostRuntime', 'executables', 'environment',
	], 'OpenFX-host toolchain receipt body');
	return digest(Buffer.from(canonicalJson(receipt)));
}

export function createFramescaperOpenFxHostBuildRecipe(value) {
	const options = closedRecord(value, OPTION_FIELDS, 'OpenFX-host build options');
	const repositoryRoot = existingDirectory(options.repositoryRoot, 'repository root');
	const hostRoot = existingDirectory(join(repositoryRoot, HOST_ROOT), 'OpenFX-host source root');
	const witnesses = [];
	const manifest = jsonBytes(
		witnessFile(join(hostRoot, 'source-manifest.json'), witnesses),
		'OpenFX-host source manifest',
	);
	assertPendingTargets(manifest);
	verifyPinnedSourceClosure(hostRoot, manifest, witnesses);
	const mediaContract = verifyMediaContractClosure(
		repositoryRoot, hostRoot, manifest, witnesses,
	);
	const target = exactTarget(hostRoot, manifest, options.targetId, witnesses);
	if (options.hostRuntime !== target.hostRuntime) {
		throw new Error(`Target ${target.id} requires build host ${target.hostRuntime}.`);
	}
	const outputRoot = emptyOutputRoot(options.outputRoot, repositoryRoot);
	const openfxSourceRoot = existingDirectory(options.openfxSourceRoot, 'OpenFX source root');
	const boostSourceRoot = existingDirectory(options.boostSourceRoot, 'Boost source root');
	assertSeparateRoots([
		hostRoot, mediaContract.root, outputRoot, openfxSourceRoot, boostSourceRoot,
	]);
	verifyOpenFxSource(openfxSourceRoot, manifest, witnesses);
	verifyBoostSource(boostSourceRoot, mediaContract.boostHeaderClosure, witnesses);
	const tools = verifyToolchain(
		options.toolchainReceipt, options.toolchainIdentity, target, witnesses,
	);
	const hostBuild = join(outputRoot, 'host-build');
	const hostInstall = join(outputRoot, 'host-install');
	const environment = Object.freeze({
		...tools.environment,
		SOURCE_DATE_EPOCH: String(manifest.sourceDateEpoch), TZ: 'UTC', LC_ALL: 'C',
	});
	const commands = Object.freeze([
		command('host-configure', tools.executables.cmake.path, [
			'--preset', target.preset, '-S', hostRoot, '-B', hostBuild, '--fresh',
			`-DCMAKE_MAKE_PROGRAM=${tools.executables.ninja.path}`,
			`-DFRAMESCAPER_C_COMPILER=${tools.executables.c.path}`,
			`-DFRAMESCAPER_CXX_COMPILER=${tools.executables.cxx.path}`,
			`-DFRAMESCAPER_OPENFX_SOURCE_ROOT=${openfxSourceRoot}`,
			`-DBOOST_ROOT=${boostSourceRoot}`,
			'-DBoost_NO_SYSTEM_PATHS=ON',
			`-DCMAKE_INSTALL_PREFIX=${hostInstall}`,
		], hostRoot, environment),
		command('host-build', tools.executables.cmake.path, [
			'--build', hostBuild, '--config', 'Release', '--target',
			'framescaper-ofx-scanner', 'framescaper-ofx-runtime-host', '--parallel', '1',
		], hostRoot, environment),
		command('host-install', tools.executables.cmake.path, [
			'--install', hostBuild, '--config', 'Release', '--prefix', hostInstall,
		], hostRoot, environment),
	]);
	const recipe = deepFreeze({
		schemaVersion: 1,
		kind: 'framescaper-openfx-host-build',
		target: {
			id: target.id, runtime: target.runtime, hostRuntime: target.hostRuntime,
			architectureDirectory: target.architectureDirectory,
		},
		toolchainIdentity: tools.identitySha256,
		mediaContractIdentity: mediaContract.identitySha256,
		outputRoot,
		payloadManifestMutation: false,
		commands,
	});
	RECIPES.set(recipe, Object.freeze({
		hostRuntime: target.hostRuntime, outputRoot,
		witnesses: Object.freeze(witnesses),
	}));
	return recipe;
}

export function executeFramescaperOpenFxHostBuildRecipe(recipe, options = {}) {
	const state = RECIPES.get(recipe);
	if (!state || EXECUTED.has(recipe)) {
		throw new TypeError('Only one fresh authentic OpenFX-host build recipe may execute.');
	}
	const fields = closedRecord(options, ['run'], 'OpenFX-host execution options', true);
	if (currentHostRuntime() !== state.hostRuntime) throw new Error(`Build host drifted from ${state.hostRuntime}.`);
	const run = fields.run ?? spawnSync;
	if (typeof run !== 'function') throw new TypeError('The OpenFX-host command runner must be callable.');
	verifyWitnesses(state.witnesses);
	if (readdirSync(state.outputRoot).length !== 0) throw new Error('The explicit output root is no longer empty.');
	EXECUTED.add(recipe);
	mkdirSync(join(state.outputRoot, 'host-build'), { mode: 0o700 });
	mkdirSync(join(state.outputRoot, 'host-install'), { mode: 0o700 });
	for (const command of recipe.commands) {
		verifyWitnesses(state.witnesses);
		const result = run(command.executable, [...command.args], {
			cwd: command.cwd, env: { ...command.environment }, stdio: 'inherit', windowsHide: true,
		});
		if (!result || result.status !== 0) {
			throw new Error(`OpenFX-host ${command.phase} failed with status ${String(result?.status)}.`);
		}
	}
}

function exactTarget(hostRoot, manifest, value, witnesses) {
	const targets = pinnedJson(hostRoot, manifest, 'build/targets.json', witnesses);
	if (targets.schemaVersion !== 1 || canonicalJson(targets.targets) !== canonicalJson(TARGETS)) {
		throw new Error('The OpenFX-host five-target identity drifted.');
	}
	const target = TARGETS.find(({ id }) => id === value);
	if (!target) throw new RangeError('The OpenFX-host target is unsupported.');
	const preset = pinnedJson(hostRoot, manifest, 'CMakePresets.json', witnesses);
	if (canonicalJson(preset) !== canonicalJson(expectedCmakePresets())) {
		throw new Error('The OpenFX-host CMake presets drifted from their closed five-target contract.');
	}
	const toolchain = pinnedFile(hostRoot, manifest, target.toolchainFile, witnesses).toString('utf8');
	if (toolchain !== expectedToolchain(target.id)) {
		throw new Error(`Target ${target.id} toolchain drifted from its closed compiler contract.`);
	}
	return target;
}

function expectedCmakePresets() {
	const configurePresets = [{
		name: 'base', hidden: true, generator: 'Ninja', binaryDir: '${sourceDir}/out/${presetName}',
		cacheVariables: { CMAKE_BUILD_TYPE: 'Release' },
		environment: { SOURCE_DATE_EPOCH: String(SOURCE_DATE_EPOCH), TZ: 'UTC', LC_ALL: 'C' },
	}, ...TARGETS.map((target) => ({
		name: target.preset, inherits: 'base',
		...(target.id.startsWith('win-') ? { generator: 'Ninja Multi-Config' } : {}),
		toolchainFile: target.toolchainFile,
	}))];
	const buildPresets = TARGETS.map((target) => ({
		name: target.preset, configurePreset: target.preset,
		...(target.id.startsWith('win-') ? { configuration: 'Release' } : {}),
	}));
	return { version: 8, configurePresets, buildPresets };
}

function expectedToolchain(targetId) {
	const platform = {
		'linux-x64': 'set(CMAKE_SYSTEM_NAME Linux)\nset(CMAKE_SYSTEM_PROCESSOR x86_64)',
		'linux-arm64': 'set(CMAKE_SYSTEM_NAME Linux)\nset(CMAKE_SYSTEM_PROCESSOR aarch64)',
		'mac-arm64': 'set(CMAKE_SYSTEM_NAME Darwin)\nset(CMAKE_OSX_ARCHITECTURES arm64)\nset(CMAKE_OSX_DEPLOYMENT_TARGET 13.0)',
		'win-x64': 'set(CMAKE_SYSTEM_NAME Windows)\nset(CMAKE_SYSTEM_PROCESSOR AMD64)',
		'win-arm64': 'set(CMAKE_SYSTEM_NAME Windows)\nset(CMAKE_SYSTEM_PROCESSOR ARM64EC)',
	}[targetId];
	return `# SPDX-License-Identifier: AGPL-3.0-only\n${platform}\nif(NOT IS_ABSOLUTE "\${FRAMESCAPER_C_COMPILER}" OR NOT IS_ABSOLUTE "\${FRAMESCAPER_CXX_COMPILER}")\n\tmessage(FATAL_ERROR "The recipe must supply absolute authenticated C and C++ compilers")\nendif()\nset(CMAKE_C_COMPILER "\${FRAMESCAPER_C_COMPILER}" CACHE FILEPATH "" FORCE)\nset(CMAKE_CXX_COMPILER "\${FRAMESCAPER_CXX_COMPILER}" CACHE FILEPATH "" FORCE)\n`;
}

function assertPendingTargets(manifest) {
	closedRecord(manifest, [
		'schemaVersion', 'hostVersion', 'helperContractVersion', 'license', 'sourceDateEpoch',
		'openfx', 'sourceFiles', 'targets',
	], 'OpenFX-host source manifest');
	closedRecord(manifest.openfx, [
		'version', 'tag', 'commit', 'commitSha', 'tagObjectSha', 'signedTagApiUrl',
		'signedTagVerifiedAt', 'url', 'byteLength', 'sha256', 'extractedTree', 'license',
	], 'OpenFX-host source pin');
	closedRecord(manifest.targets, TARGETS.map(({ id }) => id), 'OpenFX-host target states');
	if (manifest.schemaVersion !== 1 || manifest.hostVersion !== '1.0.0'
		|| manifest.helperContractVersion !== 1 || manifest.license !== 'AGPL-3.0-only'
		|| manifest.sourceDateEpoch !== SOURCE_DATE_EPOCH
		|| manifest.openfx.version !== '1.5.1' || manifest.openfx.tag !== 'OFX_Release_1.5.1'
		|| manifest.openfx.commit !== 'ab77951' || manifest.openfx.commitSha !== OPENFX_COMMIT_SHA
		|| manifest.openfx.sha256 !== OPENFX_ARCHIVE_SHA256
		|| manifest.openfx.license !== 'BSD-3-Clause') {
		throw new Error('The OpenFX-host pinned source manifest is unsupported.');
	}
	for (const target of TARGETS) {
		const state = manifest.targets[target.id];
		closedRecord(state, [
			'runtime', 'status', 'blockedBy', 'toolchainIdentity', 'scannerPayload',
			'runtimeHostPayload', 'isolationPayload', 'productionReadiness',
		], `OpenFX-host ${target.id} target state`);
		if (state?.status !== 'pending-external' || state.toolchainIdentity !== null
			|| state.scannerPayload !== null || state.runtimeHostPayload !== null
			|| state.isolationPayload !== null || state.productionReadiness !== null
			|| state.runtime !== target.runtime
			|| typeof state.blockedBy !== 'string' || state.blockedBy.length === 0) {
			throw new Error(`Target ${target.id} must remain pending-external with no payload claim.`);
		}
	}
}

function verifyPinnedSourceClosure(root, manifest, witnesses) {
	if (!Array.isArray(manifest.sourceFiles) || manifest.sourceFiles.length === 0) {
		throw new Error('The OpenFX-host source manifest has no closed source-file inventory.');
	}
	const paths = [];
	for (const value of manifest.sourceFiles) {
		const entry = closedRecord(value, ['path', 'byteLength', 'sha256'], 'OpenFX-host source pin');
		if (!safeRelativePath(entry.path) || !Number.isSafeInteger(entry.byteLength)
			|| entry.byteLength < 0 || !DIGEST.test(String(entry.sha256)) || paths.includes(entry.path)) {
			throw new Error('The OpenFX-host source-file inventory is not canonical.');
		}
		paths.push(entry.path);
		pinnedFile(root, manifest, entry.path, witnesses);
	}
	if (canonicalJson(paths) !== canonicalJson([...paths].sort())) {
		throw new Error('The OpenFX-host source-file inventory must be path sorted.');
	}
	for (const required of [
		'CMakeLists.txt', 'CMakePresets.json', 'build/recipe-driver.mjs', 'build/targets.json',
		...TARGETS.map(({ toolchainFile }) => toolchainFile),
	]) if (!paths.includes(required)) throw new Error(`Required build input ${required} is not pinned.`);
}

function verifyMediaContractClosure(repositoryRoot, hostRoot, manifest, witnesses) {
	const mediaRoot = existingDirectory(join(repositoryRoot, MEDIA_HOST_ROOT), 'media-host contract root');
	const cmake = pinnedFile(hostRoot, manifest, 'CMakeLists.txt', witnesses).toString('utf8');
	if (!/set\(FRAMESCAPER_MEDIA_CONTRACT_ROOT\s+"\$\{CMAKE_CURRENT_SOURCE_DIR\}\/\.\.\/framescaper-media-host\/src"\s*\)/u.test(cmake)) {
		throw new Error('The OpenFX build does not bind the exact sibling media-contract root.');
	}
	const cmakeSources = [...cmake.matchAll(
		/\$\{FRAMESCAPER_MEDIA_CONTRACT_ROOT\}\/([a-zA-Z0-9._+-]+\.cpp)/gu,
	)].map((match) => match[1]).sort();
	if (canonicalJson(cmakeSources) !== canonicalJson([...MEDIA_CONTRACT_SOURCES].sort())) {
		throw new Error('The OpenFX build media-contract source set drifted.');
	}

	const manifestBytes = witnessFile(join(mediaRoot, 'source-manifest.json'), witnesses);
	const mediaManifest = jsonBytes(manifestBytes, 'media-host source manifest');
	closedRecord(mediaManifest, [
		'schemaVersion', 'hostVersion', 'helperContractVersion', 'license', 'sourceDateEpoch',
		'ffmpeg', 'boost', 'sourceFiles', 'targets',
	], 'media-host source manifest');
	if (mediaManifest.schemaVersion !== 1 || mediaManifest.hostVersion !== '1.0.0'
		|| mediaManifest.helperContractVersion !== 1
		|| mediaManifest.license !== 'AGPL-3.0-only'
		|| mediaManifest.sourceDateEpoch !== SOURCE_DATE_EPOCH
		|| mediaManifest.boost?.version !== '1.92.0'
		|| mediaManifest.boost?.archiveSha256 !== BOOST_ARCHIVE_SHA256) {
		throw new Error('The reused media-host source manifest identity is unsupported.');
	}
	const boostHeaderClosure = closedRecord(mediaManifest.boost.headerClosure, [
		'algorithm', 'roots', 'fileCount', 'sha256',
	], 'reused media-host Boost closure');
	if (!Array.isArray(mediaManifest.sourceFiles) || mediaManifest.sourceFiles.length === 0) {
		throw new Error('The reused media-host source manifest has no source closure.');
	}
	const pins = new Map();
	for (const value of mediaManifest.sourceFiles) {
		const entry = closedRecord(value, ['path', 'byteLength', 'sha256'], 'media-host source pin');
		if (!safeRelativePath(entry.path) || !Number.isSafeInteger(entry.byteLength)
			|| entry.byteLength < 0 || !DIGEST.test(String(entry.sha256))
			|| pins.has(entry.path)) {
			throw new Error('The reused media-host source inventory is not canonical.');
		}
		pins.set(entry.path, entry);
	}
	const pinPaths = [...pins.keys()];
	if (canonicalJson(pinPaths) !== canonicalJson([...pinPaths].sort())) {
		throw new Error('The reused media-host source inventory must be path sorted.');
	}

	const queue = MEDIA_CONTRACT_SOURCES.map((path) => `src/${path}`);
	const closure = [];
	const sourceAuthenticationPath = 'build/source-authentication.mjs';
	const sourceAuthenticationPin = pins.get(sourceAuthenticationPath);
	if (!sourceAuthenticationPin) {
		throw new Error('The reused media-host source authenticator is not manifest pinned.');
	}
	const sourceAuthenticationBytes = witnessFile(
		join(mediaRoot, sourceAuthenticationPath), witnesses,
	);
	if (sourceAuthenticationBytes.byteLength !== sourceAuthenticationPin.byteLength
		|| digest(sourceAuthenticationBytes) !== sourceAuthenticationPin.sha256) {
		throw new Error('The reused media-host source authenticator drifted from its pin.');
	}
	closure.push({ path: sourceAuthenticationPath, ...sourceAuthenticationPin });
	const seen = new Set();
	while (queue.length > 0) {
		const path = queue.shift();
		if (seen.has(path)) continue;
		seen.add(path);
		const pin = pins.get(path);
		if (!pin) throw new Error(`Reused media-contract input ${path} is not manifest pinned.`);
		const bytes = witnessFile(join(mediaRoot, path), witnesses);
		if (bytes.byteLength !== pin.byteLength || digest(bytes) !== pin.sha256) {
			throw new Error(`Reused media-contract input ${path} drifted from its pin.`);
		}
		closure.push({ path, byteLength: pin.byteLength, sha256: pin.sha256 });
		for (const match of bytes.toString('utf8').matchAll(/^\s*#include\s+"([^"]+)"/gmu)) {
			const included = relative(
				mediaRoot, resolve(dirname(join(mediaRoot, path)), match[1]),
			).replaceAll('\\', '/');
			if (!included.startsWith('src/')) {
				throw new Error(`Reused media-contract include ${included} resolves outside its source root.`);
			}
			if (!pins.has(included)) {
				throw new Error(`Reused media-contract include ${included} is not manifest pinned.`);
			}
			queue.push(included);
		}
	}
	closure.sort(({ path: left }, { path: right }) => left < right ? -1 : left > right ? 1 : 0);
	return Object.freeze({
		root: mediaRoot,
		boostHeaderClosure,
		identitySha256: digest(Buffer.from(canonicalJson({
			manifestSha256: digest(manifestBytes), sourceFiles: closure,
		}))),
	});
}

function verifyOpenFxSource(root, manifest, witnesses) {
	const receipt = sourceReceipt(root, witnesses);
	const expected = {
		schemaVersion: 1, component: 'openfx', version: '1.5.1',
		commitSha: OPENFX_COMMIT_SHA, archiveSha256: OPENFX_ARCHIVE_SHA256,
		extractedTreeSha256: manifest.openfx.extractedTree.sha256, root,
	};
	if (canonicalJson(receipt) !== canonicalJson(expected)) {
		throw new Error('The OpenFX source receipt is not the pinned 1.5.1 ab77951 identity.');
	}
	addSourceTreeWitness(root, manifest.openfx.extractedTree, witnesses, 'OpenFX extracted source tree');
	for (const header of ['ofxCore.h', 'ofxImageEffect.h', 'ofxProperty.h', 'ofxParam.h']) {
		const text = witnessFile(join(root, 'include', header), witnesses).toString('utf8');
		if (text.length === 0) throw new Error(`The provisioned OpenFX source omits ${header}.`);
	}
}

function verifyBoostSource(root, headerClosure, witnesses) {
	const receipt = sourceReceipt(root, witnesses);
	const expected = {
		schemaVersion: 1, component: 'boost', version: '1.92.0',
		archiveSha256: BOOST_ARCHIVE_SHA256,
		headerClosureSha256: headerClosure.sha256, root,
	};
	if (canonicalJson(receipt) !== canonicalJson(expected)) {
		throw new Error('The Boost source receipt is not the pinned 1.92.0 identity.');
	}
	const version = witnessFile(join(root, 'boost/version.hpp'), witnesses).toString('utf8');
	if (!/#\s*define\s+BOOST_VERSION\s+109200\b/u.test(version)) {
		throw new Error('The Boost source tree has version drift.');
	}
	addBoostClosureWitness(root, headerClosure, witnesses, 'Boost 1.92.0 header closure');
}

function verifyToolchain(pathValue, identityValue, target, witnesses) {
	const path = existingFile(pathValue, 'toolchain receipt');
	const receipt = jsonFile(path, 'toolchain receipt');
	const row = closedRecord(receipt, [
		'schemaVersion', 'targetId', 'hostRuntime', 'executables', 'environment', 'identitySha256',
	], 'toolchain receipt');
	const body = {
		schemaVersion: row.schemaVersion, targetId: row.targetId, hostRuntime: row.hostRuntime,
		executables: row.executables, environment: row.environment,
	};
	const identitySha256 = fingerprintFramescaperOpenFxHostToolchainReceipt(body);
	if (row.schemaVersion !== 1 || row.targetId !== target.id || row.hostRuntime !== target.hostRuntime
		|| row.identitySha256 !== identitySha256 || identityValue !== identitySha256) {
		throw new Error('The provisioned OpenFX-host toolchain identity drifted.');
	}
	const executables = closedRecord(row.executables, TOOL_ROLES, 'toolchain executables');
	for (const role of TOOL_ROLES) {
		const entry = closedRecord(executables[role], ['path', 'sha256'], `toolchain executable ${role}`);
		const executable = existingFile(entry.path, `toolchain executable ${role}`);
		const bytes = witnessFile(executable, witnesses);
		if (entry.sha256 !== digest(bytes)) throw new Error(`Toolchain executable ${role} drifted.`);
		executables[role] = Object.freeze({ path: executable, sha256: entry.sha256 });
	}
	const environment = closedEnvironment(row.environment);
	witnessFile(path, witnesses);
	return Object.freeze({ identitySha256, executables: Object.freeze(executables), environment });
}

function closedEnvironment(value) {
	const environment = closedRecord(value, Object.keys(value ?? {}), 'toolchain environment');
	if (!Object.hasOwn(environment, 'PATH')) throw new Error('The toolchain environment must bind PATH.');
	const result = {};
	for (const key of Object.keys(environment).sort()) {
		if (!TOOLCHAIN_ENVIRONMENT.has(key) || typeof environment[key] !== 'string'
			|| environment[key].length === 0 || environment[key].includes('\0')) {
			throw new Error(`Toolchain environment ${key} is unsupported.`);
		}
		result[key] = environment[key];
	}
	return Object.freeze(result);
}

function sourceReceipt(root, witnesses) {
	const path = join(root, SOURCE_RECEIPT);
	witnessFile(path, witnesses);
	return jsonFile(path, `${root} source receipt`);
}

function pinnedJson(root, manifest, path, witnesses) {
	pinnedFile(root, manifest, path, witnesses);
	return jsonFile(join(root, path), path);
}

function pinnedFile(root, manifest, path, witnesses) {
	const pin = manifest.sourceFiles?.find((entry) => entry.path === path);
	if (!safeRelativePath(path) || !pin || !DIGEST.test(String(pin.sha256))) {
		throw new Error(`Local build input ${path} is not source-manifest pinned.`);
	}
	const bytes = witnessFile(join(root, path), witnesses);
	if (bytes.byteLength !== pin.byteLength || digest(bytes) !== pin.sha256) throw new Error(`Local build input ${path} drifted from its pin.`);
	return bytes;
}

function safeRelativePath(value) {
	return typeof value === 'string' && value.length > 0 && !value.includes('\\')
		&& !isAbsolute(value) && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
		&& /^[a-zA-Z0-9._+/-]+$/u.test(value);
}

function witnessFile(path, witnesses) {
	const file = existingFile(path, 'build input');
	const bytes = readFileSync(file);
	witnesses.push(Object.freeze({ path: file, sha256: digest(bytes), byteLength: bytes.byteLength }));
	return bytes;
}

function verifyWitnesses(witnesses) {
	for (const witness of witnesses) {
		if (verifySourceAuthenticationWitness(witness)) continue;
		const bytes = readFileSync(existingFile(witness.path, 'build input witness'));
		if (bytes.byteLength !== witness.byteLength || digest(bytes) !== witness.sha256) {
			throw new Error(`Build input drifted after recipe admission: ${witness.path}`);
		}
	}
}

function emptyOutputRoot(value, repositoryRoot) {
	const root = existingDirectory(value, 'output root');
	if (inside(repositoryRoot, root)) throw new Error('The native build output root must remain outside the repository.');
	if (readdirSync(root).length !== 0) throw new Error('The native build output root must be empty.');
	return root;
}

function assertSeparateRoots(roots) {
	for (const [index, root] of roots.entries()) for (const peer of roots.slice(index + 1)) {
		if (inside(root, peer) || inside(peer, root)) throw new Error('Native build source and output roots must not overlap.');
	}
}

function inside(parent, child) {
	const path = relative(parent, child);
	return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function existingDirectory(value, name) {
	if (typeof value !== 'string' || !isAbsolute(value)) throw new TypeError(`${name} must be an explicit absolute path.`);
	const path = resolve(value);
	if (realpathSync(path) !== path || lstatSync(path).isSymbolicLink() || !statSync(path).isDirectory()) {
		throw new Error(`${name} must be one canonical non-symlink directory.`);
	}
	return path;
}

function existingFile(value, name) {
	if (typeof value !== 'string' || !isAbsolute(value)) throw new TypeError(`${name} must be an absolute path.`);
	const path = resolve(value);
	if (realpathSync(path) !== path || lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) {
		throw new Error(`${name} must be one canonical non-symlink file.`);
	}
	return path;
}

function jsonFile(path, name) {
	return jsonBytes(readFileSync(path), name);
}

function jsonBytes(bytes, name) {
	let result;
	try { result = JSON.parse(bytes.toString('utf8')); }
	catch { throw new TypeError(`${name} must be valid JSON.`); }
	return closedRecord(result, Object.keys(result ?? {}), name);
}

function command(phase, executable, args, cwd, environment) {
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string' || value.includes('\0'))) {
		throw new TypeError(`Build phase ${phase} has unsafe arguments.`);
	}
	return Object.freeze({
		phase, executable, args: Object.freeze(args), cwd,
		environment: Object.freeze({ ...environment }),
	});
}

function closedRecord(value, fields, name, optional = false) {
	if (optional && value === undefined) value = {};
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| (!optional && (keys.length !== fields.length || fields.some((field) => !keys.includes(field))))) {
		throw new TypeError(`${name} has missing or unsupported fields.`);
	}
	return value;
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	return JSON.stringify(value);
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

function currentHostRuntime() {
	return `${process.platform}-${process.arch}`;
}

function parseCli(argv) {
	const values = {};
	let mode = null;
	for (let index = 0; index < argv.length; index += 1) {
		const key = argv[index];
		if (key === '--print' || key === '--run') {
			if (mode !== null) throw new TypeError('Choose exactly one recipe mode.');
			mode = key.slice(2);
			continue;
		}
		if (!key?.startsWith('--') || index + 1 >= argv.length) throw new TypeError('The OpenFX-host recipe arguments are invalid.');
		const field = key.slice(2).replaceAll(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
		if (!OPTION_FIELDS.includes(field) || Object.hasOwn(values, field)) throw new TypeError(`Unsupported recipe option ${key}.`);
		values[field] = argv[index += 1];
	}
	if (mode === null) throw new TypeError('Choose --print or --run.');
	return { values, mode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const cli = parseCli(process.argv.slice(2));
		const recipe = createFramescaperOpenFxHostBuildRecipe(cli.values);
		if (cli.mode === 'run') executeFramescaperOpenFxHostBuildRecipe(recipe);
		else process.stdout.write(`${JSON.stringify(recipe, null, '\t')}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
