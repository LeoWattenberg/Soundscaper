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
	closureIdentity, json, listRelativeFiles, sha256, sourcePins, writeJson,
} from './helpers/framescaper-native-host-build-fixture.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const SOURCE_DATE_EPOCH = 1786492800;
const BOOST_ARCHIVE_SHA256 = '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c';
const MEDIA_INPUTS = Object.freeze([
	'CMakeLists.txt', 'CMakePresets.json', 'build/external-source-authentication.mjs',
	'build/ffmpeg-9.0.1-configure.json', 'build/ffmpeg-9.0.1-external-sources.json',
	'build/recipe-driver.mjs', 'build/source-authentication.mjs', 'build/targets.json',
	...FRAMESCAPER_MEDIA_HOST_BUILD_TARGETS.map(({ toolchainFile }) => toolchainFile),
].sort());
const OPENFX_INPUTS = Object.freeze([
	'CMakeLists.txt', 'CMakePresets.json', 'build/recipe-driver.mjs',
	'build/source-authentication.mjs', 'build/targets.json',
	...FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS.map(({ toolchainFile }) => toolchainFile),
].sort());

test('both recipes own exactly five pending targets and FFmpeg starts from a closed component set', () => {
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
			assert.equal(row.status, 'pending-external');
			assert.equal(row.toolchainIdentity, null);
			assert.match(row.blockedBy, /authenticated.*payload.*built/iu);
			assert.doesNotMatch(row.blockedBy,
				/licens|review|readiness|signing|notari|qualification|manual|patent|notice/iu);
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
	assert.equal(configuration.configureFlags[0], '--disable-everything');
	assert.deepEqual(configuration.configureFlags.filter((flag) => /--enable-(?:decoder|encoder|demuxer|muxer|protocol)=/u.test(flag)), [
		'--enable-decoder=prores', '--enable-decoder=pcm_f32le',
		'--enable-decoder=png', '--enable-decoder=tiff', '--enable-decoder=exr',
		'--enable-encoder=prores_ks', '--enable-encoder=pcm_s16le',
		'--enable-encoder=png', '--enable-encoder=tiff', '--enable-encoder=exr',
		'--enable-demuxer=mov', '--enable-demuxer=wav',
		'--enable-muxer=mov', '--enable-muxer=image2',
		'--enable-protocol=file', '--enable-protocol=pipe',
	]);
	assert.deepEqual(configuration.policy.externalLibraries, []);
	assert.equal(configuration.policy.rawFfmpegArguments, false);
	assert.equal(configuration.policy.network, false);
	assert.match(configuration.configureFlags.join('\n'), /png.*tiff.*exr/isu);
	assert.doesNotMatch(configuration.configureFlags.join('\n'), /libx264|libvpx|hevc|av1/iu);
	assert.equal(configuration.policy.payloadPublicationRequiresAuthenticatedTargetEvidence, true);
	assert.equal(configuration.policy.humanReviewMilestone, 9);
	const external = validateFramescaperMediaHostExternalSourceManifest(json(join(
		repositoryRoot, 'native/framescaper-media-host/build/ffmpeg-9.0.1-external-sources.json',
	)));
	assert.equal(external.activation, 'test-enabled');
	assert.deepEqual(external.libraries.map(({ id }) => id), FRAMESCAPER_MEDIA_HOST_EXTERNAL_SOURCE_IDS);
	assert.ok(external.libraries.every(({ sha256, extractedTree }) => (
		/^[a-f0-9]{64}$/u.test(sha256) && /^[a-f0-9]{64}$/u.test(extractedTree.sha256)
	)));
});

test('all five media and OpenFX targets emit immutable closed dry-run recipes', (context) => {
	for (const target of FRAMESCAPER_MEDIA_HOST_BUILD_TARGETS) {
		const fixture = buildFixture(context, 'media', target.id);
		const recipe = createFramescaperMediaHostBuildRecipe(fixture.options);
		assertRecipe(recipe, target, [
			'ffmpeg-configure', 'ffmpeg-build', 'ffmpeg-install',
			'host-configure', 'host-build', 'host-install',
		]);
		const configure = recipe.commands[0];
		assert.equal(configure.args[1], '--disable-everything');
		assert.ok(!configure.args.includes('--enable-cross-compile'),
			`${target.id} recipe is admitted only on its matching native host`);
		assert.ok(configure.args.includes(`--prefix=${join(fixture.outputRoot, 'ffmpeg-install')}`));
		assert.ok(configure.args.includes(`--cc=${fixture.executables.c.path}`));
		assert.ok(recipe.commands[3].args.includes(`-DBOOST_ROOT=${fixture.boostSourceRoot}`));
		assert.deepEqual(readdirSync(fixture.outputRoot), []);
	}
	for (const target of FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS) {
		const fixture = buildFixture(context, 'openfx', target.id);
		const recipe = createFramescaperOpenFxHostBuildRecipe(fixture.options);
		assertRecipe(recipe, target, ['host-configure', 'host-build', 'host-install']);
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
		} });
		assert.deepEqual(calls.map(({ args }) => args), recipe.commands.map(({ args }) => [...args]));
		assert.ok(calls.every(({ executable }) => Object.values(fixture.executables).some(
			(tool) => tool.path === executable,
		)));
		assert.equal(readFileSync(payload, 'utf8'), '{"targets":{}}\n');
		assert.equal(recipe.payloadManifestMutation, false);
		assert.throws(() => execute(recipe, { run: () => ({ status: 0 }) }), /fresh authentic/u);
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
	assert.throws(() => createFramescaperOpenFxHostBuildRecipe(overclaim.options), /pending-external/u);

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
	const ffmpeg = buildFixture(context, 'media', 'linux-x64');
	const configurationPath = join(ffmpeg.hostRoot, 'build/ffmpeg-9.0.1-configure.json');
	const configuration = json(configurationPath);
	configuration.configureFlags.push('--enable-decoder=h264');
	writeJson(configurationPath, configuration);
	refreshPins(ffmpeg);
	assert.throws(() => createFramescaperMediaHostBuildRecipe(ffmpeg.options), /configure recipe is not closed/u);

	const preset = buildFixture(context, 'openfx', 'linux-x64');
	const presetPath = join(preset.hostRoot, 'CMakePresets.json');
	const presets = json(presetPath);
	presets.configurePresets[1].cacheVariables = { FRAMESCAPER_OPENFX_SOURCE_ROOT: '$env{HOME}' };
	writeJson(presetPath, presets);
	refreshPins(preset);
	assert.throws(() => createFramescaperOpenFxHostBuildRecipe(preset.options), /CMake presets drifted/u);

	const toolchain = buildFixture(context, 'media', 'linux-x64');
	const toolchainPath = join(toolchain.hostRoot, 'build/toolchains/linux-x64.cmake');
	appendFileSync(toolchainPath, 'set(CMAKE_CXX_COMPILER /ambient/compiler)\n');
	refreshPins(toolchain);
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

test('source-tree authentication admits genuine SDK names and rejects nonportable entries', (context) => {
	const accepted = mkdtempSync(join(tmpdir(), 'framescaper-portable-source-'));
	context.after(() => rmSync(accepted, { recursive: true, force: true }));
	mkdirSync(join(accepted, 'docs'));
	for (const path of [
		'docs/CMake API.md', 'Icon-29@3x.png', 'juce_(generated)+source~1.cpp', 'hash#percent%.txt',
	]) {
		writeFileSync(join(accepted, ...path.split('/')), path);
	}
	assert.deepEqual(collectExtractedSourceTree(accepted).files.map(({ path }) => path), [
		'Icon-29@3x.png', 'docs/CMake API.md', 'hash#percent%.txt', 'juce_(generated)+source~1.cpp',
	]);

	for (const name of ['bad:name', 'bad\\name', 'trailing.', 'trailing ', 'CON', 'lpt1.txt', 'line\nbreak']) {
		const rejected = mkdtempSync(join(tmpdir(), 'framescaper-nonportable-source-'));
		context.after(() => rmSync(rejected, { recursive: true, force: true }));
		writeFileSync(join(rejected, name), 'bytes');
		assert.throws(() => collectExtractedSourceTree(rejected), /portable canonical path segment/u);
	}
	const collision = mkdtempSync(join(tmpdir(), 'framescaper-case-source-'));
	context.after(() => rmSync(collision, { recursive: true, force: true }));
	writeFileSync(join(collision, 'Case.h'), 'upper');
	writeFileSync(join(collision, 'case.h'), 'lower');
	if (readdirSync(collision).length === 2) {
		assert.throws(() => collectExtractedSourceTree(collision), /not portable across target filesystems/u);
	}
	const linked = mkdtempSync(join(tmpdir(), 'framescaper-linked-source-'));
	context.after(() => rmSync(linked, { recursive: true, force: true }));
	writeFileSync(join(linked, 'actual.h'), 'bytes');
	symlinkSync(join(linked, 'actual.h'), join(linked, 'alias.h'));
	assert.throws(() => collectExtractedSourceTree(linked), /canonical regular file/u);
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

	const openfx = buildFixture(context, 'openfx', openfxTarget.id);
	const openfxRecipe = createFramescaperOpenFxHostBuildRecipe(openfx.options);
	appendFileSync(join(openfx.openfxSourceRoot, 'include/ofxParam.h'), '/* drift */\n');
	let calls = 0;
	assert.throws(() => executeFramescaperOpenFxHostBuildRecipe(openfxRecipe, {
		run: () => { calls += 1; return { status: 0 }; },
	}), /drifted from its pinned content closure/iu);
	assert.equal(calls, 0);
});

function assertRecipe(recipe, target, phases) {
	assert.deepEqual(recipe.target.id, target.id);
	assert.equal(recipe.target.runtime, target.runtime);
	assert.equal(recipe.target.hostRuntime, target.hostRuntime);
	assert.equal(recipe.payloadManifestMutation, false);
	assert.deepEqual(recipe.commands.map(({ phase }) => phase), phases);
	assert.ok(Object.isFrozen(recipe));
	assert.ok(Object.isFrozen(recipe.commands));
	for (const command of recipe.commands) {
		assert.ok(Object.isFrozen(command));
		assert.ok(command.args.every((argument) => !/curl|wget|git clone|https?:/iu.test(argument)));
		assert.equal(command.environment.SOURCE_DATE_EPOCH, String(SOURCE_DATE_EPOCH));
		assert.equal(command.environment.TZ, 'UTC');
		assert.equal(command.environment.LC_ALL, 'C');
	}
}

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
			writeFileSync(destination, 'cmake_minimum_required(VERSION 3.30)\n');
		}
		else copyFileSync(join(actualHost, path), destination);
	}
	const manifest = json(join(actualHost, 'source-manifest.json'));
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
	writeJson(manifestPath, manifest);
	fixture.options = kind === 'media' ? {
		repositoryRoot: repositoryRootFixture, targetId, hostRuntime: target.hostRuntime,
		toolchainReceipt: toolchain.receipt, toolchainIdentity: toolchain.identity,
		ffmpegSourceRoot: fixture.ffmpegSourceRoot, boostSourceRoot: fixture.boostSourceRoot,
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
		? ['ar', 'c', 'cmake', 'cxx', 'make', 'ninja', 'pkgConfig', 'ranlib', 'shell']
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

function refreshPins(fixture) {
	const manifest = json(fixture.manifestPath);
	manifest.sourceFiles = sourcePins(fixture.hostRoot, fixture.inputs);
	writeJson(fixture.manifestPath, manifest);
}
