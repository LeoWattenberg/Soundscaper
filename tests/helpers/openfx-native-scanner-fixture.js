/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createNativeFixtureCompiler, lazyNativeFixtureValue } from './native-fixture-compiler.ts';

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
	retainedCleanup = () => rmSync(directory, { recursive: true, force: true });
	const compiler = createNativeFixtureCompiler({
		directory,
		invoke: (arguments_, label) => assertBuilt(spawnSync('c++', arguments_, { encoding: 'utf8' }), label),
	});
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
	const buildPlugin = lazyNativeFixtureValue(() => compiler.artifact({
		arguments: [...common, ...shared, fixture], outputPath: plugin, label: 'OpenFX conformance plug-in',
	}));
	const buildMismatch = lazyNativeFixtureValue(() => compiler.artifact({ arguments: [
		...common, '-DFRAMESCAPER_OPENFX_CONTEXT_MISMATCH_FIXTURE=1',
		...shared, fixture,
	], outputPath: mismatchPlugin, label: 'OpenFX context-mismatch plug-in' }));
	const buildSpoof = lazyNativeFixtureValue(() => compiler.artifact({ arguments: [
		...common, '-DFRAMESCAPER_OPENFX_STANDARD_PARAMETER_SPOOF_FIXTURE=1',
		...shared, fixture,
	], outputPath: spoofPlugin, label: 'OpenFX standard-parameter-spoof plug-in' }));
	const buildMediaDeclarations = lazyNativeFixtureValue(() => Object.freeze([...mediaDeclarationPlugins].map(([name, value]) => {
		compiler.artifact({ arguments: [...common, `-D${value.definition}=1`, ...shared, fixture],
			outputPath: value.path, label: `OpenFX ${name} plug-in` });
		return Object.freeze({ name, path: value.path, sha256: digest(readFileSync(value.path)) });
	})));
	const hostSources = [
		join(repositoryRoot, 'native/common/sha256.cpp'),
		join(sources, 'sha256.cpp'), join(sources, 'dynamic_library.cpp'),
		join(sources, 'gpu_runtime.cpp'),
		join(sources, 'host_parameter_wire_hydration.cpp'),
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
	function hostExecutable(entry, outputPath, flags) {
		const link = process.platform === 'linux' ? ['-ldl', '-pthread'] : ['-pthread'];
		return lazyNativeFixtureValue(() => compiler.executable({
			arguments: [...flags, '-I', join(repositoryRoot, 'native/framescaper-media-host/src')],
			sources: [...hostSources, join(sources, entry)],
			objectArguments: ['-pthread'], linkArguments: link,
			outputPath, label: `OpenFX ${entry}`,
		}));
	}
	const buildScanner = hostExecutable('ofx_scanner.cpp', scanner, common);
	const buildRuntime = hostExecutable('ofx_runtime_host.cpp', runtime, common);
	const buildBlockedScanner = hostExecutable('ofx_scanner.cpp', blockedScanner, abiCommon);
	const pluginDigest = lazyNativeFixtureValue(() => digest(readFileSync(buildPlugin())));
	const mismatchDigest = lazyNativeFixtureValue(() => digest(readFileSync(buildMismatch())));
	const spoofDigest = lazyNativeFixtureValue(() => digest(readFileSync(buildSpoof())));
	retainedBuild = {
		directory,
		get plugin() { return buildPlugin(); },
		get mismatchPlugin() { return buildMismatch(); },
		get spoofPlugin() { return buildSpoof(); },
		get scanner() { return buildScanner(); },
		get runtime() { return buildRuntime(); },
		get blockedScanner() { return buildBlockedScanner(); },
		exactRetimeAvailable,
		get sha256() { return pluginDigest(); },
		get mismatchSha256() { return mismatchDigest(); },
		get spoofSha256() { return spoofDigest(); },
		get mediaDeclarationPlugins() { return buildMediaDeclarations(); },
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
