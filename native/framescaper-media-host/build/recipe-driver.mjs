#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
	SHA256_DIGEST as DIGEST,
	assertSeparateRoots,
	authenticateToolchainReceipt,
	canonicalJson,
	closedRecord,
	deepFreeze,
	emptyOutputRoot,
	existingDirectory,
	fingerprintToolchainReceipt,
	jsonBytes,
	pinnedFile,
	pinnedJson,
	safeRelativePath,
	sha256 as digest,
	sourceReceipt,
	verifyWitnesses as verifyBuildRecipeWitnesses,
	witnessFile,
} from '../../common/build-recipe-security.mjs';

import {
	addBoostClosureWitness,
	addSourceTreeWitness,
	verifySourceAuthenticationWitness,
} from './source-authentication.mjs';
import {
	authenticateFramescaperMediaHostExternalSourceRoot,
	FRAMESCAPER_MEDIA_HOST_EXTERNAL_SOURCE_IDS,
	validateFramescaperMediaHostExternalSourceManifest,
} from './external-source-authentication.mjs';
import {
	createFramescaperMediaHostBuildCommands,
	FRAMESCAPER_FFMPEG_CONFIGURE_FLAGS,
	FRAMESCAPER_FFMPEG_POLICY,
	framescaperMediaHostBuildPaths,
	framescaperMediaHostLocalSourceInventory,
	verifyFramescaperFfmpegConfiguration,
} from './media-build-commands.mjs';
import { runFramescaperMediaHostRecipeCli } from './recipe-cli.mjs';
const HOST_ROOT = 'native/framescaper-media-host';
const SOURCE_DATE_EPOCH = 1786492800;
const FFMPEG_ARCHIVE_SHA256 = 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635';
const BOOST_ARCHIVE_SHA256 = '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c';
const SHARED_SOURCE_PATHS = Object.freeze([
	'native/common/build-recipe-security.mjs', 'native/common/exact_time.hpp',
	'native/common/sha256.cpp', 'native/common/sha256.hpp',
]);
const TARGETS = Object.freeze([
	Object.freeze({ id: 'linux-x64', runtime: 'linux-x64', hostRuntime: 'linux-x64', cmakePreset: 'linux-x64', toolchainFile: 'build/toolchains/linux-x64.cmake', ffmpegTarget: 'x86_64-linux-gnu', payloadName: 'framescaper-media-host' }),
	Object.freeze({ id: 'linux-arm64', runtime: 'linux-arm64', hostRuntime: 'linux-arm64', cmakePreset: 'linux-arm64', toolchainFile: 'build/toolchains/linux-arm64.cmake', ffmpegTarget: 'aarch64-linux-gnu', payloadName: 'framescaper-media-host' }),
	Object.freeze({ id: 'mac-arm64', runtime: 'darwin-arm64', hostRuntime: 'darwin-arm64', cmakePreset: 'mac-arm64', toolchainFile: 'build/toolchains/mac-arm64.cmake', ffmpegTarget: 'arm64-apple-darwin', payloadName: 'framescaper-media-host' }),
	Object.freeze({ id: 'win-x64', runtime: 'win32-x64', hostRuntime: 'win32-x64', cmakePreset: 'win-x64', toolchainFile: 'build/toolchains/win-x64.cmake', ffmpegTarget: 'x86_64-w64-mingw32', payloadName: 'framescaper-media-host.exe' }),
	Object.freeze({ id: 'win-arm64', runtime: 'win32-arm64', hostRuntime: 'win32-arm64', cmakePreset: 'win-arm64', toolchainFile: 'build/toolchains/win-arm64.cmake', ffmpegTarget: 'aarch64-windows-msvc', payloadName: 'framescaper-media-host.exe' }),
]);
const OPTION_FIELDS = Object.freeze([
	'repositoryRoot', 'targetId', 'hostRuntime', 'toolchainReceipt', 'toolchainIdentity',
	'ffmpegSourceRoot', 'boostSourceRoot', 'externalSourceRoot', 'outputRoot',
]);
const BASE_TOOL_ROLES = Object.freeze([
	'ar', 'c', 'cmake', 'cxx', 'make', 'ninja', 'pkgConfig', 'ranlib', 'shell',
]);
const TOOLCHAIN_ENVIRONMENT = new Set([
	'INCLUDE', 'LIB', 'LIBPATH', 'MACOSX_DEPLOYMENT_TARGET', 'PATH', 'SDKROOT', 'SYSTEMROOT',
]);
const RECIPES = new WeakMap();
const EXECUTED = new WeakSet();

export const FRAMESCAPER_MEDIA_HOST_BUILD_TARGETS = TARGETS;

export function fingerprintFramescaperMediaHostToolchainReceipt(value) {
	return fingerprintToolchainReceipt(value, 'media-host toolchain receipt body');
}

export function createFramescaperMediaHostBuildRecipe(value) {
	const options = closedRecord(value, OPTION_FIELDS, 'media-host build options');
	const repositoryRoot = existingDirectory(options.repositoryRoot, 'repository root');
	const hostRoot = existingDirectory(join(repositoryRoot, HOST_ROOT), 'media-host source root');
	const witnesses = [];
	const manifest = jsonBytes(
		witnessFile(join(hostRoot, 'source-manifest.json'), witnesses),
		'media-host source manifest',
	);
	assertCiGeneratedTargets(manifest);
	verifyPinnedSourceClosure(repositoryRoot, hostRoot, manifest, witnesses);
	const target = exactTarget(hostRoot, manifest, options.targetId, witnesses);
	if (options.hostRuntime !== target.hostRuntime) {
		throw new Error(`Target ${target.id} requires build host ${target.hostRuntime}.`);
	}
	const outputRoot = emptyOutputRoot(options.outputRoot, repositoryRoot);
	const ffmpegSourceRoot = existingDirectory(options.ffmpegSourceRoot, 'FFmpeg source root');
	const boostSourceRoot = existingDirectory(options.boostSourceRoot, 'Boost source root');
	const externalSourceRoot = existingDirectory(
		options.externalSourceRoot, 'media-host external-source root',
	);
	assertSeparateRoots([hostRoot, outputRoot, ffmpegSourceRoot, boostSourceRoot, externalSourceRoot]);
	const configure = pinnedJson(hostRoot, manifest, 'build/ffmpeg-9.0.1-configure.json', witnesses);
	assertFfmpegConfigure(configure, manifest);
	const externalManifest = validateFramescaperMediaHostExternalSourceManifest(pinnedJson(
		hostRoot, manifest, configure.externalSourceManifest, witnesses,
	));
	verifyFfmpegSource(ffmpegSourceRoot, manifest, witnesses);
	verifyBoostSource(boostSourceRoot, manifest, witnesses);
	const externalSourceRoots = verifyExternalSources(
		externalSourceRoot, externalManifest, witnesses,
	);
	const tools = verifyToolchain(
		options.toolchainReceipt, options.toolchainIdentity, target, witnesses,
	);
	const paths = framescaperMediaHostBuildPaths(outputRoot);
	const environment = exactEnvironment(tools.environment, manifest.sourceDateEpoch, configure.environment);
	const commands = createFramescaperMediaHostBuildCommands({
		target, hostRoot, ffmpegSourceRoot, boostSourceRoot, externalSourceRoots,
		paths, tools, environment,
		configureFlags: configure.configureFlags,
	});
	const recipe = deepFreeze({
		schemaVersion: 1,
		kind: 'framescaper-media-host-build',
		target: { id: target.id, runtime: target.runtime, hostRuntime: target.hostRuntime },
		toolchainIdentity: tools.identitySha256,
		outputRoot,
		payloadManifestMutation: false,
		commands,
	});
	RECIPES.set(recipe, Object.freeze({
		hostRuntime: target.hostRuntime,
		outputRoot,
		paths,
		zlibSourceRoot: externalSourceRoots.zlib,
		externalManifest,
		witnesses: Object.freeze(witnesses),
	}));
	return recipe;
}

export function executeFramescaperMediaHostBuildRecipe(
	recipe,
	options = {},
) {
	const state = RECIPES.get(recipe);
	if (!state || EXECUTED.has(recipe)) {
		throw new TypeError('Only one fresh authentic media-host build recipe may execute.');
	}
	const fields = closedRecord(
		options, ['run', 'verifyFfmpegConfiguration'], 'media-host execution options', true,
	);
	if (currentHostRuntime() !== state.hostRuntime) throw new Error(`Build host drifted from ${state.hostRuntime}.`);
	const run = fields.run ?? spawnSync;
	const verifyConfiguration = fields.verifyFfmpegConfiguration
		?? verifyFramescaperFfmpegConfiguration;
	if (typeof run !== 'function') throw new TypeError('The media-host command runner must be callable.');
	if (typeof verifyConfiguration !== 'function') {
		throw new TypeError('The FFmpeg configuration verifier must be callable.');
	}
	verifyWitnesses(state.witnesses);
	existingDirectory(state.outputRoot, 'output root');
	if (readdirSync(state.outputRoot).length !== 0) throw new Error('The explicit output root is no longer empty.');
	EXECUTED.add(recipe);
	for (const path of [
		'x264-build', 'x264-install', 'x265-build', 'x265-install',
		'libvpx-build', 'libvpx-install', 'libopus-build', 'libopus-install',
		'zlib-build', 'zlib-install', 'ffmpeg-build', 'ffmpeg-install',
		'host-build', 'host-install',
	]) {
		mkdirSync(join(state.outputRoot, path), { mode: 0o700 });
	}
	cpSync(state.zlibSourceRoot, state.paths.zlibSource, {
		recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
	});
	authenticateFramescaperMediaHostExternalSourceRoot(
		state.externalManifest, 'zlib', state.paths.zlibSource,
	);
	for (const command of recipe.commands) {
		verifyWitnesses(state.witnesses);
		const result = run(command.executable, [...command.args], {
			cwd: command.cwd, env: { ...command.environment }, stdio: 'inherit', windowsHide: true,
		});
		if (!result || result.status !== 0) {
			throw new Error(`Media-host ${command.phase} failed with status ${String(result?.status)}.`);
		}
		if (command.phase === 'ffmpeg-configure') verifyConfiguration(state.paths.ffmpegBuild);
	}
}

function exactTarget(hostRoot, manifest, value, witnesses) {
	const targets = pinnedJson(hostRoot, manifest, 'build/targets.json', witnesses);
	if (targets.schemaVersion !== 1 || canonicalJson(targets.targets) !== canonicalJson(TARGETS)) {
		throw new Error('The media-host five-target identity drifted.');
	}
	const target = TARGETS.find(({ id }) => id === value);
	if (!target) throw new RangeError('The media-host target is unsupported.');
	const preset = pinnedJson(hostRoot, manifest, 'CMakePresets.json', witnesses);
	if (canonicalJson(preset) !== canonicalJson(expectedCmakePresets())) {
		throw new Error('The media-host CMake presets drifted from their closed five-target contract.');
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
		name: target.cmakePreset, inherits: 'base',
		...(target.id.startsWith('win-') ? { generator: 'Ninja Multi-Config' } : {}),
		toolchainFile: target.toolchainFile,
	}))];
	const buildPresets = TARGETS.map((target) => ({
		name: target.cmakePreset, configurePreset: target.cmakePreset,
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
		'win-arm64': 'set(CMAKE_SYSTEM_NAME Windows)\nset(CMAKE_SYSTEM_PROCESSOR ARM64)',
	}[targetId];
	return `# SPDX-License-Identifier: AGPL-3.0-only\n${platform}\nset(CMAKE_TRY_COMPILE_PLATFORM_VARIABLES FRAMESCAPER_C_COMPILER FRAMESCAPER_CXX_COMPILER)\nif(NOT IS_ABSOLUTE "\${FRAMESCAPER_C_COMPILER}" OR NOT IS_ABSOLUTE "\${FRAMESCAPER_CXX_COMPILER}")\n\tmessage(FATAL_ERROR "The recipe must supply absolute authenticated C and C++ compilers")\nendif()\nset(CMAKE_C_COMPILER "\${FRAMESCAPER_C_COMPILER}" CACHE FILEPATH "" FORCE)\nset(CMAKE_CXX_COMPILER "\${FRAMESCAPER_CXX_COMPILER}" CACHE FILEPATH "" FORCE)\n`;
}

function assertCiGeneratedTargets(manifest) {
	closedRecord(manifest, [
		'schemaVersion', 'hostVersion', 'helperContractVersion', 'license', 'sourceDateEpoch',
		'ffmpeg', 'boost', 'sharedSourceFiles', 'sourceFiles', 'targets',
	], 'media-host source manifest');
	closedRecord(manifest.ffmpeg, [
		'version', 'releaseName', 'released', 'url', 'byteLength', 'sha256', 'extractedTree',
		'configureRecipe', 'licenceMode',
	], 'media-host FFmpeg pin');
	closedRecord(manifest.boost, [
		'version', 'sourceManifest', 'archiveSha256', 'headerClosure',
	], 'media-host Boost pin');
	closedRecord(manifest.boost.headerClosure, [
		'algorithm', 'roots', 'fileCount', 'sha256',
	], 'media-host Boost header closure');
	closedRecord(manifest.targets, TARGETS.map(({ id }) => id), 'media-host target states');
	if (manifest.schemaVersion !== 1 || manifest.hostVersion !== '1.0.0'
		|| manifest.helperContractVersion !== 1 || manifest.license !== 'AGPL-3.0-only'
		|| manifest.sourceDateEpoch !== SOURCE_DATE_EPOCH
		|| manifest.ffmpeg.version !== '9.0.1' || manifest.ffmpeg.sha256 !== FFMPEG_ARCHIVE_SHA256
		|| manifest.ffmpeg.configureRecipe !== 'build/ffmpeg-9.0.1-configure.json'
		|| manifest.ffmpeg.licenceMode !== 'GPL-2.0-or-later'
		|| manifest.boost.version !== '1.92.0'
		|| manifest.boost.archiveSha256 !== BOOST_ARCHIVE_SHA256
		|| manifest.boost.headerClosure.algorithm !== 'boost-include-closure-sha256-v1'
		|| canonicalJson(manifest.boost.headerClosure.roots) !== canonicalJson(['boost/multiprecision/cpp_int.hpp'])) {
		throw new Error('The media-host pinned source manifest is unsupported.');
	}
	for (const target of TARGETS) {
		const state = manifest.targets[target.id];
		closedRecord(state, [
			'runtime', 'status', 'blockedBy', 'toolchainIdentity', 'buildResult', 'payload',
			'isolationPayload',
		], `media-host ${target.id} target state`);
		if (state?.status !== 'ci-generated' || state.toolchainIdentity !== null
			|| state.buildResult !== null || state.blockedBy !== null
			|| state.payload !== null || state.isolationPayload !== null
			|| state.runtime !== target.runtime) {
			throw new Error(`Target ${target.id} must remain CI-generated with no payload claim.`);
		}
	}
}

function assertFfmpegConfigure(recipe, manifest) {
	closedRecord(recipe, [
		'schemaVersion', 'sourceVersion', 'sourceDateEpoch', 'externalSourceManifest',
		'environment', 'configureFlags', 'policy',
	], 'pinned FFmpeg configure recipe');
	closedRecord(recipe.environment, ['TZ', 'LC_ALL', 'ARFLAGS', 'ZERO_AR_DATE'], 'FFmpeg environment');
	closedRecord(recipe.policy, Object.keys(FRAMESCAPER_FFMPEG_POLICY), 'FFmpeg component policy');
	if (recipe.schemaVersion !== 1 || recipe.sourceVersion !== manifest.ffmpeg.version
		|| recipe.sourceDateEpoch !== manifest.sourceDateEpoch
		|| recipe.externalSourceManifest !== 'build/ffmpeg-9.0.1-external-sources.json'
		|| canonicalJson(recipe.configureFlags) !== canonicalJson(FRAMESCAPER_FFMPEG_CONFIGURE_FLAGS)
		|| canonicalJson(recipe.policy) !== canonicalJson(FRAMESCAPER_FFMPEG_POLICY)) {
		throw new Error('The pinned FFmpeg configure recipe is not closed.');
	}
	for (const argument of recipe.configureFlags) {
		if (typeof argument !== 'string' || !/^--[a-z0-9-]+(?:=[a-z0-9._+-]+)?$/u.test(argument)) {
			throw new Error('The pinned FFmpeg configure recipe contains an unsafe argument.');
		}
	}
}

function verifyPinnedSourceClosure(repositoryRoot, root, manifest, witnesses) {
	if (!Array.isArray(manifest.sourceFiles) || manifest.sourceFiles.length === 0) {
		throw new Error('The media-host source manifest has no closed source-file inventory.');
	}
	const paths = [];
	for (const value of manifest.sourceFiles) {
		const entry = closedRecord(value, ['path', 'byteLength', 'sha256'], 'media-host source pin');
		if (!safeRelativePath(entry.path) || !Number.isSafeInteger(entry.byteLength)
			|| entry.byteLength < 0 || !DIGEST.test(String(entry.sha256)) || paths.includes(entry.path)) {
			throw new Error('The media-host source-file inventory is not canonical.');
		}
		paths.push(entry.path);
		pinnedFile(root, manifest, entry.path, witnesses);
	}
	if (canonicalJson(paths) !== canonicalJson([...paths].sort())) {
		throw new Error('The media-host source-file inventory must be path sorted.');
	}
	const actual = framescaperMediaHostLocalSourceInventory(root);
	if (canonicalJson(actual) !== canonicalJson(paths)) {
		throw new Error('The media-host source-file inventory omits or invents a local build input.');
	}
	for (const required of [
		'CMakeLists.txt', 'CMakePresets.json', 'build/ffmpeg-9.0.1-configure.json',
		'build/external-source-authentication.mjs', 'build/ffmpeg-9.0.1-external-sources.json',
		'build/media-build-commands.mjs', 'build/recipe-driver.mjs',
		'build/source-authentication.mjs', 'build/targets.json', 'build/windows-vpx.pc',
		...TARGETS.map(({ toolchainFile }) => toolchainFile),
	]) if (!paths.includes(required)) throw new Error(`Required build input ${required} is not pinned.`);
	verifySharedSourceClosure(repositoryRoot, manifest.sharedSourceFiles, witnesses);
	const cmake = pinnedFile(root, manifest, 'CMakeLists.txt', witnesses).toString('utf8');
	if (!cmake.includes('set(SCAPE_NATIVE_COMMON_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../common")')
		|| !cmake.includes('${SCAPE_NATIVE_COMMON_ROOT}/sha256.cpp')) {
		throw new Error('The media-host build does not bind the authenticated native-common SHA-256 core.');
	}
}

function verifySharedSourceClosure(repositoryRoot, values, witnesses) {
	if (!Array.isArray(values) || values.length !== SHARED_SOURCE_PATHS.length) {
		throw new Error('The media-host shared source-file inventory is incomplete.');
	}
	for (const [index, value] of values.entries()) {
		const entry = closedRecord(value, ['path', 'byteLength', 'sha256'], 'shared source pin');
		if (entry.path !== SHARED_SOURCE_PATHS[index]
			|| !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0
			|| !DIGEST.test(String(entry.sha256))) {
			throw new Error('The media-host shared source-file inventory is not canonical.');
		}
		const bytes = witnessFile(join(repositoryRoot, entry.path), witnesses);
		if (bytes.byteLength !== entry.byteLength || digest(bytes) !== entry.sha256) {
			throw new Error(`Shared build input ${entry.path} drifted from its pin.`);
		}
	}
}

function verifyFfmpegSource(root, manifest, witnesses) {
	const receipt = sourceReceipt(root, witnesses);
	const expected = {
		schemaVersion: 1, component: 'ffmpeg', version: '9.0.1',
		archiveSha256: manifest.ffmpeg.sha256,
		extractedTreeSha256: manifest.ffmpeg.extractedTree.sha256, root,
	};
	if (canonicalJson(receipt) !== canonicalJson(expected)) throw new Error('The FFmpeg source receipt is not the pinned 9.0.1 identity.');
	addSourceTreeWitness(root, manifest.ffmpeg.extractedTree, witnesses, 'FFmpeg extracted source tree');
	const configure = witnessFile(join(root, 'configure'), witnesses).toString('utf8');
	if (!configure.startsWith('#!/bin/sh\n')) throw new Error('The provisioned FFmpeg configure entrypoint is unusable.');
	const release = witnessFile(join(root, 'RELEASE'), witnesses).toString('utf8').trim();
	if (release !== '9.0.1') throw new Error('The provisioned FFmpeg source tree has version drift.');
}

function verifyBoostSource(root, manifest, witnesses) {
	const receipt = sourceReceipt(root, witnesses);
	const expected = {
		schemaVersion: 1, component: 'boost', version: '1.92.0',
		archiveSha256: manifest.boost.archiveSha256,
		headerClosureSha256: manifest.boost.headerClosure.sha256, root,
	};
	if (canonicalJson(receipt) !== canonicalJson(expected)) throw new Error('The Boost source receipt is not the pinned 1.92.0 identity.');
	const version = witnessFile(join(root, 'boost/version.hpp'), witnesses).toString('utf8');
	if (!/#\s*define\s+BOOST_VERSION\s+109200\b/u.test(version)) throw new Error('The Boost source tree has version drift.');
	addBoostClosureWitness(root, manifest.boost.headerClosure, witnesses, 'Boost 1.92.0 header closure');
}

function verifyExternalSources(root, manifest, witnesses) {
	const entries = readdirSync(root, { withFileTypes: true });
	if (canonicalJson(entries.map(({ name }) => name).sort())
		!== canonicalJson([...FRAMESCAPER_MEDIA_HOST_EXTERNAL_SOURCE_IDS].sort())
		|| entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
		throw new Error('The media-host external-source root must contain exactly five source trees.');
	}
	const result = {};
	for (const id of FRAMESCAPER_MEDIA_HOST_EXTERNAL_SOURCE_IDS) {
		const sourceRoot = existingDirectory(join(root, id), `${id} source root`);
		const row = manifest.libraries.find((entry) => entry.id === id);
		const receipt = sourceReceipt(sourceRoot, witnesses);
		const expected = {
			schemaVersion: 1, component: id, version: row.version, revision: row.revision,
			archiveSha256: row.sha256, extractedTreeSha256: row.extractedTree.sha256,
			root: sourceRoot,
		};
		if (canonicalJson(receipt) !== canonicalJson(expected)) {
			throw new Error(`The ${id} source receipt is not the pinned identity.`);
		}
		authenticateFramescaperMediaHostExternalSourceRoot(manifest, id, sourceRoot);
		addSourceTreeWitness(sourceRoot, row.extractedTree, witnesses, `${id} extracted source tree`);
		result[id] = sourceRoot;
	}
	return Object.freeze(result);
}

function verifyToolchain(pathValue, identityValue, target, witnesses) {
	return authenticateToolchainReceipt({
		pathValue,
		identityValue,
		target,
		roles: toolRoles(target.id),
		allowedEnvironment: TOOLCHAIN_ENVIRONMENT,
		witnesses,
		receiptBodyName: 'media-host toolchain receipt body',
		identityError: 'The provisioned media-host toolchain identity drifted.',
	});
}

function toolRoles(targetId) {
	return targetId.startsWith('win-')
		? Object.freeze([...BASE_TOOL_ROLES, 'msbuild', 'rc'])
		: BASE_TOOL_ROLES;
}

function exactEnvironment(toolchain, sourceDateEpoch, ffmpeg) {
	if (ffmpeg.TZ !== 'UTC' || ffmpeg.LC_ALL !== 'C' || ffmpeg.ARFLAGS !== 'rcD'
		|| ffmpeg.ZERO_AR_DATE !== '1') throw new Error('The FFmpeg reproducibility environment drifted.');
	return Object.freeze({ ...toolchain, SOURCE_DATE_EPOCH: String(sourceDateEpoch), ...ffmpeg });
}

function verifyWitnesses(witnesses) {
	verifyBuildRecipeWitnesses(witnesses, verifySourceAuthenticationWitness);
}

function currentHostRuntime() {
	return `${process.platform}-${process.arch}`;
}

runFramescaperMediaHostRecipeCli({
	moduleUrl: import.meta.url,
	optionFields: OPTION_FIELDS,
	createRecipe: createFramescaperMediaHostBuildRecipe,
	executeRecipe: executeFramescaperMediaHostBuildRecipe,
});
