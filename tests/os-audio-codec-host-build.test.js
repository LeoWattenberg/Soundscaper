/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { create as createTar } from 'tar';

import {
	OS_AUDIO_CODEC_HOST_SOURCE_FILES,
	OS_AUDIO_CODEC_HOST_TARGETS,
	createOsAudioCodecHostBuildPlan,
	executeOsAudioCodecHostBuild,
	osAudioCodecHostBuildPlanIdentity,
} from '../scripts/lib/os-audio-codec-host-build.mjs';
import { collectExtractedSourceTree } from '../native/framescaper-media-host/build/source-authentication.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const NATIVE_ROOT = join(ROOT, 'native/os-audio-codec-host');
const PROFESSIONAL_ROOT = join(ROOT, 'native/soundscaper-professional-host');

test('the codec-only CMake and Node-API surfaces have no device or plug-in authority', async () => {
	const [cmake, bridge, buildScript, packageJson] = await Promise.all([
		readFile(join(NATIVE_ROOT, 'CMakeLists.txt'), 'utf8'),
		readFile(join(NATIVE_ROOT, 'src/node_api_bridge.cpp'), 'utf8'),
		readFile(join(ROOT, 'scripts/build-os-audio-codec-host.mjs'), 'utf8'),
		readFile(join(ROOT, 'package.json'), 'utf8'),
	]);
	for (const source of [
		'os_audio_codec.h', 'os_aac_m4a_profile.cpp', 'os_mp3_profile.cpp',
		'os_audio_codec_windows.cpp', 'os_mp3_encode_windows.cpp', 'os_audio_codec_mac.mm',
	]) assert.match(cmake, new RegExp(source.replace('.', '\\.'), 'u'), source);
	assert.match(cmake, /if\(APPLE\)[\s\S]*arm64[\s\S]*AudioToolbox[\s\S]*CoreFoundation/u);
	assert.match(cmake, /elseif\(WIN32\)[\s\S]*x64[\s\S]*ARM64[\s\S]*mfplat[\s\S]*mfreadwrite[\s\S]*mfuuid[\s\S]*ole32/u);
	assert.match(cmake, /else\(\)[\s\S]*support only Windows x64, Windows ARM64, and macOS ARM64/u);
	assert.doesNotMatch(cmake, /os_audio_codec_unavailable|linux|mac-x64|x86_64/iu);
	assert.doesNotMatch(`${cmake}\n${bridge}`, /JUCE|CLAP|VST3|ASIO|plug-?in|audio[_-]device/iu);
	assert.match(cmake, /soundscaper_os_mp3_profile_self_test/u);
	assert.match(cmake, /soundscaper_os_audio_codec_self_test/u);
	assert.match(cmake, /include\(CTest\)/u);

	const exports = [...bridge.matchAll(/\{\s*"([A-Za-z0-9]+)",\s*nullptr,/gu)]
		.map((match) => match[1]);
	assert.deepEqual(exports, [
		'decodeOperatingSystemMp3', 'decodeOperatingSystemAacM4a',
		'encodeOperatingSystemAacM4a', 'encodeOperatingSystemMp3',
	]);
	assert.match(bridge, /GetProcAddress/u,
		'Windows resolves Electron Node-API exports without an unpinned node.lib.');
	assert.match(buildScript, /'result'/u);
	assert.match(buildScript, /O_EXCL/u);
	assert.match(buildScript, /Build result output is not one new regular file/u);
	assert.equal(JSON.parse(packageJson).scripts['build:os-audio-codec-host'],
		'node scripts/build-os-audio-codec-host.mjs');
});

test('build plans authenticate exact Electron 43.1.1 headers and close the target matrix', async (context) => {
	assert.deepEqual(OS_AUDIO_CODEC_HOST_TARGETS, ['mac-arm64', 'win-x64', 'win-arm64']);
	assert.deepEqual(OS_AUDIO_CODEC_HOST_SOURCE_FILES, [
		'native/os-audio-codec-host/CMakeLists.txt',
		'native/os-audio-codec-host/src/node_api_bridge.cpp',
		'native/soundscaper-professional-host/src/os_aac_m4a_profile.cpp',
		'native/soundscaper-professional-host/src/os_aac_m4a_profile.h',
		'native/soundscaper-professional-host/src/os_audio_codec.h',
		'native/soundscaper-professional-host/src/os_audio_codec_mac.mm',
		'native/soundscaper-professional-host/src/os_audio_codec_windows.cpp',
		'native/soundscaper-professional-host/src/os_mp3_encode_windows.cpp',
		'native/soundscaper-professional-host/src/os_mp3_profile.cpp',
		'native/soundscaper-professional-host/src/os_mp3_profile.h',
		'native/soundscaper-professional-host/tests/os_audio_codec_self_test.cpp',
		'native/soundscaper-professional-host/tests/os_mp3_profile_self_test.cpp',
		'scripts/build-os-audio-codec-host.mjs',
		'scripts/lib/os-audio-codec-host-build.mjs',
	]);
	const register = JSON.parse(await readFile(
		join(ROOT, 'config/milestone-5-native-source-acquisitions.json'), 'utf8',
	));
	const electron = register.sources.find(({ id }) => id === 'electron-node-api-headers');
	assert.deepEqual({
		version: electron.version, tag: electron.git.tag, commit: electron.git.commit,
		url: electron.archive.url, fileName: electron.archive.fileName,
		byteLength: electron.archive.byteLength, sha256: electron.archive.sha256,
		fileCount: electron.extractedTree.fileCount, treeSha256: electron.extractedTree.sha256,
	}, {
		version: '43.1.1', tag: 'v43.1.1', commit: null,
		url: 'https://electronjs.org/headers/v43.1.1/node-v43.1.1-headers.tar.gz',
		fileName: 'node-v43.1.1-headers.tar.gz', byteLength: 344_774,
		sha256: 'b1112989ad4c4807a6bf59bfc96ce8d0f0b16962efe9818fa768e5908cc24d21',
		fileCount: 124,
		treeSha256: '9eae0a9eb7630b1b53f98e4b7c69951aee2a159ff1f564eeed06b78580de62eb',
	});
	const fixture = await electronHeaderFixture(context);
	for (const target of ['linux-x64', 'linux-arm64', 'mac-x64']) {
		assert.throws(() => createOsAudioCodecHostBuildPlan({
			repositoryRoot: ROOT, target,
		}), /supports only mac-arm64, win-x64, and win-arm64/iu);
	}

	const windows = plan(fixture, 'win-x64', 'windows-one');
	assert.deepEqual(windows.configure.argv.slice(4, 8), [
		'-G', 'Visual Studio 17 2022', '-A', 'x64',
	]);
	assert.match(windows.configure.argv.join('\n'), /CMAKE_SYSTEM_VERSION=10\.0\.26100/u);
	assert.match(windows.configure.argv.join('\n'), /electron-node-api-headers\/include\/node/u);
	assert.doesNotMatch(windows.configure.argv.join('\n'), /juce|clap|vst3|asio/iu);
	assert.equal(windows.artifactPath, join(windows.installRoot, 'soundscaper_os_audio_codec.node'));
	assert.deepEqual(windows.nativeCanary, {
		command: 'ctest', argv: ['--test-dir', windows.buildRoot, '-C', 'Release', '--output-on-failure', '--no-tests=error'],
	});

	const arm = plan(fixture, 'win-arm64', 'windows-arm');
	assert.equal(arm.configure.argv.includes('ARM64'), true);
	const macSdk = join(fixture.root, 'MacOSX.sdk');
	await mkdir(macSdk);
	const mac = plan(fixture, 'mac-arm64', 'mac', { macosSdkPath: macSdk });
	assert.deepEqual(mac.configure.argv.slice(4, 6), ['-G', 'Ninja']);
	assert.match(mac.configure.argv.join('\n'), /CMAKE_OSX_ARCHITECTURES=arm64/u);
	assert.match(mac.configure.argv.join('\n'), /CMAKE_OSX_SYSROOT=/u);

	const second = plan(fixture, 'win-x64', 'windows-two');
	assert.deepEqual(osAudioCodecHostBuildPlanIdentity(windows),
		osAudioCodecHostBuildPlanIdentity(second),
		'ephemeral work and authenticated snapshot paths must not change the build-plan digest.');
	assert.equal(windows.sourceIdentity.sha256, second.sourceIdentity.sha256);
});

test('execution emits a bounded immutable artifact, plan, source, toolchain and canary descriptor', async (context) => {
	const fixture = await electronHeaderFixture(context);
	const buildPlan = plan(fixture, 'win-arm64', 'execution');
	const commands = [];
	const result = executeOsAudioCodecHostBuild(buildPlan, {
		run(command, argv) {
			commands.push([command, ...argv]);
			if (argv.includes('-S')) {
				mkdirSync(buildPlan.buildRoot, { recursive: true });
				writeFileSync(join(buildPlan.buildRoot, 'soundscaper-os-audio-codec-toolchain.json'),
					JSON.stringify({
						cmake: '3.31.6', generator: 'Visual Studio 17 2022',
						cxxCompilerId: 'MSVC', cxxCompilerVersion: '19.44.35207.1',
						systemName: 'Windows', systemProcessor: 'ARM64',
					}));
			}
			if (argv[0] === '--install') {
				mkdirSync(buildPlan.installRoot, { recursive: true });
				writeFileSync(buildPlan.artifactPath, Buffer.from('exact-addon-fixture'));
			}
			return { status: 0, signal: null, error: undefined, stdout: '', stderr: '' };
		},
	});
	assert.deepEqual(commands.map(([command]) => command), ['cmake', 'cmake', 'ctest', 'cmake']);
	assert.deepEqual(result, {
		schemaVersion: 1, status: 'built', target: 'win-arm64',
		artifact: {
			path: buildPlan.artifactPath, byteLength: 19,
			sha256: sha256(Buffer.from('exact-addon-fixture')),
		},
		electronHeaders: {
			version: '43.1.1',
			archive: fixture.headerIdentity.archive,
			extractedTree: fixture.headerIdentity.extractedTree,
		},
		sourceIdentity: buildPlan.sourceIdentity,
		sourceRevision: buildPlan.sourceIdentity.sha256,
		buildPlan: osAudioCodecHostBuildPlanIdentity(buildPlan),
		buildPlanSha256: osAudioCodecHostBuildPlanIdentity(buildPlan).sha256,
		toolchainIdentity: {
			cmake: '3.31.6', generator: 'Visual Studio 17 2022',
			cxxCompilerId: 'MSVC', cxxCompilerVersion: '19.44.35207.1',
			systemName: 'Windows', systemProcessor: 'ARM64',
		},
		nativeCanary: { status: 'passed', testCommand: 'ctest' },
	});
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.artifact), true);
	assert.throws(() => executeOsAudioCodecHostBuild({ ...buildPlan }, {
		run: () => ({ status: 0, stdout: '', stderr: '' }),
	}), /authenticated build plan/iu);
});

test('the portable exact MP3 profile canary remains buildable without a target OS SDK', (context) => {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++20 compiler is unavailable.');
		return;
	}
	const temporary = mkdtempSync(join(tmpdir(), 'soundscaper-codec-host-portable-'));
	context.after(() => rmSync(temporary, { recursive: true, force: true }));
	const executable = join(temporary, 'mp3-profile-self-test');
	const built = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Werror',
		'-I', join(PROFESSIONAL_ROOT, 'src'),
		join(PROFESSIONAL_ROOT, 'src/os_mp3_profile.cpp'),
		join(PROFESSIONAL_ROOT, 'tests/os_mp3_profile_self_test.cpp'),
		'-o', executable,
	], { encoding: 'utf8' });
	assert.equal(built.status, 0, built.stderr || built.stdout);
	const executed = spawnSync(executable, [], { encoding: 'utf8' });
	assert.equal(executed.status, 0, executed.stderr || executed.stdout);
});

async function electronHeaderFixture(context) {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-codec-host-headers-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const sourceRoot = join(root, 'node_headers');
	const nodeApiPath = join(sourceRoot, 'include/node/node_api.h');
	await mkdir(dirname(nodeApiPath), { recursive: true });
	await writeFile(nodeApiPath, '/* exact Node-API fixture */\n');
	const archiveName = 'electron-node-api-fixture.tar.gz';
	const archivePath = join(root, archiveName);
	createTar({ cwd: root, file: archivePath, gzip: true, sync: true }, [basename(sourceRoot)]);
	const archive = readFileSync(archivePath);
	const tree = collectExtractedSourceTree(sourceRoot);
	const register = JSON.parse(readFileSync(
		join(ROOT, 'config/milestone-5-native-source-acquisitions.json'), 'utf8',
	));
	const row = register.sources.find(({ id }) => id === 'electron-node-api-headers');
	row.archive = {
		...row.archive, fileName: archiveName,
		byteLength: archive.byteLength, sha256: sha256(archive),
	};
	row.extractedTree = {
		algorithm: tree.algorithm, fileCount: tree.fileCount, sha256: tree.sha256,
	};
	const manifestPath = join(root, 'source-register.json');
	writeFileSync(manifestPath, `${JSON.stringify(register, null, 2)}\n`);
	return {
		root, sourceRoot, archivePath, manifestPath,
		headerIdentity: {
			archive: { byteLength: archive.byteLength, sha256: sha256(archive) },
			extractedTree: {
				algorithm: tree.algorithm, fileCount: tree.fileCount, sha256: tree.sha256,
			},
		},
	};
}

function plan(fixture, target, name, extra = {}) {
	const snapshotRoot = join(fixture.root, `${name}-snapshots`);
	mkdirSync(snapshotRoot);
	return createOsAudioCodecHostBuildPlan({
		repositoryRoot: ROOT, target,
		sourceManifestPath: fixture.manifestPath,
		electronHeadersArchivePath: fixture.archivePath,
		electronHeadersRoot: fixture.sourceRoot,
		sourceSnapshotRoot: snapshotRoot,
		buildRoot: join(fixture.root, `${name}-build`),
		installRoot: join(fixture.root, `${name}-install`),
		...extra,
	});
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
