/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
	boostClosureIncludeArguments,
	exactRetimeClosureAvailable,
} from './framescaper-boost-closure.js';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const sources = join(repositoryRoot, 'native/framescaper-openfx-host/src');
const fixture = join(repositoryRoot, 'native/framescaper-openfx-host/fixtures/conformance_plugin.cpp');
let retainedBuild;
let retainedCleanup = () => undefined;

export function expectedOpenFxNativeScannerDescriptor(binarySha256) {
	const types = [
		'integer', 'integer2d', 'integer3d', 'double', 'double2d', 'double3d',
		'rgb', 'rgba', 'boolean', 'choice', 'string', 'group', 'page',
		'pushbutton', 'parametric', 'custom',
	];
	const parameters = [
		{ name: 'cancelIterations', type: 'integer', animates: true },
		{ name: 'copyDouble', type: 'double', animates: true },
		...types.map((type, index) => ({
			name: `parameter${String(index)}`, type, animates: true,
		})),
		{ name: 'speed', type: 'double', animates: true },
	].sort((left, right) => left.name.localeCompare(right.name));
	return {
		pluginId: 'org.framescaper.conformance', vendor: null,
		version: { major: 1, minor: 5 }, bundleIdentity: `single-file-sha256:${binarySha256}`,
		binarySha256,
		architectureDirectory: process.platform === 'linux'
			? (process.arch === 'arm64' ? 'Linux-aarch64' : 'Linux-x86-64')
			: process.platform === 'darwin' ? 'MacOS'
				: process.arch === 'arm64' ? 'Win-arm64ec' : 'Win64',
		supportedContexts: ['generator', 'filter', 'transition', 'paint', 'retimer', 'general'],
		parameters, components: ['RGBA', 'RGB', 'Alpha'],
		pixelDepths: ['byte', 'short', 'float'], threading: 'fully-safe',
		renderBackends: ['cpu', 'opengl', 'opencl', 'cuda', 'metal'],
		requestedSuites: [
			'OfxDialogSuite', 'OfxDrawSuite', 'OfxImageEffectOpenGLRenderSuite',
			'OfxImageEffectSuite',
			'OfxInteractSuite', 'OfxMemorySuite', 'OfxMessageSuite',
			'OfxMultiThreadSuite', 'OfxOpenCLProgramSuite', 'OfxParameterSuite',
			'OfxParametricParameterSuite', 'OfxProgressSuite',
			'OfxPropertySuite', 'OfxTimeLineSuite',
		],
	};
}

export function cleanupOpenFxNativeContractFixture() { retainedCleanup(); }

export function buildOpenFxNativeContractFixture(context) {
	if (retainedBuild !== undefined) {
		if (retainedBuild === null) context.skip('A C++ compiler is not installed on this source-audit host.');
		return retainedBuild;
	}
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		retainedBuild = null;
		return null;
	}
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-openfx-runtime-'));
	const extension = process.platform === 'darwin' ? '.dylib'
		: process.platform === 'win32' ? '.dll' : '.so';
	const plugin = join(directory, `conformance${extension}`);
	const mismatchPlugin = join(directory, `context-mismatch${extension}`);
	const spoofPlugin = join(directory, `standard-parameter-spoof${extension}`);
	const mediaDeclarationPlugins = new Map([
		['unknown-pixel-depth', 'FRAMESCAPER_OPENFX_UNKNOWN_PIXEL_DEPTH_FIXTURE'],
		['unknown-component', 'FRAMESCAPER_OPENFX_UNKNOWN_COMPONENT_FIXTURE'],
		['duplicate-pixel-depth', 'FRAMESCAPER_OPENFX_DUPLICATE_PIXEL_DEPTH_FIXTURE'],
		['duplicate-component', 'FRAMESCAPER_OPENFX_DUPLICATE_COMPONENT_FIXTURE'],
		['missing-pixel-depth', 'FRAMESCAPER_OPENFX_MISSING_PIXEL_DEPTH_FIXTURE'],
		['missing-component', 'FRAMESCAPER_OPENFX_MISSING_COMPONENT_FIXTURE'],
		['inconsistent-pixel-depth', 'FRAMESCAPER_OPENFX_INCONSISTENT_PIXEL_DEPTH_FIXTURE'],
		['inconsistent-component', 'FRAMESCAPER_OPENFX_INCONSISTENT_COMPONENT_FIXTURE'],
		['no-byte-pixel-depth', 'FRAMESCAPER_OPENFX_NO_BYTE_PIXEL_DEPTH_FIXTURE'],
		['no-rgba-component', 'FRAMESCAPER_OPENFX_NO_RGBA_COMPONENT_FIXTURE'],
	].map(([name, definition]) => [name, {
		definition, path: join(directory, `${name}${extension}`),
	}]));
	const scanner = join(directory, executableName('scanner'));
	const runtime = join(directory, executableName('runtime'));
	const blockedScanner = join(directory, executableName('blocked-scanner'));
	const boostArguments = boostClosureIncludeArguments();
	const exactRetimeAvailable = exactRetimeClosureAvailable();
	const abiCommon = [
		'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		...boostArguments, '-DFRAMESCAPER_OPENFX_CONTRACT_ONLY=1', '-I', sources,
	];
	const common = [...abiCommon, '-DFRAMESCAPER_OPENFX_CONFORMANCE_FIXTURE=1'];
	const shared = process.platform === 'darwin' ? ['-dynamiclib'] : ['-shared', '-fPIC'];
	assertBuilt(spawnSync('c++', [...common, ...shared, fixture, '-o', plugin], {
		encoding: 'utf8',
	}), 'OpenFX conformance plug-in');
	assertBuilt(spawnSync('c++', [
		...common, '-DFRAMESCAPER_OPENFX_CONTEXT_MISMATCH_FIXTURE=1',
		...shared, fixture, '-o', mismatchPlugin,
	], { encoding: 'utf8' }), 'OpenFX context-mismatch plug-in');
	assertBuilt(spawnSync('c++', [
		...common, '-DFRAMESCAPER_OPENFX_STANDARD_PARAMETER_SPOOF_FIXTURE=1',
		...shared, fixture, '-o', spoofPlugin,
	], { encoding: 'utf8' }), 'OpenFX standard-parameter-spoof plug-in');
	for (const [name, value] of mediaDeclarationPlugins) {
		assertBuilt(spawnSync('c++', [
			...common, `-D${value.definition}=1`, ...shared, fixture, '-o', value.path,
		], { encoding: 'utf8' }), `OpenFX ${name} plug-in`);
	}
	const hostSources = [
		join(sources, 'sha256.cpp'), join(sources, 'dynamic_library.cpp'),
		join(sources, 'gpu_runtime.cpp'),
		join(sources, 'host_runtime.cpp'), join(sources, 'loaded_plugin_binary.cpp'),
		join(sources, 'interact_v1_invocation.cpp'),
		join(sources, 'parameter_values.cpp'), join(sources, 'v12_cancellation_channel.cpp'),
		join(sources, 'v12_host_invocation.cpp'), join(sources, 'v12_video_timing_grants.cpp'),
		join(sources, 'v12_gpu_support.cpp'),
		join(sources, 'v12_retime_authority.cpp'),
		join(sources, 'v12_output_file.cpp'), join(sources, 'v12_transition_authority.cpp'),
		join(repositoryRoot, 'native/framescaper-media-host/src/strict_json.cpp'),
		join(repositoryRoot, 'native/framescaper-media-host/src/sha256.cpp'),
		join(repositoryRoot, 'native/framescaper-media-host/src/media_file_grants.cpp'),
		join(repositoryRoot, 'native/framescaper-media-host/src/media_plan.cpp'),
		join(repositoryRoot, 'native/framescaper-media-host/src/legacy_plan_semantics.cpp'),
		join(repositoryRoot, 'native/framescaper-media-host/src/legacy_plan_v8_filter_semantics.cpp'),
	];
	for (const [entry, output] of [
		['ofx_scanner.cpp', scanner], ['ofx_runtime_host.cpp', runtime],
	]) {
		const link = process.platform === 'linux' ? ['-ldl', '-pthread'] : ['-pthread'];
		assertBuilt(spawnSync('c++', [
			...common, '-I', join(repositoryRoot, 'native/framescaper-media-host/src'),
			...hostSources, join(sources, entry), ...link, '-o', output,
		], { encoding: 'utf8' }), `OpenFX ${entry}`);
	}
	assertBuilt(spawnSync('c++', [
		...abiCommon, '-I', join(repositoryRoot, 'native/framescaper-media-host/src'),
		...hostSources, join(sources, 'ofx_scanner.cpp'),
		...(process.platform === 'linux' ? ['-ldl', '-pthread'] : ['-pthread']),
		'-o', blockedScanner,
	], { encoding: 'utf8' }), 'blocked OpenFX scanner');
	const bytes = readFileSync(plugin);
	retainedCleanup = () => rmSync(directory, { recursive: true, force: true });
	retainedBuild = {
		directory, plugin, mismatchPlugin, spoofPlugin, scanner, runtime, blockedScanner,
		exactRetimeAvailable,
		sha256: digest(bytes), mismatchSha256: digest(readFileSync(mismatchPlugin)),
		spoofSha256: digest(readFileSync(spoofPlugin)),
		mediaDeclarationPlugins: Object.freeze([...mediaDeclarationPlugins].map(([name, value]) => Object.freeze({
			name, path: value.path, sha256: digest(readFileSync(value.path)),
		}))),
		cleanup: () => undefined,
	};
	return retainedBuild;
}

function assertBuilt(result, label) {
	if (result.status !== 0) throw new Error(`${label} failed to build: ${result.stderr}`);
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function executableName(name) {
	return process.platform === 'win32' ? `${name}.exe` : name;
}
