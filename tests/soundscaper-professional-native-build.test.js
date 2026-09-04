/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { create as createTar } from 'tar';

import {
	canonicalSoundscaperProfessionalNativeMacosSdkPath,
	createSoundscaperProfessionalNativeBuildPlan,
	executeSoundscaperProfessionalNativeBuild,
	resolveSoundscaperProfessionalNativeRunnerTarget,
} from '../scripts/lib/soundscaper-professional-native-build.mjs';
import { collectExtractedSourceTree } from '../native/framescaper-media-host/build/source-authentication.mjs';
import { removeMilestone5NativeSourceSnapshot } from '../scripts/lib/milestone-5-native-source-acquisitions.mjs';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * The exact directory JUCE 9.0.1 vendors the VST3 SDK into. JUCE 9 moved every
 * hosted format's SDK under the headless audio-processors module, so a fixture
 * built in the pre-9 shape agrees with a recipe that can never configure — which
 * is how the wrong path survived here unnoticed.
 */
const JUCE_VST3_SDK_CLOSURE = 'modules/juce_audio_processors_headless/format_types/VST3_SDK';
const JUCE_VST3_VERSION_HEADER = `${JUCE_VST3_SDK_CLOSURE}/pluginterfaces/vst/vsttypes.h`;

test('target CMake uses a closed runtime strategy on macOS and Windows', async () => {
	const [professional, isolation, codec] = await Promise.all([
		readFile(join(ROOT, 'native/soundscaper-professional-host/CMakeLists.txt'), 'utf8'),
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/CMakeLists.txt'), 'utf8'),
		readFile(join(ROOT, 'native/os-audio-codec-host/CMakeLists.txt'), 'utf8'),
	]);
	assert.match(professional, /INSTALL_RPATH\s+"@loader_path\/runtime"/u);
	for (const source of [professional, isolation, codec]) {
		assert.match(source, /CMAKE_MSVC_RUNTIME_LIBRARY[^\n]*MultiThreaded/u);
	}
});

test('the professional Windows addon resolves Electron Node-API exports without node.lib', async () => {
	const [cmake, bridge, runtime] = await Promise.all([
		readFile(join(ROOT, 'native/soundscaper-professional-host/CMakeLists.txt'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/node_api_bridge.cpp'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/node_api_runtime.h'), 'utf8'),
	]);
	assert.match(bridge, /node_api_runtime\.h/u);
	assert.match(runtime, /GetModuleHandleW/u);
	assert.match(runtime, /GetProcAddress/u);
	assert.match(runtime, /soundscaperNodeApiAvailable/u);
	assert.doesNotMatch(cmake, /node\.lib/iu);
});

test('professional runner authority closes the exact five target-native runner pairs', () => {
	for (const [target, runnerOs, runnerArch] of [
		['linux-x64', 'Linux', 'X64'],
		['linux-arm64', 'Linux', 'ARM64'],
		['mac-arm64', 'macOS', 'ARM64'],
		['win-x64', 'Windows', 'X64'],
		['win-arm64', 'Windows', 'ARM64'],
	]) assert.equal(resolveSoundscaperProfessionalNativeRunnerTarget({
		target, runnerOs, runnerArch,
	}), target);
	assert.throws(() => resolveSoundscaperProfessionalNativeRunnerTarget({
		target: 'win-arm64', runnerOs: 'Windows', runnerArch: 'X64',
	}), /target-native.*runner|runner.*target/iu);
	assert.throws(() => resolveSoundscaperProfessionalNativeRunnerTarget({
		target: 'mac-arm64', runnerOs: 'macOS', runnerArch: undefined,
	}), /target-native.*runner|runner.*target/iu);
});

test('the professional macOS SDK input resolves Xcode\'s moving alias once', async (context) => {
	const temporary = await mkdtemp(join(tmpdir(), 'soundscaper-pro-sdk-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	const versioned = join(temporary, 'MacOSX15.5.sdk');
	const alias = join(temporary, 'MacOSX.sdk');
	await mkdir(versioned);
	await symlink(versioned, alias);
	const canonical = await realpath(versioned);
	assert.equal(canonicalSoundscaperProfessionalNativeMacosSdkPath(alias), canonical);
	assert.equal(canonicalSoundscaperProfessionalNativeMacosSdkPath(versioned), canonical);
	const file = join(temporary, 'MacOSX.txt');
	await writeFile(file, 'not an SDK\n');
	assert.throws(() => canonicalSoundscaperProfessionalNativeMacosSdkPath(file),
		/canonical non-symbolic directory/iu);
	assert.throws(() => canonicalSoundscaperProfessionalNativeMacosSdkPath('MacOSX.sdk'),
		/absolute normalized path/iu);
});

/**
 * Build a fixture register. `withdrawn` names a source whose distribution
 * disposition is unresolved; authenticated build inputs must still be usable.
 */
async function sourceRoots(context, withdrawn = 'juce', embeddedVst3Version = '3.8.0') {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-pro-sources-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const roots = {
		'electron-node-api-headers': join(root, 'electron-node-api-headers'),
		juce: join(root, 'juce'), clap: join(root, 'clap'),
		'vst3-sdk': join(root, 'vst3-sdk'),
		'asio-sdk': join(root, 'asio-sdk'), lv2: join(root, 'lv2'),
	};
	for (const path of [
		join(roots['electron-node-api-headers'], 'include/node/node_api.h'),
		join(roots.juce, 'CMakeLists.txt'),
		join(roots.juce, 'modules/juce_audio_processors/format_types/juce_VST3PluginFormat.cpp'),
		join(roots.juce, JUCE_VST3_SDK_CLOSURE, '.closure'),
		join(roots.juce, JUCE_VST3_VERSION_HEADER),
		join(roots.clap, 'include/clap/clap.h'),
		join(roots['vst3-sdk'], 'README.md'),
		join(roots['asio-sdk'], 'common/asio.h'),
		join(roots.lv2, 'include/lv2/core/lv2.h'),
	]) {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, path.endsWith('vsttypes.h')
			? `#define kVstVersionString\t"VST ${embeddedVst3Version}"\t///< SDK version for PClassInfo2\n`
			: 'authenticated fixture\n');
	}
	const register = JSON.parse(await readFile(
		join(ROOT, 'config/milestone-5-native-source-acquisitions.json'),
		'utf8',
	));
	const archives = {};
	for (const [id, sourceRoot] of Object.entries(roots)) {
		const archiveName = `${id}-fixture.tar.gz`;
		const archivePath = join(root, archiveName);
		createTar({
			cwd: dirname(sourceRoot), file: archivePath, gzip: true, sync: true,
		}, [basename(sourceRoot)]);
		const bytes = await readFile(archivePath);
		const tree = collectExtractedSourceTree(sourceRoot);
		const row = register.sources.find((source) => source.id === id);
		row.archive.fileName = archiveName;
		row.archive.byteLength = bytes.byteLength;
		row.archive.sha256 = sha256(bytes);
		row.extractedTree = {
			algorithm: tree.algorithm, fileCount: tree.fileCount, sha256: tree.sha256,
		};
		archives[id] = archivePath;
	}
	if (withdrawn !== null) {
		const row = register.sources.find((source) => source.id === withdrawn);
		row.activationStatus = 'blocked';
		row.blockedBy = `The ${withdrawn} activation is withdrawn for this fixture.`;
	}
	const manifestPath = join(root, 'source-register.json');
	await writeFile(manifestPath, `${JSON.stringify(register, null, 2)}\n`);
	return { archives, manifestPath, roots };
}

test('professional build plans bind exact SDK pins and never treat the VST3 meta archive as a closure', async (context) => {
	const fixture = await sourceRoots(context);
	const { archives, manifestPath, roots } = fixture;
	assert.throws(() => createSoundscaperProfessionalNativeBuildPlan({
		repositoryRoot: ROOT, target: 'linux-x64', sourceRoots: roots,
		sourceManifestPath: manifestPath,
		buildRoot: join(roots.juce, '..', 'build-without-archives'),
	}), /sourceArchives/iu);
	const linux = createSoundscaperProfessionalNativeBuildPlan({
		repositoryRoot: ROOT, target: 'linux-x64', sourceRoots: roots, sourceArchives: archives,
		sourceManifestPath: manifestPath,
		sourceSnapshotRoot: await createSnapshotParent(roots.juce, 'snapshots-linux'),
		buildRoot: join(roots.juce, '..', 'build-linux'),
	});
	assert.deepEqual(linux.features.audioStreaming, ['pipewire', 'alsa']);
	assert.deepEqual(linux.features.discoveryOnly, ['jack']);
	assert.deepEqual(linux.features.plugins, ['vst3', 'clap', 'lv2']);
	assert.deepEqual(linux.vst3Closure, {
		kind: 'juce-embedded-sdk',
		root: join(linux.sourceSnapshotRoot, 'juce', JUCE_VST3_SDK_CLOSURE),
		version: '3.8.0',
		versionHeaderSha256: sha256(Buffer.from(
			'#define kVstVersionString\t"VST 3.8.0"\t///< SDK version for PClassInfo2\n',
		)),
		provenanceOnlySourceId: 'vst3-sdk',
		commit: '9fad9770f2ae8542ab1a548a68c1ad1ac690abe0',
	});
	assert.match(linux.configure.argv.join(' '), /SOUNDSCAPER_LV2_ROOT/u);
	assert.deepEqual(linux.configure.argv.slice(4, 6), ['-G', 'Ninja']);
	assert.match(linux.configure.argv.join(' '), /SOUNDSCAPER_NODE_API_INCLUDE=.*electron-node-api-headers/u);
	assert.equal(linux.configure.argv.some((argument) => Object.values(roots).some((root) => argument.includes(root))), false,
		'CMake may consume only auditor-owned source snapshots.');
	assert.doesNotMatch(linux.configure.argv.join(' '), /vst3-sdk(?:\/|\\)/u);
	assert.deepEqual(executeSoundscaperProfessionalNativeBuild(linux, {
		run: (_command, _arguments, options) => (assert.equal(options.maxBuffer, 8 * 1024 * 1024), { status: 0, stderr: '', stdout: '' }),
	}).status, 'built');
	const macosSdk = join(dirname(roots.juce), 'MacOSX15.5.sdk');
	const macosSdkAlias = join(dirname(roots.juce), 'MacOSX.sdk');
	await mkdir(macosSdk);
	await symlink(macosSdk, macosSdkAlias);
	const mac = createSoundscaperProfessionalNativeBuildPlan({
		repositoryRoot: ROOT, target: 'mac-arm64', sourceRoots: roots, sourceArchives: archives,
		sourceManifestPath: manifestPath, macosSdkPath: macosSdkAlias,
		sourceSnapshotRoot: await createSnapshotParent(roots.juce, 'snapshots-mac'),
		buildRoot: join(roots.juce, '..', 'build-mac'),
	});
	assert.deepEqual(mac.configure.argv.slice(4, 6), ['-G', 'Ninja']);
	assert.match(mac.configure.argv.join('\n'), /CMAKE_OSX_ARCHITECTURES=arm64/u);
	assert(mac.configure.argv.includes(`-DCMAKE_OSX_SYSROOT=${await realpath(macosSdk)}`));
	for (const snapshot of mac.sourceAuthentication) removeMilestone5NativeSourceSnapshot(snapshot);

	const windows = createSoundscaperProfessionalNativeBuildPlan({
		repositoryRoot: ROOT, target: 'win-x64', sourceRoots: roots, sourceArchives: archives,
		sourceManifestPath: manifestPath,
		sourceSnapshotRoot: await createSnapshotParent(roots.juce, 'snapshots-win'),
		buildRoot: join(roots.juce, '..', 'build-win'),
	});
	assert.deepEqual(windows.features.audioStreaming, ['wasapi', 'asio']);
	assert.deepEqual(windows.configure.argv.slice(4, 6), ['-A', 'x64']);
	assert.match(windows.configure.argv.join(' '), /CMAKE_SYSTEM_VERSION=10\.0\.26100/u);
	assert.match(windows.configure.argv.join(' '), /SOUNDSCAPER_ASIO_ROOT/u);
	assert.deepEqual(executeSoundscaperProfessionalNativeBuild(windows, {
		run: () => ({ status: 0, stderr: '', stdout: '' }),
	}).status, 'built');
	const windowsArm = createSoundscaperProfessionalNativeBuildPlan({
		repositoryRoot: ROOT, target: 'win-arm64', sourceRoots: roots, sourceArchives: archives,
		sourceManifestPath: manifestPath,
		sourceSnapshotRoot: await createSnapshotParent(roots.juce, 'snapshots-win-arm'),
		buildRoot: join(roots.juce, '..', 'build-win-arm'),
	});
	assert.deepEqual(windowsArm.configure.argv.slice(4, 6), ['-A', 'ARM64']);
	assert.equal(windowsArm.configure.argv.includes('-G'), false);
	for (const snapshot of windowsArm.sourceAuthentication) removeMilestone5NativeSourceSnapshot(snapshot);
	const windowsOverride = createSoundscaperProfessionalNativeBuildPlan({
		repositoryRoot: ROOT, target: 'win-x64', sourceRoots: roots, sourceArchives: archives,
		sourceManifestPath: manifestPath,
		sourceSnapshotRoot: await createSnapshotParent(roots.juce, 'snapshots-win-override'),
		buildRoot: join(roots.juce, '..', 'build-win-override'),
	});
	assert.equal(executeSoundscaperProfessionalNativeBuild(windowsOverride, {
		approvedActivation: true,
		run: () => ({ status: 0, stderr: '', stdout: '' }),
	}).status, 'built');
	assert.throws(() => executeSoundscaperProfessionalNativeBuild({
		...windows,
		target: 'win-arm64',
	}, {
		run: () => ({ status: 0, stderr: '', stdout: '' }),
	}), /authenticated build plan/u);
});

test('professional build refuses a JUCE embedded VST3 API other than exact 3.8.0', async (context) => {
	const { archives, manifestPath, roots } = await sourceRoots(context, null, '3.7.0');
	const sourceSnapshotRoot = await createSnapshotParent(roots.juce, 'snapshots-wrong-vst3');
	assert.throws(() => createSoundscaperProfessionalNativeBuildPlan({
		repositoryRoot: ROOT, target: 'linux-x64', sourceRoots: roots, sourceArchives: archives,
		sourceManifestPath: manifestPath,
		sourceSnapshotRoot,
		buildRoot: join(roots.juce, '..', 'build-wrong-vst3'),
	}), /embedded VST3.*3\.8\.0/iu);
});

test('a plan that fails after snapshotting removes the snapshots it took', async (context) => {
	const { archives, manifestPath, roots } = await sourceRoots(context);
	const sourceSnapshotRoot = await createSnapshotParent(roots.juce, 'snapshots-recovered');
	const request = {
		repositoryRoot: ROOT, target: 'linux-x64', sourceRoots: roots, sourceArchives: archives,
		sourceManifestPath: manifestPath, sourceSnapshotRoot,
	};
	// `buildRoot` is resolved after every source has been snapshotted, so omitting
	// it fails the plan at a point where the extracted trees are already on disk.
	assert.throws(() => createSoundscaperProfessionalNativeBuildPlan(request));
	// An empty parent is exactly what the next plan demands of it, so removing the
	// snapshots is what keeps the snapshot root usable after a failed attempt.
	assert.deepEqual(await readdir(sourceSnapshotRoot), [],
		'a failed plan must not leave its extracted sources behind');
});

async function createSnapshotParent(sourceRoot, name) {
	const path = join(sourceRoot, '..', name);
	await mkdir(path, { recursive: false });
	return path;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
