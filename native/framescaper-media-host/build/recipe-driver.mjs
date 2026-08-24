#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	addBoostClosureWitness,
	addSourceTreeWitness,
	verifySourceAuthenticationWitness,
} from './source-authentication.mjs';
import {
	validateFramescaperMediaHostExternalSourceManifest,
} from './external-source-authentication.mjs';

const HOST_ROOT = 'native/framescaper-media-host';
const SOURCE_RECEIPT = '.framescaper-source-identity.json';
const DIGEST = /^[a-f0-9]{64}$/u;
const SOURCE_DATE_EPOCH = 1786492800;
const FFMPEG_ARCHIVE_SHA256 = 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635';
const BOOST_ARCHIVE_SHA256 = '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c';
const TARGETS = Object.freeze([
	Object.freeze({ id: 'linux-x64', runtime: 'linux-x64', hostRuntime: 'linux-x64', cmakePreset: 'linux-x64', toolchainFile: 'build/toolchains/linux-x64.cmake', ffmpegTarget: 'x86_64-linux-gnu', payloadName: 'framescaper-media-host' }),
	Object.freeze({ id: 'linux-arm64', runtime: 'linux-arm64', hostRuntime: 'linux-arm64', cmakePreset: 'linux-arm64', toolchainFile: 'build/toolchains/linux-arm64.cmake', ffmpegTarget: 'aarch64-linux-gnu', payloadName: 'framescaper-media-host' }),
	Object.freeze({ id: 'mac-arm64', runtime: 'darwin-arm64', hostRuntime: 'darwin-arm64', cmakePreset: 'mac-arm64', toolchainFile: 'build/toolchains/mac-arm64.cmake', ffmpegTarget: 'arm64-apple-darwin', payloadName: 'framescaper-media-host' }),
	Object.freeze({ id: 'win-x64', runtime: 'win32-x64', hostRuntime: 'win32-x64', cmakePreset: 'win-x64', toolchainFile: 'build/toolchains/win-x64.cmake', ffmpegTarget: 'x86_64-w64-mingw32', payloadName: 'framescaper-media-host.exe' }),
	Object.freeze({ id: 'win-arm64', runtime: 'win32-arm64', hostRuntime: 'win32-arm64', cmakePreset: 'win-arm64', toolchainFile: 'build/toolchains/win-arm64.cmake', ffmpegTarget: 'arm64ec-windows-msvc', payloadName: 'framescaper-media-host.exe' }),
]);
const OPTION_FIELDS = Object.freeze([
	'repositoryRoot', 'targetId', 'hostRuntime', 'toolchainReceipt', 'toolchainIdentity',
	'ffmpegSourceRoot', 'boostSourceRoot', 'outputRoot',
]);
const TOOL_ROLES = Object.freeze([
	'ar', 'c', 'cmake', 'cxx', 'make', 'ninja', 'pkgConfig', 'ranlib', 'shell',
]);
const TOOLCHAIN_ENVIRONMENT = new Set([
	'INCLUDE', 'LIB', 'LIBPATH', 'MACOSX_DEPLOYMENT_TARGET', 'PATH', 'SDKROOT', 'SYSTEMROOT',
]);
const FFMPEG_CONFIGURE_FLAGS = Object.freeze([
	'--disable-everything', '--disable-autodetect', '--disable-doc', '--disable-debug',
	'--disable-programs', '--disable-shared', '--disable-network', '--enable-static',
	'--enable-pic', '--enable-gpl', '--enable-avcodec', '--enable-avfilter',
	'--enable-avformat', '--enable-swresample', '--enable-swscale',
	'--enable-decoder=prores', '--enable-decoder=pcm_f32le',
	'--enable-encoder=prores_ks', '--enable-encoder=pcm_s16le',
	'--enable-demuxer=mov', '--enable-demuxer=wav',
	'--enable-muxer=mov', '--enable-protocol=file', '--enable-protocol=pipe',
]);
const FFMPEG_POLICY = Object.freeze({
	rawFfmpegArguments: false,
	network: false,
	externalLibraries: Object.freeze([]),
	enabledDecoders: Object.freeze(['prores', 'pcm_f32le']),
	enabledEncoders: Object.freeze(['prores_ks', 'pcm_s16le']),
	enabledDemuxers: Object.freeze(['mov', 'wav']),
	enabledMuxers: Object.freeze(['mov']),
	enabledProtocols: Object.freeze(['file', 'pipe']),
	blockedComponents: Object.freeze([
		'av1', 'exr', 'h264', 'hevc', 'libvpx-vp9', 'libx264', 'png', 'tiff', 'vp9',
	]),
	payloadPublicationRequiresLicensingAndTargetEvidence: true,
});
const RECIPES = new WeakMap();
const EXECUTED = new WeakSet();

export const FRAMESCAPER_MEDIA_HOST_BUILD_TARGETS = TARGETS;

export function fingerprintFramescaperMediaHostToolchainReceipt(value) {
	const receipt = closedRecord(value, [
		'schemaVersion', 'targetId', 'hostRuntime', 'executables', 'environment',
	], 'media-host toolchain receipt body');
	return digest(Buffer.from(canonicalJson(receipt)));
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
	assertPendingTargets(manifest);
	verifyPinnedSourceClosure(hostRoot, manifest, witnesses);
	const target = exactTarget(hostRoot, manifest, options.targetId, witnesses);
	if (options.hostRuntime !== target.hostRuntime) {
		throw new Error(`Target ${target.id} requires build host ${target.hostRuntime}.`);
	}
	const outputRoot = emptyOutputRoot(options.outputRoot, repositoryRoot);
	const ffmpegSourceRoot = existingDirectory(options.ffmpegSourceRoot, 'FFmpeg source root');
	const boostSourceRoot = existingDirectory(options.boostSourceRoot, 'Boost source root');
	assertSeparateRoots([hostRoot, outputRoot, ffmpegSourceRoot, boostSourceRoot]);
	const configure = pinnedJson(hostRoot, manifest, 'build/ffmpeg-9.0.1-configure.json', witnesses);
	assertFfmpegConfigure(configure, manifest);
	validateFramescaperMediaHostExternalSourceManifest(pinnedJson(
		hostRoot, manifest, configure.externalSourceManifest, witnesses,
	));
	verifyFfmpegSource(ffmpegSourceRoot, manifest, witnesses);
	verifyBoostSource(boostSourceRoot, manifest, witnesses);
	const tools = verifyToolchain(
		options.toolchainReceipt, options.toolchainIdentity, target, witnesses,
	);
	const paths = Object.freeze({
		ffmpegBuild: join(outputRoot, 'ffmpeg-build'),
		ffmpegInstall: join(outputRoot, 'ffmpeg-install'),
		hostBuild: join(outputRoot, 'host-build'),
		hostInstall: join(outputRoot, 'host-install'),
	});
	const environment = exactEnvironment(tools.environment, manifest.sourceDateEpoch, configure.environment);
	const commands = mediaCommands({
		target, hostRoot, ffmpegSourceRoot, boostSourceRoot, paths, tools, environment,
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
	const fields = closedRecord(options, ['run'], 'media-host execution options', true);
	if (currentHostRuntime() !== state.hostRuntime) throw new Error(`Build host drifted from ${state.hostRuntime}.`);
	const run = fields.run ?? spawnSync;
	if (typeof run !== 'function') throw new TypeError('The media-host command runner must be callable.');
	verifyWitnesses(state.witnesses);
	if (readdirSync(state.outputRoot).length !== 0) throw new Error('The explicit output root is no longer empty.');
	EXECUTED.add(recipe);
	for (const path of ['ffmpeg-build', 'ffmpeg-install', 'host-build', 'host-install']) {
		mkdirSync(join(state.outputRoot, path), { mode: 0o700 });
	}
	for (const command of recipe.commands) {
		verifyWitnesses(state.witnesses);
		const result = run(command.executable, [...command.args], {
			cwd: command.cwd, env: { ...command.environment }, stdio: 'inherit', windowsHide: true,
		});
		if (!result || result.status !== 0) {
			throw new Error(`Media-host ${command.phase} failed with status ${String(result?.status)}.`);
		}
	}
}

function mediaCommands(input) {
	const { target, hostRoot, ffmpegSourceRoot, boostSourceRoot, paths, tools, environment } = input;
	const ffmpegArguments = [
		join(ffmpegSourceRoot, 'configure'),
		...input.configureFlags,
		`--prefix=${paths.ffmpegInstall}`,
		...ffmpegTargetArguments(target),
		`--cc=${tools.executables.c.path}`,
		`--cxx=${tools.executables.cxx.path}`,
		`--ar=${tools.executables.ar.path}`,
		`--ranlib=${tools.executables.ranlib.path}`,
	];
	const cmakeArguments = [
		'--preset', target.cmakePreset, '-S', hostRoot, '-B', paths.hostBuild, '--fresh',
		`-DCMAKE_MAKE_PROGRAM=${tools.executables.ninja.path}`,
		`-DFRAMESCAPER_C_COMPILER=${tools.executables.c.path}`,
		`-DFRAMESCAPER_CXX_COMPILER=${tools.executables.cxx.path}`,
		`-DCMAKE_INSTALL_PREFIX=${paths.hostInstall}`,
		`-DBOOST_ROOT=${boostSourceRoot}`, '-DBoost_NO_SYSTEM_PATHS=ON',
		`-DPKG_CONFIG_EXECUTABLE=${tools.executables.pkgConfig.path}`,
		`-DCMAKE_PREFIX_PATH=${paths.ffmpegInstall}`,
	];
	const hostEnvironment = Object.freeze({
		...environment,
		PKG_CONFIG_PATH: join(paths.ffmpegInstall, 'lib', 'pkgconfig'),
	});
	return Object.freeze([
		command('ffmpeg-configure', tools.executables.shell.path, ffmpegArguments, paths.ffmpegBuild, environment),
		command('ffmpeg-build', tools.executables.make.path, ['-C', paths.ffmpegBuild, '-j1'], paths.ffmpegBuild, environment),
		command('ffmpeg-install', tools.executables.make.path, ['-C', paths.ffmpegBuild, 'install'], paths.ffmpegBuild, environment),
		command('host-configure', tools.executables.cmake.path, cmakeArguments, hostRoot, hostEnvironment),
		command('host-build', tools.executables.cmake.path, ['--build', paths.hostBuild, '--config', 'Release', '--target', 'framescaper-media-host', '--parallel', '1'], hostRoot, hostEnvironment),
		command('host-install', tools.executables.cmake.path, ['--install', paths.hostBuild, '--config', 'Release', '--prefix', paths.hostInstall], hostRoot, hostEnvironment),
	]);
}

function ffmpegTargetArguments(target) {
	if (target.id === 'linux-x64') return ['--target-os=linux', '--arch=x86_64'];
	if (target.id === 'linux-arm64') return ['--target-os=linux', '--arch=aarch64', '--enable-cross-compile'];
	if (target.id === 'mac-arm64') return ['--target-os=darwin', '--arch=arm64'];
	if (target.id === 'win-x64') return ['--target-os=win64', '--arch=x86_64', '--toolchain=msvc'];
	return [
		'--target-os=win64', '--arch=arm64', '--toolchain=msvc',
		'--extra-cflags=/arm64EC', '--extra-ldflags=/machine:arm64EC',
	];
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
		'win-arm64': 'set(CMAKE_SYSTEM_NAME Windows)\nset(CMAKE_SYSTEM_PROCESSOR ARM64EC)',
	}[targetId];
	return `# SPDX-License-Identifier: AGPL-3.0-only\n${platform}\nif(NOT IS_ABSOLUTE "\${FRAMESCAPER_C_COMPILER}" OR NOT IS_ABSOLUTE "\${FRAMESCAPER_CXX_COMPILER}")\n\tmessage(FATAL_ERROR "The recipe must supply absolute authenticated C and C++ compilers")\nendif()\nset(CMAKE_C_COMPILER "\${FRAMESCAPER_C_COMPILER}" CACHE FILEPATH "" FORCE)\nset(CMAKE_CXX_COMPILER "\${FRAMESCAPER_CXX_COMPILER}" CACHE FILEPATH "" FORCE)\n`;
}

function assertPendingTargets(manifest) {
	closedRecord(manifest, [
		'schemaVersion', 'hostVersion', 'helperContractVersion', 'license', 'sourceDateEpoch',
		'ffmpeg', 'boost', 'sourceFiles', 'targets',
	], 'media-host source manifest');
	closedRecord(manifest.ffmpeg, [
		'version', 'releaseName', 'released', 'url', 'signatureUrl', 'signingKeyFingerprint',
		'byteLength', 'sha256', 'extractedTree', 'configureRecipe', 'licenceMode',
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
			'runtime', 'status', 'blockedBy', 'toolchainIdentity', 'payload',
			'isolationPayload', 'productionReadiness',
		], `media-host ${target.id} target state`);
		if (state?.status !== 'pending-external' || state.toolchainIdentity !== null
			|| state.payload !== null || state.isolationPayload !== null
			|| state.productionReadiness !== null || state.runtime !== target.runtime
			|| typeof state.blockedBy !== 'string' || state.blockedBy.length === 0) {
			throw new Error(`Target ${target.id} must remain pending-external with no payload claim.`);
		}
	}
}

function assertFfmpegConfigure(recipe, manifest) {
	closedRecord(recipe, [
		'schemaVersion', 'sourceVersion', 'sourceDateEpoch', 'externalSourceManifest',
		'environment', 'configureFlags', 'policy',
	], 'pinned FFmpeg configure recipe');
	closedRecord(recipe.environment, ['TZ', 'LC_ALL', 'ARFLAGS', 'ZERO_AR_DATE'], 'FFmpeg environment');
	closedRecord(recipe.policy, Object.keys(FFMPEG_POLICY), 'FFmpeg component policy');
	if (recipe.schemaVersion !== 1 || recipe.sourceVersion !== manifest.ffmpeg.version
		|| recipe.sourceDateEpoch !== manifest.sourceDateEpoch
		|| recipe.externalSourceManifest !== 'build/ffmpeg-9.0.1-external-sources.json'
		|| canonicalJson(recipe.configureFlags) !== canonicalJson(FFMPEG_CONFIGURE_FLAGS)
		|| canonicalJson(recipe.policy) !== canonicalJson(FFMPEG_POLICY)) {
		throw new Error('The pinned FFmpeg configure recipe is not closed.');
	}
	for (const argument of recipe.configureFlags) {
		if (typeof argument !== 'string' || !/^--[a-z0-9-]+(?:=[a-z0-9._+-]+)?$/u.test(argument)) {
			throw new Error('The pinned FFmpeg configure recipe contains an unsafe argument.');
		}
	}
}

function verifyPinnedSourceClosure(root, manifest, witnesses) {
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
	for (const required of [
		'CMakeLists.txt', 'CMakePresets.json', 'build/ffmpeg-9.0.1-configure.json',
		'build/external-source-authentication.mjs', 'build/ffmpeg-9.0.1-external-sources.json',
		'build/recipe-driver.mjs', 'build/targets.json',
		...TARGETS.map(({ toolchainFile }) => toolchainFile),
	]) if (!paths.includes(required)) throw new Error(`Required build input ${required} is not pinned.`);
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
	const identitySha256 = fingerprintFramescaperMediaHostToolchainReceipt(body);
	if (row.schemaVersion !== 1 || row.targetId !== target.id || row.hostRuntime !== target.hostRuntime
		|| row.identitySha256 !== identitySha256 || identityValue !== identitySha256) {
		throw new Error('The provisioned media-host toolchain identity drifted.');
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

function exactEnvironment(toolchain, sourceDateEpoch, ffmpeg) {
	if (ffmpeg.TZ !== 'UTC' || ffmpeg.LC_ALL !== 'C' || ffmpeg.ARFLAGS !== 'rcD'
		|| ffmpeg.ZERO_AR_DATE !== '1') throw new Error('The FFmpeg reproducibility environment drifted.');
	return Object.freeze({ ...toolchain, SOURCE_DATE_EPOCH: String(sourceDateEpoch), ...ffmpeg });
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
		if (!key?.startsWith('--') || index + 1 >= argv.length) throw new TypeError('The media-host recipe arguments are invalid.');
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
		const recipe = createFramescaperMediaHostBuildRecipe(cli.values);
		if (cli.mode === 'run') executeFramescaperMediaHostBuildRecipe(recipe);
		else process.stdout.write(`${JSON.stringify(recipe, null, '\t')}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
