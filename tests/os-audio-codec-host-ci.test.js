/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import {
	mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	ELECTRON_HEADERS_CI_SOURCE,
	authenticateElectronHeadersTree,
	canonicalMacosSdkRoot,
	downloadPinnedElectronHeaders,
	resolveOsAudioCodecHostCiTarget,
	runOsAudioCodecHostCi,
} from '../scripts/lib/os-audio-codec-host-ci.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const REDIRECT_URL =
	'https://artifacts.electronjs.org/headers/dist/v43.1.1/node-v43.1.1-headers.tar.gz';

test('CI accepts only the exact Electron 43.1.1 archive and extracted tree', async (context) => {
	assert.deepEqual(ELECTRON_HEADERS_CI_SOURCE, {
		version: '43.1.1',
		requestUrl: 'https://electronjs.org/headers/v43.1.1/node-v43.1.1-headers.tar.gz',
		redirectUrl: REDIRECT_URL,
		archive: {
			fileName: 'node-v43.1.1-headers.tar.gz', byteLength: 344_774,
			sha256: 'b1112989ad4c4807a6bf59bfc96ce8d0f0b16962efe9818fa768e5908cc24d21',
		},
		extractedTree: {
			algorithm: 'framescaper-portable-source-tree-sha256-v1', fileCount: 124,
			sha256: '9eae0a9eb7630b1b53f98e4b7c69951aee2a159ff1f564eeed06b78580de62eb',
		},
	});
	const temporary = await mkdtemp(join(tmpdir(), 'soundscaper-codec-ci-auth-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	const destination = join(temporary, ELECTRON_HEADERS_CI_SOURCE.archive.fileName);
	const wrong = Buffer.alloc(ELECTRON_HEADERS_CI_SOURCE.archive.byteLength);
	await assert.rejects(downloadPinnedElectronHeaders({
		destination,
		fetchImpl: async () => response(wrong, { url: 'https://electronjs.org/unreviewed-redirect' }),
	}), /URL and length/iu);
	await assert.rejects(downloadPinnedElectronHeaders({
		destination,
		fetchImpl: async () => response(wrong),
	}), /digest/iu);
	await assert.rejects(readFile(destination), /ENOENT/u,
		'unauthenticated partial downloads must be removed.');

	const tree = join(temporary, 'node_headers');
	await mkdir(join(tree, 'include/node'), { recursive: true });
	await writeFile(join(tree, 'include/node/node_api.h'), 'not the admitted tree\n');
	assert.throws(() => authenticateElectronHeadersTree(tree), /extracted tree/iu);
});

test('CI target resolution is target-native and excludes Linux and macOS x64', () => {
	assert.equal(resolveOsAudioCodecHostCiTarget({
		desktopPlatform: 'win', desktopArch: 'x64', runnerOs: 'Windows', runnerArch: 'X64',
	}), 'win-x64');
	assert.equal(resolveOsAudioCodecHostCiTarget({
		desktopPlatform: 'win', desktopArch: 'arm64', runnerOs: 'Windows', runnerArch: 'ARM64',
	}), 'win-arm64');
	assert.equal(resolveOsAudioCodecHostCiTarget({
		desktopPlatform: 'mac', desktopArch: 'arm64', runnerOs: 'macOS', runnerArch: 'ARM64',
	}), 'mac-arm64');
	for (const candidate of [
		{ desktopPlatform: 'mac', desktopArch: 'x64', runnerOs: 'macOS', runnerArch: 'X64' },
		{ desktopPlatform: 'linux', desktopArch: 'x64', runnerOs: 'Linux', runnerArch: 'X64' },
		{ desktopPlatform: 'linux', desktopArch: 'arm64', runnerOs: 'Linux', runnerArch: 'ARM64' },
		{ desktopPlatform: 'win', desktopArch: 'arm64', runnerOs: 'Windows', runnerArch: 'X64' },
	]) assert.throws(() => resolveOsAudioCodecHostCiTarget(candidate), /target-native/iu);
});

test('CI orchestration keeps all inputs and outputs in RUNNER_TEMP and publishes only a verified result', async (context) => {
	const runnerTemp = await mkdtemp(join(tmpdir(), 'soundscaper-codec-ci-runner-'));
	context.after(() => rm(runnerTemp, { recursive: true, force: true }));
	const githubEnvironmentPath = join(runnerTemp, 'github-env');
	await writeFile(githubEnvironmentPath, 'EXISTING=value\n');
	const calls = [];
	const result = await runOsAudioCodecHostCi({
		repositoryRoot: ROOT, runnerTemp, githubEnvironmentPath,
		desktopPlatform: 'win', desktopArch: 'arm64',
		runnerOs: 'Windows', runnerArch: 'ARM64',
	}, {
		async download({ destination }) {
			calls.push('download');
			await writeFile(destination, 'authenticated fixture', { flag: 'wx' });
		},
		async extract({ archivePath, extractionRoot, headersRoot }) {
			calls.push('extract');
			assert.equal(dirname(archivePath), dirname(extractionRoot));
			await mkdir(join(headersRoot, 'include/node'), { recursive: true });
			await writeFile(join(headersRoot, 'include/node/node_api.h'), 'fixture\n');
		},
		runBuild({ command, arguments: arguments_, plan }) {
			calls.push('build');
			assert.equal(command, process.execPath);
			assert.equal(arguments_.includes('--target=win-arm64'), true);
			assert.equal(arguments_.some((value) => value.startsWith('--macos-sdk=')), false);
			return writeFile(plan.resultPath, '{}\n', { flag: 'wx' });
		},
		async verifyResult({ resultPath, repositoryRoot, signingIdentity, target }) {
			calls.push('verify');
			assert.equal(repositoryRoot, ROOT);
			assert.equal(signingIdentity, undefined);
			assert.equal(target, 'win-arm64');
			assert.equal(String(await readFile(resultPath)), '{}\n');
		},
	});
	assert.deepEqual(calls, ['download', 'extract', 'build', 'verify']);
	assert.equal(result.target, 'win-arm64');
	assert.equal(result.workspace.startsWith(`${runnerTemp}${process.platform === 'win32' ? '\\' : '/'}`), true);
	assert.equal(result.resultPath.startsWith(result.workspace), true);
	assert.equal(String(await readFile(githubEnvironmentPath)), [
		'EXISTING=value',
		`SOUNDSCAPER_OS_AUDIO_CODEC_BUILD_RESULT=${result.resultPath}`,
		'SOUNDSCAPER_REQUIRE_OS_AUDIO_CODEC_NATIVE=true',
		'',
	].join('\n'));
});

test('macOS CI binds the canonical SDK and ad-hoc signing before publishing the result', async (context) => {
	const runnerTemp = await mkdtemp(join(tmpdir(), 'soundscaper-codec-ci-mac-'));
	context.after(() => rm(runnerTemp, { recursive: true, force: true }));
	const githubEnvironmentPath = join(runnerTemp, 'github-env');
	const sdkPath = join(runnerTemp, 'MacOSX.sdk');
	await Promise.all([writeFile(githubEnvironmentPath, ''), mkdir(sdkPath)]);
	let buildArguments = null;
	await runOsAudioCodecHostCi({
		repositoryRoot: ROOT, runnerTemp, githubEnvironmentPath,
		desktopPlatform: 'mac', desktopArch: 'arm64', runnerOs: 'macOS', runnerArch: 'ARM64',
	}, {
		async download({ destination }) { await writeFile(destination, 'fixture', { flag: 'wx' }); },
		async extract({ headersRoot }) {
			await mkdir(join(headersRoot, 'include/node'), { recursive: true });
			await writeFile(join(headersRoot, 'include/node/node_api.h'), 'fixture\n');
		},
		resolveMacosSdk: async () => sdkPath,
		async runBuild({ arguments: arguments_, plan }) {
			buildArguments = arguments_;
			await writeFile(plan.resultPath, '{}\n', { flag: 'wx' });
		},
		verifyResult: async ({ repositoryRoot, signingIdentity, target }) => {
			assert.equal(repositoryRoot, ROOT);
			assert.equal(signingIdentity, '-');
			assert.equal(target, 'mac-arm64');
		},
	});
	assert.ok(buildArguments);
	assert.equal(buildArguments.includes(`--macos-sdk=${sdkPath}`), true);
	assert.equal(buildArguments.some((value) => value.startsWith('--signing-identity=')), false);
	assert.equal(String(await readFile(githubEnvironmentPath)).includes(
		'SOUNDSCAPER_REQUIRE_OS_AUDIO_CODEC_NATIVE=true\n',
	), true);
});

test('CI refuses to append a handoff beyond the bounded GITHUB_ENV size', async (context) => {
	const runnerTemp = await mkdtemp(join(tmpdir(), 'soundscaper-codec-ci-env-limit-'));
	context.after(() => rm(runnerTemp, { recursive: true, force: true }));
	const githubEnvironmentPath = join(runnerTemp, 'github-env');
	await writeFile(githubEnvironmentPath, Buffer.alloc(1024 * 1024, 0x78));
	await assert.rejects(runOsAudioCodecHostCi({
		repositoryRoot: ROOT, runnerTemp, githubEnvironmentPath,
		desktopPlatform: 'win', desktopArch: 'x64', runnerOs: 'Windows', runnerArch: 'X64',
	}, {
		async download({ destination }) { await writeFile(destination, 'fixture', { flag: 'wx' }); },
		async extract({ headersRoot }) {
			await mkdir(join(headersRoot, 'include/node'), { recursive: true });
			await writeFile(join(headersRoot, 'include/node/node_api.h'), 'fixture\n');
		},
		async runBuild({ plan }) { await writeFile(plan.resultPath, '{}\n', { flag: 'wx' }); },
		verifyResult: async () => {},
	}), /handoff exceeds/iu);
	assert.equal((await readFile(githubEnvironmentPath)).byteLength, 1024 * 1024);
});

test('all OS-capable package paths build the codec host while Linux receives no payload', async () => {
	const [workflow, ciEntry] = await Promise.all([
		readFile(join(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8'),
		readFile(join(ROOT, 'scripts/ci-build-os-audio-codec-host.mjs'), 'utf8'),
	]);
	assert.equal(workflow.match(/node scripts\/ci-build-os-audio-codec-host\.mjs/gu)?.length, 3);
	for (const argument of [
		'--desktop-platform=${{ matrix.target.platform }}',
		'--desktop-arch=${{ matrix.target.arch }}',
		'--runner-os=${{ runner.os }}',
		'--runner-arch=${{ runner.arch }}',
	]) assert.equal(workflow.match(new RegExp(escapeRegExp(argument), 'gu'))?.length, 3, argument);
	const packageJob = jobSource(workflow, 'package', 'milestone-5-handoff-matrix');
	assert.match(packageJob,
		/if: matrix\.product == 'soundscaper' && matrix\.target\.platform != 'linux'[\s\S]*ci-build-os-audio-codec-host/u);
	const testsJob = jobSource(workflow, 'package-with-tests', 'soundscaper-project-library-lease-matrix');
	assert.match(testsJob,
		/if: matrix\.target\.platform != 'linux'[\s\S]*ci-build-os-audio-codec-host/u);
	const leaseJob = jobSource(workflow, 'soundscaper-project-library-lease-matrix', null);
	assert.match(leaseJob,
		/if: matrix\.target\.platform != 'linux'[\s\S]*ci-build-os-audio-codec-host/u);
	assert.doesNotMatch(workflow, /mac-x64|SOUNDSCAPER_OS_AUDIO_CODEC_BUILD_RESULT:\s*[^$\n]/u);
	assert.doesNotMatch(ciEntry, /SIGNING_IDENTITY|certificate|notari/iu);
});

test('pull-request quality compiles every supported Windows and macOS native target', async () => {
	const workflow = await readFile(join(ROOT, '.github/workflows/quality.yml'), 'utf8');
	const compileJob = jobSource(workflow, 'native-platform-compile', 'tests');
	assert.match(compileJob, /needs: quality/u);
	assert.match(compileJob,
		/- runner: windows-2025\n\s+platform: win\n\s+arch: x64\n\s+node_arch: x64\n\s+cmake_arch: x64\n\s+native_target: win-x64/u);
	assert.match(compileJob,
		/- runner: windows-11-arm\n\s+platform: win\n\s+arch: arm64\n\s+node_arch: x64\n\s+cmake_arch: ARM64\n\s+native_target: win-arm64/u);
	assert.match(compileJob,
		/- runner: macos-15\n\s+platform: mac\n\s+arch: arm64\n\s+node_arch: arm64\n\s+native_target: mac-arm64/u);
	assert.doesNotMatch(compileJob, /runner: ubuntu|platform: linux/u);
	assert.match(compileJob, /node scripts\/ci-build-os-audio-codec-host\.mjs/u);
	for (const argument of [
		'--desktop-platform=${{ matrix.target.platform }}',
		'--desktop-arch=${{ matrix.target.arch }}',
		'--runner-os=${{ runner.os }}',
		'--runner-arch=${{ runner.arch }}',
	]) assert.match(compileJob, new RegExp(escapeRegExp(argument), 'u'), argument);
	const windowsConfigure = stepSource(compileJob,
		'Configure the Windows isolation launcher', 'Configure the macOS isolation launcher');
	assert.match(windowsConfigure, /cmake -S native\/milestone-5-native-isolation-launcher/u);
	assert.match(windowsConfigure, /-A \$\{\{ matrix\.target\.cmake_arch \}\}/u);
	assert.match(windowsConfigure,
		/-DSOUNDSCAPER_NATIVE_TARGET=\$\{\{ matrix\.target\.native_target \}\}/u);
	const macosConfigure = stepSource(compileJob,
		'Configure the macOS isolation launcher', 'Compile the target-native isolation launcher');
	assert.match(macosConfigure, /-DCMAKE_OSX_ARCHITECTURES=arm64/u);
	assert.match(macosConfigure,
		/-DSOUNDSCAPER_NATIVE_TARGET=\$\{\{ matrix\.target\.native_target \}\}/u);

	const coverageJob = jobSource(workflow, 'coverage', 'browser');
	assert.match(coverageJob, /needs: \[tests, native-platform-compile\]/u);
	const deployJob = jobSource(workflow, 'deploy', null);
	assert.match(deployJob, /needs: \[[^\]]*native-platform-compile[^\]]*\]/u);
});

test('the macOS SDK alias resolves to the versioned directory it names', async (context) => {
	// xcrun reports .../SDKs/MacOSX.sdk, which Xcode ships as a symbolic alias for
	// the versioned SDK. Rejecting the alias outright failed the macOS codec build
	// on every runner before it configured anything.
	const temporary = await mkdtemp(join(tmpdir(), 'soundscaper-codec-ci-sdk-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	const versioned = join(temporary, 'MacOSX15.5.sdk');
	const alias = join(temporary, 'MacOSX.sdk');
	await mkdir(versioned);
	await symlink(versioned, alias);

	assert.equal(await canonicalMacosSdkRoot(alias), await realpath(versioned));
	assert.equal(await canonicalMacosSdkRoot(versioned), await realpath(versioned));

	const file = join(temporary, 'MacOSX.txt');
	await writeFile(file, 'not an SDK\n');
	await assert.rejects(canonicalMacosSdkRoot(file), /canonical non-symbolic directory/iu);
	await assert.rejects(canonicalMacosSdkRoot('SDKs/MacOSX.sdk'), /absolute normalized path/iu);
});

function response(bytes, options = {}) {
	return {
		ok: true, status: 200, url: options.url ?? REDIRECT_URL,
		headers: { get: (name) => name.toLowerCase() === 'content-length' ? String(bytes.byteLength) : null },
		body: {
			async *[Symbol.asyncIterator]() { yield bytes; },
		},
	};
}

function jobSource(workflow, name, next) {
	const start = workflow.indexOf(`  ${name}:\n`);
	assert.notEqual(start, -1, name);
	const end = next === null ? workflow.length : workflow.indexOf(`  ${next}:\n`, start + 1);
	assert.notEqual(end, -1, next);
	return workflow.slice(start, end);
}

function stepSource(job, name, next) {
	const start = job.indexOf(`      - name: ${name}\n`);
	assert.notEqual(start, -1, name);
	const end = job.indexOf(`      - name: ${next}\n`, start + 1);
	assert.notEqual(end, -1, next);
	return job.slice(start, end);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
