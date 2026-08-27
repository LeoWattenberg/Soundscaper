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
	OS_AUDIO_CODEC_HOST_ADMITTED_GENERATORS,
	OS_AUDIO_CODEC_HOST_SOURCE_FILES,
	OS_AUDIO_CODEC_HOST_TARGETS,
	createOsAudioCodecHostBuildPlan,
	deriveOsAudioCodecHostPolicyIdentity,
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
	assert.match(buildScript, /'signing-identity'/u);
	assert.match(buildScript, /O_EXCL/u);
	assert.match(buildScript, /Build result output is not one new regular file/u);
	assert.match(buildScript, /JSON\.stringify\(value, null, 2\)/u,
		'the build CLI must emit the same canonical JSON grammar consumed by desktop staging');
	assert.equal(JSON.parse(packageJson).scripts['build:os-audio-codec-host'],
		'node scripts/build-os-audio-codec-host.mjs');
	const cli = join(ROOT, 'scripts/build-os-audio-codec-host.mjs');
	const common = [
		'--headers-archive=/missing/electron-headers.tar.gz',
		'--headers-root=/missing/electron-headers', '--output=/missing/output',
		'--result=/missing/result.json',
	];
	const windowsSigning = spawnSync(process.execPath, [
		cli, '--target=win-x64', '--signing-identity=-', ...common,
	], { encoding: 'utf8' });
	assert.notEqual(windowsSigning.status, 0);
	assert.match(windowsSigning.stderr, /must not be used for Windows builds/iu);
	const unsignedMac = spawnSync(process.execPath, [
		cli, '--target=mac-arm64', '--macos-sdk=/missing/MacOSX.sdk', ...common,
	], { encoding: 'utf8' });
	assert.notEqual(unsignedMac.status, 0);
	assert.match(unsignedMac.stderr, /signing-identity=.*required for mac-arm64/iu);
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
		'native/soundscaper-professional-host/src/os_audio_codec_windows_file_bytes.h',
		'native/soundscaper-professional-host/src/os_audio_codec_windows_session.h',
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
	const windowsPolicy = deriveOsAudioCodecHostPolicyIdentity({
		repositoryRoot: ROOT, sourceManifestPath: fixture.manifestPath, target: 'win-x64',
	});
	assert.deepEqual(windowsPolicy.sourceIdentity, windows.sourceIdentity);
	assert.deepEqual(windowsPolicy.electronHeaders, windows.electronHeaders);
	assert.deepEqual(windowsPolicy.buildPlan, windows.buildPlan);
	assert.deepEqual(windowsPolicy.signing, windows.signing);
	assert.deepEqual(windows.configure.argv.slice(4, 6), ['-A', 'x64']);
	assert.equal(windows.configure.argv.includes('-G'), false,
		'a pinned Visual Studio generator fails outright on the image that ships the other one.');
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
	assert.throws(() => plan(fixture, 'mac-arm64', 'mac-unsigned', {
		macosSdkPath: macSdk,
	}), /signing identity is required/iu);
	assert.throws(() => plan(fixture, 'win-x64', 'windows-signed', {
		signingIdentity: '-',
	}), /must not accept a signing identity/iu);
	const mac = plan(fixture, 'mac-arm64', 'mac', {
		macosSdkPath: macSdk, signingIdentity: '-',
	});
	const macPolicy = deriveOsAudioCodecHostPolicyIdentity({
		repositoryRoot: ROOT, sourceManifestPath: fixture.manifestPath,
		target: 'mac-arm64', signingIdentity: '-',
	});
	assert.deepEqual(macPolicy.buildPlan, mac.buildPlan);
	assert.deepEqual(macPolicy.signing, mac.signing);
	assert.deepEqual(mac.configure.argv.slice(4, 6), ['-G', 'Ninja']);
	assert.match(mac.configure.argv.join('\n'), /CMAKE_OSX_ARCHITECTURES=arm64/u);
	assert.match(mac.configure.argv.join('\n'), /CMAKE_OSX_SYSROOT=/u);
	assert.deepEqual(mac.signing, {
		mode: 'ad-hoc', identitySha256: sha256(Buffer.from('-')),
	});
	assert.deepEqual(mac.sign, {
		command: 'codesign', argv: ['--force', '--sign', '-', mac.artifactPath],
	});
	assert.deepEqual(mac.signatureVerification, {
		command: 'codesign', argv: ['--verify', '--strict', mac.artifactPath],
	});
	const developerIdentity =
		'Developer ID Application: Soundscaper $MACOS_SDK Test (ABCDE12345)';
	const production = plan(fixture, 'mac-arm64', 'mac-production', {
		macosSdkPath: macSdk, signingIdentity: developerIdentity,
	});
	assert.deepEqual(deriveOsAudioCodecHostPolicyIdentity({
		repositoryRoot: ROOT, sourceManifestPath: fixture.manifestPath,
		target: 'mac-arm64', signingIdentity: developerIdentity,
	}).buildPlan, production.buildPlan);
	assert.deepEqual(production.signing, {
		mode: 'developer-id', identitySha256: sha256(Buffer.from(developerIdentity)),
	});
	assert.equal(production.sign.argv[5], developerIdentity,
		'signing identities must not be interpreted as build-plan placeholders.');
	assert.deepEqual(production.sign.argv, [
		'--force', '--timestamp', '--options', 'runtime', '--sign', developerIdentity,
		production.artifactPath,
	]);
	assert.notEqual(production.buildPlan.sha256, mac.buildPlan.sha256);
	for (const signingIdentity of [
		'Apple Development: Soundscaper Test (ABCDE12345)',
		'Developer ID Application: Soundscaper Test\n(ABCDE12345)',
		`Developer ID Application: ${'x'.repeat(300)}`,
	]) assert.throws(() => plan(fixture, 'mac-arm64', `invalid-${signingIdentity.length}`, {
		macosSdkPath: macSdk, signingIdentity,
	}), /Developer ID Application/iu);

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
		signing: {
			mode: 'not-applicable', identitySha256: null,
			verificationStatus: 'not-applicable',
		},
	});
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.artifact), true);
	assert.throws(() => executeOsAudioCodecHostBuild({ ...buildPlan }, {
		run: () => ({ status: 0, stdout: '', stderr: '' }),
	}), /authenticated build plan/iu);
});

test('macOS signs and strictly verifies the installed addon before hashing it', async (context) => {
	const fixture = await electronHeaderFixture(context);
	const macSdk = join(fixture.root, 'MacOSX.sdk');
	await mkdir(macSdk);
	const buildPlan = plan(fixture, 'mac-arm64', 'signed-execution', {
		macosSdkPath: macSdk, signingIdentity: '-',
	});
	const commands = [];
	const unsigned = Buffer.from('unsigned-addon-fixture');
	const signed = Buffer.from('signed-addon-fixture');
	const result = executeOsAudioCodecHostBuild(buildPlan, {
		run(command, argv, options) {
			commands.push({ command, argv, shell: options.shell });
			if (argv.includes('-S')) {
				mkdirSync(buildPlan.buildRoot, { recursive: true });
				writeFileSync(join(buildPlan.buildRoot, 'soundscaper-os-audio-codec-toolchain.json'),
					JSON.stringify({
						cmake: '3.31.6', generator: 'Ninja', cxxCompilerId: 'AppleClang',
						cxxCompilerVersion: '17.0.0', systemName: 'Darwin',
						systemProcessor: 'arm64',
					}));
			}
			if (argv[0] === '--install') {
				mkdirSync(buildPlan.installRoot, { recursive: true });
				writeFileSync(buildPlan.artifactPath, unsigned);
			}
			if (command === 'codesign' && argv.includes('--sign')) {
				assert.deepEqual(argv, ['--force', '--sign', '-', buildPlan.artifactPath]);
				writeFileSync(buildPlan.artifactPath, signed);
			}
			return { status: 0, signal: null, error: undefined, stdout: '', stderr: '' };
		},
	});
	assert.deepEqual(commands.map(({ command }) => command), [
		'cmake', 'cmake', 'ctest', 'cmake', 'codesign', 'codesign',
	]);
	assert.equal(commands.every(({ shell }) => shell === false), true);
	assert.deepEqual(commands.at(-1).argv,
		['--verify', '--strict', buildPlan.artifactPath]);
	assert.deepEqual(result.artifact, {
		path: buildPlan.artifactPath, byteLength: signed.byteLength, sha256: sha256(signed),
	});
	assert.deepEqual(result.signing, {
		mode: 'ad-hoc', identitySha256: sha256(Buffer.from('-')),
		verificationStatus: 'passed',
	});
	assert.doesNotMatch(JSON.stringify(result), /Developer ID Application/u);
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

test('Media Foundation is shut down only by the guard every interface outlives', async () => {
	// A Media Foundation interface released after MFShutdown or CoUninitialize is
	// undefined behaviour, and it segfaulted the Windows codec self-test: the
	// source reader and its media types were declared after the lambda that shut
	// the platform down, so they were released last. The guard fixes the order by
	// construction — it is declared first, so it is destroyed last — but only for
	// as long as nothing else tears the platform down on its own.
	const windowsSources = OS_AUDIO_CODEC_HOST_SOURCE_FILES
		.filter((file) => /_windows(?:_session|_file_bytes)?\.(?:cpp|h)$/u.test(file));
	assert.equal(windowsSources.length, 4,
		'expected the Windows translation units and the headers they share');
	for (const relativePath of windowsSources) {
		const source = await readFile(join(ROOT, relativePath), 'utf8');
		const owned = relativePath.endsWith('os_audio_codec_windows_session.h');
		for (const call of ['MFStartup', 'MFShutdown', 'CoInitializeEx', 'CoUninitialize']) {
			assert.equal(source.includes(`${call}(`), owned,
				`${relativePath} must reach ${call} only through MediaFoundationSession`);
		}
		// Only a translation unit that talks to Media Foundation owns a session;
		// the shared headers are held to reaching none of it.
		if (owned || !relativePath.endsWith('.cpp')) continue;
		const guard = source.indexOf('MediaFoundationSession session;');
		assert.notEqual(guard, -1, `${relativePath} must own its platform through the guard`);
		const firstInterface = source.search(/\bComPtr</u);
		assert.ok(firstInterface > guard,
			`${relativePath} must declare the guard before any interface pointer it outlives`);
	}
});

test('the authenticated source closure is checked out identically on every runner', () => {
	// The closure digest is the build's provenance: it binds the artifact to the
	// exact bytes of these files. A Windows runner checks text out as CRLF unless
	// .gitattributes says otherwise, so the same commit would hash to a revision
	// no other checkout can reproduce. The sibling native hosts are already
	// pinned; ask git what it would do with each file of this one.
	const outcome = spawnSync('git', ['check-attr', 'eol', '--', ...OS_AUDIO_CODEC_HOST_SOURCE_FILES],
		{ cwd: ROOT, encoding: 'utf8' });
	assert.equal(outcome.status, 0, outcome.stderr);
	const declared = new Map(outcome.stdout.split('\n').filter(Boolean).map((line) => {
		const separator = line.lastIndexOf(': eol: ');
		return [line.slice(0, separator), line.slice(separator + ': eol: '.length)];
	}));
	assert.deepEqual(
		OS_AUDIO_CODEC_HOST_SOURCE_FILES.filter((file) => declared.get(file) !== 'lf'), [],
		'add the path to .gitattributes with "text eol=lf" before its bytes carry provenance');
});

test('the codec toolchain admits every Visual Studio release the runner images ship', async (context) => {
	// windows-2025 now ships only Visual Studio 2026 while windows-11-arm still
	// ships 2022, and GitHub rolls the two images independently. The build plan
	// lets CMake select the newest installed release and admits the reviewed set,
	// so a generator outside it still fails the build closed.
	assert.deepEqual(OS_AUDIO_CODEC_HOST_ADMITTED_GENERATORS, {
		'mac-arm64': ['Ninja'],
		'win-x64': ['Visual Studio 17 2022', 'Visual Studio 18 2026'],
		'win-arm64': ['Visual Studio 17 2022', 'Visual Studio 18 2026'],
	});

	const fixture = await electronHeaderFixture(context);
	const built = (name, generator) => {
		const buildPlan = plan(fixture, 'win-x64', name);
		return executeOsAudioCodecHostBuild(buildPlan, {
			run(command, argv) {
				if (argv.includes('-S')) {
					mkdirSync(buildPlan.buildRoot, { recursive: true });
					writeFileSync(join(buildPlan.buildRoot, 'soundscaper-os-audio-codec-toolchain.json'),
						JSON.stringify({
							cmake: '4.4.2', generator,
							cxxCompilerId: 'MSVC', cxxCompilerVersion: '19.50.36000.0',
							systemName: 'Windows', systemProcessor: 'AMD64',
						}));
				}
				if (argv[0] === '--install') {
					mkdirSync(buildPlan.installRoot, { recursive: true });
					writeFileSync(buildPlan.artifactPath, Buffer.from('exact-addon-fixture'));
				}
				return { status: 0, signal: null, error: undefined, stdout: '', stderr: '' };
			},
		});
	};
	assert.equal(built('vs2026', 'Visual Studio 18 2026').toolchainIdentity.generator,
		'Visual Studio 18 2026');
	assert.equal(built('vs2022', 'Visual Studio 17 2022').toolchainIdentity.generator,
		'Visual Studio 17 2022');
	assert.throws(() => built('mingw', 'MinGW Makefiles'),
		/toolchain identity does not match/iu);
});

test('every Windows translation unit in the codec build suppresses the min and max macros', async () => {
	// <windows.h> defines min and max as function-like macros unless NOMINMAX is
	// set first, which turns std::min, std::max and numeric_limits<T>::max() into
	// syntax errors rather than calls. WIN32_LEAN_AND_MEAN does not suppress them,
	// and the failure only appears on a Windows runner, so guard it from here.
	const sources = await Promise.all(OS_AUDIO_CODEC_HOST_SOURCE_FILES
		.filter((relativePath) => /\.(?:c|cpp|h|mm)$/u.test(relativePath))
		.map(async (relativePath) => [relativePath, await readFile(join(ROOT, relativePath), 'utf8')]));
	const windowsUnits = sources.filter(([, text]) => text.includes('#include <windows.h>'));
	assert.ok(windowsUnits.length > 0, 'expected the codec build to compile Windows translation units');
	for (const [relativePath, text] of windowsUnits) {
		assert.match(text.slice(0, text.indexOf('#include <windows.h>')), /^#define NOMINMAX$/mu,
			`${relativePath} must define NOMINMAX before it includes <windows.h>`);
	}
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
