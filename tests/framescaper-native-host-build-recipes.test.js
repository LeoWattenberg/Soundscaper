/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {
	appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
	rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
	FRAMESCAPER_MEDIA_HOST_BUILD_TARGETS,
	createFramescaperMediaHostBuildRecipe,
	executeFramescaperMediaHostBuildRecipe,
	fingerprintFramescaperMediaHostToolchainReceipt,
} from '../native/framescaper-media-host/build/recipe-driver.mjs';
import {
	FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS,
	createFramescaperOpenFxHostBuildRecipe,
	executeFramescaperOpenFxHostBuildRecipe,
	fingerprintFramescaperOpenFxHostToolchainReceipt,
} from '../native/framescaper-openfx-host/build/recipe-driver.mjs';
import {
	collectBoostHeaderClosure,
	collectExtractedSourceTree,
} from '../native/framescaper-media-host/build/source-authentication.mjs';
import {
	FRAMESCAPER_MEDIA_HOST_EXTERNAL_SOURCE_IDS,
	validateFramescaperMediaHostExternalSourceManifest,
} from '../native/framescaper-media-host/build/external-source-authentication.mjs';
import {
	FRAMESCAPER_FFMPEG_CONFIGURE_FLAGS,
	FRAMESCAPER_FFMPEG_POLICY,
} from '../native/framescaper-media-host/build/media-build-commands.mjs';
import {
	assertNativeHostBuildRecipe, closureIdentity, json, listRelativeFiles,
	refreshNativeHostSourcePins, sha256, sourcePins, writeJson,
} from './helpers/framescaper-native-host-build-fixture.mjs';
const repositoryRoot = resolve(import.meta.dirname, '..');
const SOURCE_DATE_EPOCH = 1786492800;
const BOOST_ARCHIVE_SHA256 = '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c';
const MEDIA_INPUTS = Object.freeze([
	'CMakeLists.txt', 'CMakePresets.json', 'build/external-source-authentication.mjs',
	'build/ffmpeg-9.0.1-configure.json', 'build/ffmpeg-9.0.1-external-sources.json',
	'build/media-build-commands.mjs', 'build/recipe-cli.mjs', 'build/recipe-driver.mjs',
	'build/source-authentication.mjs', 'build/targets.json', 'build/windows-vpx.pc',
	...FRAMESCAPER_MEDIA_HOST_BUILD_TARGETS.map(({ toolchainFile }) => toolchainFile),
].sort());
const OPENFX_INPUTS = Object.freeze([
	'CMakeLists.txt', 'CMakePresets.json', 'build/recipe-cli.mjs', 'build/recipe-driver.mjs',
	'build/source-authentication.mjs', 'build/targets.json',
	...FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS.map(({ toolchainFile }) => toolchainFile),
].sort());
test('both recipes own exactly five CI-generated targets and FFmpeg starts from a closed component set', () => {
	for (const [kind, targets] of [
		['media', FRAMESCAPER_MEDIA_HOST_BUILD_TARGETS],
		['openfx', FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS],
	]) {
		assert.deepEqual(targets.map(({ id }) => id), [
			'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
		]);
		assert.equal(new Set(targets.map(({ runtime }) => runtime)).size, 5);
		assert.ok(targets.every(({ runtime, hostRuntime }) => runtime === hostRuntime));
		const hostRoot = join(repositoryRoot, `native/framescaper-${kind === 'media' ? 'media' : 'openfx'}-host`);
		const table = json(join(hostRoot, 'build/targets.json'));
		assert.deepEqual(table.targets, targets);
		const manifest = json(join(hostRoot, 'source-manifest.json'));
		for (const target of targets) {
			const row = manifest.targets[target.id];
			assert.equal(row.status, 'ci-generated');
			assert.equal(row.toolchainIdentity, null);
			assert.equal(row.blockedBy, null);
			assert.equal(row.buildResult, null);
			if (kind === 'media') assert.equal(row.payload, null);
			else {
				assert.equal(row.scannerPayload, null);
				assert.equal(row.runtimeHostPayload, null);
			}
		}
	}
	const configuration = json(join(
		repositoryRoot, 'native/framescaper-media-host/build/ffmpeg-9.0.1-configure.json',
	));
	assert.deepEqual(configuration.configureFlags, FRAMESCAPER_FFMPEG_CONFIGURE_FLAGS);
	assert.deepEqual(configuration.policy, FRAMESCAPER_FFMPEG_POLICY);
	assert.deepEqual(configuration.policy.externalLibraries,
		['x264', 'x265', 'libvpx', 'libopus', 'zlib']);
	assert.equal(configuration.policy.rawFfmpegArguments, false);
	assert.equal(configuration.policy.network, false);
	assert.match(configuration.configureFlags.join('\n'), /libx264.*libx265.*libvpx.*libopus.*zlib/isu);
	assert.match(configuration.configureFlags.join('\n'), /h264.*hevc.*vp9.*av1.*png.*tiff.*exr/isu);
	assert.equal(configuration.policy.payloadPublicationRequiresVerifiedBuildResult, true);
	assert.equal(Object.hasOwn(configuration.policy, 'humanReviewMilestone'), false);
	const external = validateFramescaperMediaHostExternalSourceManifest(json(join(
		repositoryRoot, 'native/framescaper-media-host/build/ffmpeg-9.0.1-external-sources.json',
	)));
	assert.equal(external.activation, 'test-enabled');
	assert.deepEqual(external.libraries.map(({ id }) => id), FRAMESCAPER_MEDIA_HOST_EXTERNAL_SOURCE_IDS);
	assert.ok(external.libraries.every(({ sha256, extractedTree }) => (
		/^[a-f0-9]{64}$/u.test(sha256) && /^[a-f0-9]{64}$/u.test(extractedTree.sha256)
	)));
	const arm64EcToolchain = readFileSync(join(
		repositoryRoot, 'native/framescaper-openfx-host/build/toolchains/win-arm64.cmake',
	), 'utf8');
	assert.match(arm64EcToolchain, /set\(CMAKE_C_FLAGS_INIT "\/arm64EC"\)/u);
	assert.match(arm64EcToolchain, /set\(CMAKE_CXX_FLAGS_INIT "\/arm64EC"\)/u);
	assert.match(arm64EcToolchain, /set\(CMAKE_EXE_LINKER_FLAGS_INIT "\/MACHINE:ARM64EC"\)/u);
	assert.match(arm64EcToolchain, /set\(CMAKE_SHARED_LINKER_FLAGS_INIT "\/MACHINE:ARM64EC"\)/u);
});
test('all five media and OpenFX targets emit immutable closed dry-run recipes', (context) => {
	for (const target of FRAMESCAPER_MEDIA_HOST_BUILD_TARGETS) {
		const fixture = buildFixture(context, 'media', target.id);
		const recipe = createFramescaperMediaHostBuildRecipe(fixture.options);
		assertNativeHostBuildRecipe(recipe, target, [
			'zlib-configure', 'zlib-build', 'zlib-install-metadata', 'zlib-install-library-directory',
			'zlib-install-static-library',
			'x264-configure', 'x264-build', 'x264-install',
			'x265-configure', 'x265-build', 'x265-install',
			'libvpx-configure', 'libvpx-build', 'libvpx-install',
			...(target.id.startsWith('win-') ? ['libvpx-normalize-library', 'libvpx-normalize-pkg-config'] : []),
			'libopus-configure', 'libopus-build', 'libopus-install',
			'ffmpeg-configure', 'ffmpeg-build', 'ffmpeg-install', 'host-configure', 'host-build',
			'host-install',
		], SOURCE_DATE_EPOCH);
		const configure = recipe.commands.find(({ phase }) => phase === 'ffmpeg-configure');
		assert.equal(configure.args[1], '--disable-everything');
		assert.ok(!configure.args.includes('--enable-cross-compile'),
			`${target.id} recipe is admitted only on its matching native host`);
		assert.ok(configure.args.includes(`--prefix=${join(fixture.outputRoot, 'ffmpeg-install')}`));
		assert.ok(configure.args.includes(`--cc=${target.id.startsWith('win-') ? fixture.executables.c.path.split('/').at(-1) : fixture.executables.c.path}`));
		assert.ok(recipe.commands.find(({ phase }) => phase === 'host-configure')
			.args.includes(`-DBOOST_ROOT=${fixture.boostSourceRoot}`));
		assert.deepEqual(readdirSync(fixture.outputRoot), []);
	}
	for (const target of FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS) {
		const fixture = buildFixture(context, 'openfx', target.id);
		const recipe = createFramescaperOpenFxHostBuildRecipe(fixture.options);
		assertNativeHostBuildRecipe(
			recipe, target, ['host-configure', 'host-build', 'host-install'], SOURCE_DATE_EPOCH,
		);
		assert.ok(recipe.commands[0].args.includes(
			`-DFRAMESCAPER_OPENFX_SOURCE_ROOT=${fixture.openfxSourceRoot}`,
		));
		assert.ok(recipe.commands[0].args.includes(`-DBOOST_ROOT=${fixture.boostSourceRoot}`));
		assert.ok(recipe.commands[0].args.includes('-DBoost_NO_SYSTEM_PATHS=ON'));
		assert.match(recipe.mediaContractIdentity, /^[a-f0-9]{64}$/u);
		assert.deepEqual(readdirSync(fixture.outputRoot), []);
	}
});
test('OpenFX media-contract identity does not consult the ambient locale', (context) => {
	const fixture = buildFixture(context, 'openfx', 'linux-x64');
	const localeCompare = String.prototype.localeCompare;
	try {
		String.prototype.localeCompare = () => {
			throw new Error('ambient locale ordering was consulted');
		};
		assert.match(
			createFramescaperOpenFxHostBuildRecipe(fixture.options).mediaContractIdentity,
			/^[a-f0-9]{64}$/u,
		);
	} finally {
		String.prototype.localeCompare = localeCompare;
	}
});
test('each native recipe requires its own source authenticator to remain manifest pinned', (context) => {
	for (const kind of ['media', 'openfx']) {
		const fixture = buildFixture(context, kind, 'linux-x64'), manifest = json(fixture.manifestPath), create = kind === 'media' ? createFramescaperMediaHostBuildRecipe : createFramescaperOpenFxHostBuildRecipe;
		manifest.sourceFiles = manifest.sourceFiles.filter(({ path }) => path !== 'build/source-authentication.mjs'); writeJson(fixture.manifestPath, manifest);
		assert.throws(() => create(fixture.options),
			/source-file inventory|Required build input build\/source-authentication\.mjs is not pinned/u);
	}
});
test('both native recipes authenticate every shared native authority', (context) => {
	for (const kind of ['media', 'openfx']) {
		const fixture = buildFixture(context, kind, 'linux-x64');
		const create = kind === 'media'
			? createFramescaperMediaHostBuildRecipe : createFramescaperOpenFxHostBuildRecipe;
		for (const path of ['native/common/exact_time.hpp', 'native/common/sha256.cpp']) {
			const authority = join(fixture.repositoryRoot, path);
			const original = readFileSync(authority);
			appendFileSync(authority, 'drift');
			assert.throws(() => create(fixture.options), /shared build input.*drifted/iu);
			writeFileSync(authority, original);
		}
	}
});
test('fake execution runs only the admitted phases once and never writes a payload claim', (context) => {
	const runtime = `${process.platform}-${process.arch}`;
	const mediaTarget = FRAMESCAPER_MEDIA_HOST_BUILD_TARGETS.find(({ hostRuntime }) => hostRuntime === runtime);
	const openfxTarget = FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS.find(({ hostRuntime }) => hostRuntime === runtime);
	if (!mediaTarget || !openfxTarget) return context.skip(`No five-target recipe executes on ${runtime}.`);
	for (const [kind, target] of [['media', mediaTarget], ['openfx', openfxTarget]]) {
		const fixture = buildFixture(context, kind, target.id);
		const payload = join(fixture.root, `${kind}-payload-manifest.json`);
		writeFileSync(payload, '{"targets":{}}\n');
		const calls = [];
		const recipe = kind === 'media'
			? createFramescaperMediaHostBuildRecipe(fixture.options)
			: createFramescaperOpenFxHostBuildRecipe(fixture.options);
		const execute = kind === 'media'
			? executeFramescaperMediaHostBuildRecipe
			: executeFramescaperOpenFxHostBuildRecipe;
		execute(recipe, { run: (executable, args, options) => {
			calls.push({ executable, args, options });
			return { status: 0 };
		}, ...(kind === 'media' ? { verifyFfmpegConfiguration: () => ({}) } : {}) });
		assert.deepEqual(calls.map(({ args }) => args), recipe.commands.map(({ args }) => [...args]));
		assert.ok(calls.every(({ executable }) => Object.values(fixture.executables).some(
			(tool) => tool.path === executable,
		)));
		assert.equal(readFileSync(payload, 'utf8'), '{"targets":{}}\n');
		assert.equal(recipe.payloadManifestMutation, false);
		assert.throws(() => execute(recipe, { run: () => ({ status: 0 }) }), /fresh authentic/u);
		const swapped = buildFixture(context, kind, target.id), redirected = join(swapped.root, 'redirected');
		const swappedRecipe = kind === 'media' ? createFramescaperMediaHostBuildRecipe(swapped.options) : createFramescaperOpenFxHostBuildRecipe(swapped.options);
		mkdirSync(redirected); rmSync(swapped.outputRoot, { recursive: true }); symlinkSync(redirected, swapped.outputRoot, 'dir');
		assert.throws(() => execute(swappedRecipe, { run: () => ({ status: 0 }) }), /canonical non-symlink/iu); assert.deepEqual(readdirSync(redirected), []);
	}
});
test('recipes reject host, target, toolchain, output, payload, and post-admission drift', (context) => {
	const wrongHost = buildFixture(context, 'media', 'linux-x64');
	assert.throws(() => createFramescaperMediaHostBuildRecipe({
		...wrongHost.options, hostRuntime: 'linux-arm64',
	}), /requires build host/u);
	assert.throws(() => createFramescaperMediaHostBuildRecipe({
		...wrongHost.options, targetId: 'freebsd-x64',
	}), /unsupported/u);
	assert.throws(() => createFramescaperMediaHostBuildRecipe({
		...wrongHost.options, toolchainIdentity: '00'.repeat(32),
	}), /toolchain identity drifted/u);
	const inside = join(wrongHost.repositoryRoot, 'output');
	mkdirSync(inside);
	assert.throws(() => createFramescaperMediaHostBuildRecipe({
		...wrongHost.options, outputRoot: inside,
	}), /outside the repository/u);
	const overclaim = buildFixture(context, 'openfx', 'linux-x64');
	const manifest = json(overclaim.manifestPath);
	manifest.targets['linux-x64'].scannerPayload = { sha256: '00'.repeat(32) };
	writeJson(overclaim.manifestPath, manifest);
	assert.throws(() => createFramescaperOpenFxHostBuildRecipe(overclaim.options), /ci-generated/iu);
	const drift = buildFixture(context, 'media', 'linux-x64');
	const recipe = createFramescaperMediaHostBuildRecipe(drift.options);
	appendFileSync(drift.executables.cmake.path, 'drift');
	let calls = 0;
	assert.throws(() => executeFramescaperMediaHostBuildRecipe(recipe, {
		run: () => { calls += 1; return { status: 0 }; },
	}), /drifted after recipe admission/u);
	assert.equal(calls, 0);
	assert.throws(() => executeFramescaperMediaHostBuildRecipe(structuredClone(recipe), {
		run: () => ({ status: 0 }),
	}), /fresh authentic/u);
	const runtime = `${process.platform}-${process.arch}`;
	const openfxTarget = FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS.find(
		({ hostRuntime }) => hostRuntime === runtime,
	);
	if (openfxTarget) {
		const crossTree = buildFixture(context, 'openfx', openfxTarget.id);
		const crossTreeRecipe = createFramescaperOpenFxHostBuildRecipe(crossTree.options);
		appendFileSync(join(crossTree.mediaContractRoot, 'src/sha256.hpp'), 'drift');
		calls = 0;
		assert.throws(() => executeFramescaperOpenFxHostBuildRecipe(crossTreeRecipe, {
			run: () => { calls += 1; return { status: 0 }; },
		}), /drifted after recipe admission/u);
		assert.equal(calls, 0);
		const manifestDrift = buildFixture(context, 'openfx', openfxTarget.id);
		const manifestDriftRecipe = createFramescaperOpenFxHostBuildRecipe(manifestDrift.options);
		appendFileSync(join(manifestDrift.mediaContractRoot, 'source-manifest.json'), 'drift');
		assert.throws(() => executeFramescaperOpenFxHostBuildRecipe(manifestDriftRecipe, {
			run: () => { calls += 1; return { status: 0 }; },
		}), /drifted after recipe admission/u);
		assert.equal(calls, 0);
	}
});
test('repinning cannot broaden FFmpeg or smuggle ambient paths into exact presets/toolchains', (context) => {
	const unpinned = buildFixture(context, 'media', 'linux-x64');
	writeFileSync(join(unpinned.hostRoot, 'src-shadowing-header.hpp'), '#pragma once\n');
	assert.throws(() => createFramescaperMediaHostBuildRecipe(unpinned.options),
		/source-file inventory omits or invents/u);
	const ffmpeg = buildFixture(context, 'media', 'linux-x64');
	const configurationPath = join(ffmpeg.hostRoot, 'build/ffmpeg-9.0.1-configure.json');
	const configuration = json(configurationPath);
	configuration.configureFlags.push('--enable-decoder=h264');
	writeJson(configurationPath, configuration);
	refreshNativeHostSourcePins(ffmpeg);
	assert.throws(() => createFramescaperMediaHostBuildRecipe(ffmpeg.options), /configure recipe is not closed/u);

	const preset = buildFixture(context, 'openfx', 'linux-x64');
	const presetPath = join(preset.hostRoot, 'CMakePresets.json');
	const presets = json(presetPath);
	presets.configurePresets[1].cacheVariables = { FRAMESCAPER_OPENFX_SOURCE_ROOT: '$env{HOME}' };
	writeJson(presetPath, presets);
	refreshNativeHostSourcePins(preset);
	assert.throws(() => createFramescaperOpenFxHostBuildRecipe(preset.options), /CMake presets drifted/u);

	const toolchain = buildFixture(context, 'media', 'linux-x64');
	const toolchainPath = join(toolchain.hostRoot, 'build/toolchains/linux-x64.cmake');
	appendFileSync(toolchainPath, 'set(CMAKE_CXX_COMPILER /ambient/compiler)\n');
	refreshNativeHostSourcePins(toolchain);
	assert.throws(() => createFramescaperMediaHostBuildRecipe(toolchain.options), /toolchain drifted/u);

	const shared = buildFixture(context, 'openfx', 'linux-x64');
	appendFileSync(join(shared.mediaContractRoot, 'src/media_plan.hpp'), 'drift');
	assert.throws(
		() => createFramescaperOpenFxHostBuildRecipe(shared.options),
		/reused media-contract input .* drifted from its pin/iu,
	);

	const escapedInclude = buildFixture(context, 'openfx', 'linux-x64');
	appendFileSync(
		join(escapedInclude.mediaContractRoot, 'src/media_plan.cpp'),
		'#include "../../outside.hpp"\n',
	);
	const escapedManifestPath = join(escapedInclude.mediaContractRoot, 'source-manifest.json');
	const escapedManifest = json(escapedManifestPath);
	escapedManifest.sourceFiles = sourcePins(
		escapedInclude.mediaContractRoot,
		escapedManifest.sourceFiles.map(({ path }) => path),
	);
	writeJson(escapedManifestPath, escapedManifest);
	assert.throws(
		() => createFramescaperOpenFxHostBuildRecipe(escapedInclude.options),
		/media-contract include .* outside its source root/iu,
	);

	const boost = buildFixture(context, 'openfx', 'linux-x64');
	writeFileSync(join(boost.boostSourceRoot, 'boost/version.hpp'), '#define BOOST_VERSION 109100\n');
	assert.throws(
		() => createFramescaperOpenFxHostBuildRecipe(boost.options),
		/Boost source tree has version drift/u,
	);
});

test('actual FFmpeg, OpenFX, and Boost content cannot be authorized by forged source receipts', (context) => {
	const ffmpegDrift = buildFixture(context, 'media', 'linux-x64');
	appendFileSync(join(ffmpegDrift.ffmpegSourceRoot, 'configure'), '# drift\n');
	assert.throws(
		() => createFramescaperMediaHostBuildRecipe(ffmpegDrift.options),
		/FFmpeg extracted source tree .* pinned content closure/iu,
	);

	const forgedFfmpeg = buildFixture(context, 'media', 'linux-x64');
	appendFileSync(join(forgedFfmpeg.ffmpegSourceRoot, 'configure'), '# forged drift\n');
	const ffmpegReceiptPath = join(
		forgedFfmpeg.ffmpegSourceRoot, '.framescaper-source-identity.json',
	);
	const ffmpegReceipt = json(ffmpegReceiptPath);
	ffmpegReceipt.extractedTreeSha256 = collectExtractedSourceTree(
		forgedFfmpeg.ffmpegSourceRoot,
	).sha256;
	writeJson(ffmpegReceiptPath, ffmpegReceipt);
	assert.throws(
		() => createFramescaperMediaHostBuildRecipe(forgedFfmpeg.options),
		/FFmpeg source receipt is not the pinned/iu,
	);

	const openfxDrift = buildFixture(context, 'openfx', 'linux-x64');
	appendFileSync(join(openfxDrift.openfxSourceRoot, 'include/ofxCore.h'), '/* drift */\n');
	assert.throws(
		() => createFramescaperOpenFxHostBuildRecipe(openfxDrift.options),
		/OpenFX extracted source tree .* pinned content closure/iu,
	);

	const boostDrift = buildFixture(context, 'media', 'linux-x64');
	mkdirSync(join(boostDrift.boostSourceRoot, 'boost/detail'));
	writeFileSync(join(boostDrift.boostSourceRoot, 'boost/detail/forged.hpp'), '#pragma once\n');
	appendFileSync(
		join(boostDrift.boostSourceRoot, 'boost/multiprecision/cpp_int.hpp'),
		'#include <boost/detail/forged.hpp>\n',
	);
	const boostReceiptPath = join(
		boostDrift.boostSourceRoot, '.framescaper-source-identity.json',
	);
	const boostReceipt = json(boostReceiptPath);
	boostReceipt.headerClosureSha256 = collectBoostHeaderClosure(
		boostDrift.boostSourceRoot, ['boost/multiprecision/cpp_int.hpp'],
	).sha256;
	writeJson(boostReceiptPath, boostReceipt);
	assert.throws(
		() => createFramescaperMediaHostBuildRecipe(boostDrift.options),
		/Boost source receipt is not the pinned/iu,
	);
});

test('admitted source-tree and Boost-closure witnesses are rechecked before execution', (context) => {
	const runtime = `${process.platform}-${process.arch}`;
	const mediaTarget = FRAMESCAPER_MEDIA_HOST_BUILD_TARGETS.find(
		({ hostRuntime }) => hostRuntime === runtime,
	);
	const openfxTarget = FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS.find(
		({ hostRuntime }) => hostRuntime === runtime,
	);
	if (!mediaTarget || !openfxTarget) {
		return context.skip(`No complete five-target recipe pair executes on ${runtime}.`);
	}

	for (const drift of ['ffmpeg', 'boost']) {
		const fixture = buildFixture(context, 'media', mediaTarget.id);
		const recipe = createFramescaperMediaHostBuildRecipe(fixture.options);
		appendFileSync(drift === 'ffmpeg'
			? join(fixture.ffmpegSourceRoot, 'configure')
			: join(fixture.boostSourceRoot, 'boost/multiprecision/cpp_int.hpp'), '# drift\n');
		let calls = 0;
		assert.throws(() => executeFramescaperMediaHostBuildRecipe(recipe, {
			run: () => { calls += 1; return { status: 0 }; },
		}), /drifted from its pinned content closure/iu);
		assert.equal(calls, 0);
	}
	const external = buildFixture(context, 'media', mediaTarget.id);
	const externalRecipe = createFramescaperMediaHostBuildRecipe(external.options);
	writeFileSync(join(external.externalSourceRoot, 'x264', 'unpinned.c'), 'int drift;\n');
	let externalCalls = 0;
	assert.throws(() => executeFramescaperMediaHostBuildRecipe(externalRecipe, {
		run: () => { externalCalls += 1; return { status: 0 }; },
		verifyFfmpegConfiguration: () => ({}),
	}), /x264 extracted source tree.*pinned content closure/iu);
	assert.equal(externalCalls, 0);

	const openfx = buildFixture(context, 'openfx', openfxTarget.id);
	const openfxRecipe = createFramescaperOpenFxHostBuildRecipe(openfx.options);
	appendFileSync(join(openfx.openfxSourceRoot, 'include/ofxParam.h'), '/* drift */\n');
	let calls = 0;
	assert.throws(() => executeFramescaperOpenFxHostBuildRecipe(openfxRecipe, {
		run: () => { calls += 1; return { status: 0 }; },
	}), /drifted from its pinned content closure/iu);
	assert.equal(calls, 0);
});

function buildFixture(context, kind, targetId) {
	const root = mkdtempSync(join(tmpdir(), `framescaper-${kind}-recipe-`));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const repositoryRootFixture = join(root, 'repository');
	const relativeHost = kind === 'media'
		? 'native/framescaper-media-host'
		: 'native/framescaper-openfx-host';
	const hostRoot = join(repositoryRootFixture, relativeHost);
	mkdirSync(hostRoot, { recursive: true });
	const inputs = kind === 'media' ? MEDIA_INPUTS : OPENFX_INPUTS;
	const actualHost = join(repositoryRoot, relativeHost);
	for (const path of inputs) {
		const destination = join(hostRoot, path);
		mkdirSync(dirname(destination), { recursive: true });
		if (kind === 'media' && path === 'CMakeLists.txt') {
			writeFileSync(destination, `cmake_minimum_required(VERSION 3.30)
set(SCAPE_NATIVE_COMMON_ROOT "\${CMAKE_CURRENT_SOURCE_DIR}/../common")
add_executable(fixture \${SCAPE_NATIVE_COMMON_ROOT}/sha256.cpp)
`);
		}
		else copyFileSync(join(actualHost, path), destination);
	}
	const manifest = json(join(actualHost, 'source-manifest.json'));
	for (const { path } of manifest.sharedSourceFiles) {
		const destination = join(repositoryRootFixture, path);
		mkdirSync(dirname(destination), { recursive: true });
		copyFileSync(join(repositoryRoot, path), destination);
	}
	manifest.sourceFiles = sourcePins(hostRoot, inputs);
	const manifestPath = join(hostRoot, 'source-manifest.json');
	const targets = kind === 'media'
		? FRAMESCAPER_MEDIA_HOST_BUILD_TARGETS
		: FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS;
	const target = targets.find(({ id }) => id === targetId);
	assert.ok(target);
	const toolchain = provisionToolchain(root, kind, target);
	const outputRoot = join(root, 'output');
	mkdirSync(outputRoot);
	const fixture = {
		root, repositoryRoot: repositoryRootFixture, hostRoot, manifestPath, inputs,
		outputRoot, executables: toolchain.executables,
	};
	if (kind === 'media') provisionMediaSources(fixture, manifest);
	else {
		provisionOpenFxSource(fixture, manifest);
		provisionMediaContract(fixture, fixture.boostHeaderClosure);
	}
	manifest.sourceFiles = sourcePins(hostRoot, inputs); writeJson(manifestPath, manifest);
	fixture.options = kind === 'media' ? {
		repositoryRoot: repositoryRootFixture, targetId, hostRuntime: target.hostRuntime,
		toolchainReceipt: toolchain.receipt, toolchainIdentity: toolchain.identity,
		ffmpegSourceRoot: fixture.ffmpegSourceRoot, boostSourceRoot: fixture.boostSourceRoot,
		externalSourceRoot: fixture.externalSourceRoot,
		outputRoot,
	} : {
		repositoryRoot: repositoryRootFixture, targetId, hostRuntime: target.hostRuntime,
		toolchainReceipt: toolchain.receipt, toolchainIdentity: toolchain.identity,
		openfxSourceRoot: fixture.openfxSourceRoot, boostSourceRoot: fixture.boostSourceRoot,
		outputRoot,
	};
	return fixture;
}

function provisionToolchain(root, kind, target) {
	const directory = join(root, 'toolchain');
	mkdirSync(directory);
	const roles = kind === 'media'
		? ['ar', 'c', 'cmake', 'cxx', 'make', 'ninja', 'pkgConfig', 'ranlib', 'shell',
			...(target.id.startsWith('win-') ? ['msbuild', 'rc'] : [])]
		: ['c', 'cmake', 'cxx', 'ninja'];
	const executables = {};
	for (const role of roles) {
		const path = join(directory, `${role}.tool`);
		writeFileSync(path, `authenticated-${target.id}-${role}\n`, { mode: 0o700 });
		executables[role] = { path, sha256: sha256(readFileSync(path)) };
	}
	const body = {
		schemaVersion: 1, targetId: target.id, hostRuntime: target.hostRuntime,
		executables, environment: { PATH: directory },
	};
	const identity = kind === 'media'
		? fingerprintFramescaperMediaHostToolchainReceipt(body)
		: fingerprintFramescaperOpenFxHostToolchainReceipt(body);
	const receipt = join(root, `${kind}-toolchain.json`);
	writeJson(receipt, { ...body, identitySha256: identity });
	return { receipt, identity, executables };
}

function provisionMediaSources(fixture, manifest) {
	fixture.ffmpegSourceRoot = join(fixture.root, 'ffmpeg-9.0.1');
	mkdirSync(fixture.ffmpegSourceRoot);
	writeFileSync(join(fixture.ffmpegSourceRoot, 'configure'), '#!/bin/sh\n', { mode: 0o700 });
	writeFileSync(join(fixture.ffmpegSourceRoot, 'RELEASE'), '9.0.1\n');
	manifest.ffmpeg.extractedTree = closureIdentity(
		collectExtractedSourceTree(fixture.ffmpegSourceRoot),
	);
	writeJson(join(fixture.ffmpegSourceRoot, '.framescaper-source-identity.json'), {
		schemaVersion: 1, component: 'ffmpeg', version: '9.0.1',
		archiveSha256: manifest.ffmpeg.sha256,
		extractedTreeSha256: manifest.ffmpeg.extractedTree.sha256,
		root: fixture.ffmpegSourceRoot,
	});
	fixture.externalSourceRoot = join(fixture.root, 'media-external-sources');
	mkdirSync(fixture.externalSourceRoot);
	const externalPath = join(fixture.hostRoot, 'build/ffmpeg-9.0.1-external-sources.json');
	const external = json(externalPath);
	for (const row of external.libraries) {
		const sourceRoot = join(fixture.externalSourceRoot, row.id);
		mkdirSync(sourceRoot);
		writeFileSync(join(sourceRoot, 'source.txt'), `${row.id}\n`);
		row.extractedTree = closureIdentity(collectExtractedSourceTree(sourceRoot));
		writeJson(join(sourceRoot, '.framescaper-source-identity.json'), {
			schemaVersion: 1, component: row.id, version: row.version, revision: row.revision,
			archiveSha256: row.sha256, extractedTreeSha256: row.extractedTree.sha256,
			root: sourceRoot,
		});
	}
	writeJson(externalPath, external);
	provisionBoostSource(fixture, manifest);
}

function provisionBoostSource(fixture, manifest) {
	fixture.boostSourceRoot = join(fixture.root, 'boost-1.92.0');
	mkdirSync(join(fixture.boostSourceRoot, 'boost/multiprecision'), { recursive: true });
	writeFileSync(join(fixture.boostSourceRoot, 'boost/version.hpp'), '#define BOOST_VERSION 109200\n');
	writeFileSync(join(fixture.boostSourceRoot, 'boost/multiprecision/cpp_int.hpp'), '#pragma once\n');
	fixture.boostHeaderClosure = closureIdentity(collectBoostHeaderClosure(
		fixture.boostSourceRoot, ['boost/multiprecision/cpp_int.hpp'],
	));
	if (manifest.boost) manifest.boost.headerClosure = fixture.boostHeaderClosure;
	writeJson(join(fixture.boostSourceRoot, '.framescaper-source-identity.json'), {
		schemaVersion: 1, component: 'boost', version: '1.92.0',
		archiveSha256: manifest.boost?.archiveSha256 ?? BOOST_ARCHIVE_SHA256,
		headerClosureSha256: fixture.boostHeaderClosure.sha256,
		root: fixture.boostSourceRoot,
	});
}

function provisionMediaContract(fixture, boostHeaderClosure) {
	const actualRoot = join(repositoryRoot, 'native/framescaper-media-host');
	const mediaRoot = join(fixture.repositoryRoot, 'native/framescaper-media-host');
	const manifest = json(join(actualRoot, 'source-manifest.json'));
	const inputs = [
		'build/source-authentication.mjs',
		...listRelativeFiles(join(actualRoot, 'src')).map((path) => `src/${path}`),
	].sort();
	for (const path of inputs) {
		const destination = join(mediaRoot, path);
		mkdirSync(dirname(destination), { recursive: true });
		copyFileSync(join(actualRoot, path), destination);
	}
	manifest.sourceFiles = sourcePins(mediaRoot, inputs);
	manifest.boost.headerClosure = boostHeaderClosure;
	writeJson(join(mediaRoot, 'source-manifest.json'), manifest);
	fixture.mediaContractRoot = mediaRoot;
}

function provisionOpenFxSource(fixture, manifest) {
	fixture.openfxSourceRoot = join(fixture.root, 'openfx-1.5.1');
	mkdirSync(join(fixture.openfxSourceRoot, 'include'), { recursive: true });
	for (const header of ['ofxCore.h', 'ofxImageEffect.h', 'ofxProperty.h', 'ofxParam.h']) {
		writeFileSync(join(fixture.openfxSourceRoot, 'include', header), `/* ${header} */\n`);
	}
	manifest.openfx.extractedTree = closureIdentity(
		collectExtractedSourceTree(fixture.openfxSourceRoot),
	);
	writeJson(join(fixture.openfxSourceRoot, '.framescaper-source-identity.json'), {
		schemaVersion: 1, component: 'openfx', version: '1.5.1',
		commitSha: manifest.openfx.commitSha, archiveSha256: manifest.openfx.sha256,
		extractedTreeSha256: manifest.openfx.extractedTree.sha256,
		root: fixture.openfxSourceRoot,
	});
	provisionBoostSource(fixture, manifest);
}
