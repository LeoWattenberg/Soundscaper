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
 * Build a fixture register. `withdrawn` names a source whose Milestone 9
 * acceptance remains pending; authenticated build inputs must still be usable.
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
		run: () => ({ status: 0, stderr: '', stdout: '' }),
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
		m9ReleaseReview: { status: 'complete', sourceIds: [], pendingSources: [] },
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

test('the reviewed register reports complete Milestone 9 review for every professional source', async (context) => {
	// The owner's recorded native-audio and native-plugins review accepted all
	// six professional sources, so the plan must no longer report any blocked
	// row. Execution is still gated elsewhere; only activation is asserted here.
	const { archives, manifestPath, roots } = await sourceRoots(context, null);
	const plan = createSoundscaperProfessionalNativeBuildPlan({
		repositoryRoot: ROOT, target: 'linux-x64', sourceRoots: roots, sourceArchives: archives,
		sourceManifestPath: manifestPath,
		sourceSnapshotRoot: await createSnapshotParent(roots.juce, 'snapshots-reviewed'),
		buildRoot: join(roots.juce, '..', 'build-reviewed'),
	});
	const review = structuredClone(plan.m9ReleaseReview);
	// Snapshots are taken read-only, so they are released the way the build
	// itself releases them; the fixture's own cleanup cannot remove them.
	for (const snapshot of plan.sourceAuthentication) removeMilestone5NativeSourceSnapshot(snapshot);
	assert.equal(review.status, 'complete');
	assert.deepEqual(review.pendingSources, []);
	// ASIO is absent because it is Windows-only, not because it is unreviewed.
	assert.deepEqual([...review.sourceIds].sort(), [
		'clap', 'electron-node-api-headers', 'juce', 'lv2', 'vst3-sdk',
	]);
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

test('trusted audio stays in Node while real plug-ins execute only through the isolated peer', async () => {
	const [cmake, api, audio, jucePlugin, clap, nodeBridge, peer, professional, dispatcher] = await Promise.all([
		readFile(join(ROOT, 'native/soundscaper-professional-host/CMakeLists.txt'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/professional_host_api.h'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/juce_audio_adapter.cpp'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/juce_plugin_adapter.cpp'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/direct_clap_adapter.cpp'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/node_api_bridge.cpp'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/professional_host_peer.cpp'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/professional_host.cpp'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/juce_message_dispatcher.cpp'), 'utf8'),
	]);
	assert.match(cmake, /JUCE_PLUGINHOST_VST3=1/u);
	assert.match(cmake, /JUCE_PLUGINHOST_AU=1/u);
	assert.match(cmake, /JUCE_PLUGINHOST_LV2=1/u);
	assert.match(cmake, /JUCE_ASIO=1/u);
	assert.match(cmake, /SOUNDSCAPER_PIPEWIRE_SYSTEM_ABI_ADAPTER=1/u);
	assert.match(cmake, /SOUNDSCAPER_JACK_DISCOVERY_ONLY=1/u);
	assert.match(cmake, /SOUNDSCAPER_PRO_BUILD=1/u);
	assert.match(cmake, /add_library\(soundscaper_professional_node MODULE/u);
	assert.match(cmake, /target_link_libraries\(soundscaper_professional_node PRIVATE soundscaper_professional_audio\)/u);
	assert.match(cmake, /target_link_libraries\(soundscaper_professional_peer PRIVATE soundscaper_professional_plugin\)/u);
	assert.match(cmake, /SOUNDSCAPER_NODE_API_INCLUDE/u);
	assert.match(cmake, /OUTPUT_NAME "soundscaper_professional"[\s\S]*SUFFIX "\.node"/u);
	assert.match(cmake, /pipewire_session\.c/u);
	assert.match(cmake, /juce_message_dispatcher\.cpp/u);
	assert.match(api, /SOUNDSCAPER_PRO_API __attribute__\(\(visibility\("default"\)\)\)/u);
	assert.match(api, /SOUNDSCAPER_PRO_API soundscaper_pro_status soundscaper_pro_audio_enumerate/u);
	assert.match(api, /soundscaper_pro_plugin_scan[\s\S]*capacity[\s\S]*written/u);
	assert.match(api, /soundscaper_pro_plugin_open[\s\S]*stable_id/u);
	assert.match(audio, /createAudioDeviceTypes/u);
	assert.match(audio, /device->open/u);
	assert.match(audio, /audioDeviceIOCallbackWithContext/u);
	assert.match(audio, /class PeriodRing/u);
	assert.match(audio, /audioDeviceStopped\(\).*stopped\.store/u);
	assert.match(audio, /audioDeviceError\(.*failed\.store/u);
	assert.match(jucePlugin, /findAllTypesForFile/u);
	assert.match(jucePlugin, /stableId/u);
	assert.match(jucePlugin, /stableId\.size\(\) >= SOUNDSCAPER_PRO_MAX_TEXT/u);
	assert.doesNotMatch(jucePlugin, /descriptions\.size\(\) != 1/u);
	assert.match(jucePlugin, /processBlock/u);
	assert.match(jucePlugin, /getStateInformation/u);
	assert.match(jucePlugin, /setContentOwned\(&editor, true\)/u);
	assert.match(clap, /CLAP_PLUGIN_FACTORY_ID/u);
	assert.match(clap, /plugin->process/u);
	assert.match(clap, /CLAP_EXT_STATE/u);
	assert.match(clap, /CLAP_EXT_GUI/u);
	assert.match(clap, /CLAP_EXT_AUDIO_PORTS/u);
	assert.match(clap, /audioPorts->count/u);
	assert.match(clap, /audioPorts->get/u);
	assert.doesNotMatch(clap, /get_plugin_count\(loaded->factory\) != 1/u);
	assert.match(clap, /std::strlen\(descriptor->id\) >= SOUNDSCAPER_PRO_MAX_TEXT/u);
	assert.match(clap, /plugin->on_main_thread/u);
	assert.match(clap, /postJuceMessageTask/u);
	assert.match(dispatcher, /ScopedJuceInitialiser_GUI/u);
	assert.match(dispatcher, /runDispatchLoop/u);
	assert.match(dispatcher, /maximumPendingTasks/u);
	for (const method of [
		'describe', 'enumerateAudioBackends', 'openAudioDevice', 'writeAudioDevice',
		'readAudioDevice', 'closeAudioDevice', 'listPluginCandidates',
	]) assert.match(nodeBridge, new RegExp(`"${method}"`, 'u'));
	for (const method of [
		'inspectPluginCandidate', 'openPluginInstance', 'processPluginBlock',
		'pluginLatencyFrames', 'savePluginState', 'loadPluginState',
		'openPluginVendorWindow', 'closePluginVendorWindow',
	]) assert.doesNotMatch(nodeBridge, new RegExp(`"${method}"`, 'u'));
	assert.doesNotMatch(nodeBridge, /soundscaper_pro_plugin_/u);
	assert.match(peer, /soundscaper_pro_plugin_scan/u);
	assert.match(peer, /soundscaper_pro_plugin_open/u);
	assert.match(peer, /std::count_if[\s\S]*stable_id/u);
	assert.match(peer, /Operation::vendor: return vendor\(reader, writer\)/u);
	assert.match(peer, /soundscaper_pro_plugin_open_vendor_window/u);
	assert.match(peer, /soundscaper_pro_plugin_close_vendor_window/u);
	assert.match(peer, /vendorWindowId_/u);
	assert.match(professional, /soundscaper_audio_stream_open/u);
	assert.match(professional, /soundscaper_audio_backend_enumerate/u);
	assert.match(professional, /dispatchJuceMessageTask/u);
});

test('target builds select concrete Linux, fail-closed macOS Seatbelt and Windows AppContainer launchers', async () => {
	const [cmake, mac, windows, runtime, windowsAuthority, macProfile, windowsProfile] = await Promise.all([
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/CMakeLists.txt'), 'utf8'),
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/src/macos_launcher.mm'), 'utf8'),
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/src/windows_launcher.cpp'), 'utf8'),
		readFile(join(ROOT, 'desktop/native-child-isolation-launcher.ts'), 'utf8'),
		readFile(join(ROOT, 'desktop/native-child-windows-authority.ts'), 'utf8'),
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/profiles/macos-v1.sb'), 'utf8'),
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/profiles/windows-v1.json'), 'utf8'),
	]);
	assert.match(cmake, /set\(CMAKE_CXX_STANDARD 17\)/u);
	assert.match(cmake, /set\(CMAKE_CXX_STANDARD_REQUIRED ON\)/u);
	assert.match(cmake, /set\(CMAKE_CXX_EXTENSIONS OFF\)/u);
	assert.match(cmake, /set\(CMAKE_OBJCXX_STANDARD 17\)/u);
	assert.match(cmake, /set\(CMAKE_OBJCXX_STANDARD_REQUIRED ON\)/u);
	assert.match(cmake, /set\(CMAKE_OBJCXX_EXTENSIONS OFF\)/u);
	assert.match(cmake, /elseif\(APPLE\)[\s\S]*macos_launcher\.mm[\s\S]*-lsandbox/u);
	assert.match(cmake, /elseif\(WIN32\)[\s\S]*windows_launcher\.cpp[\s\S]*advapi32 userenv/u);
	assert.match(mac, /#include <cstdint>/u);
	assert.match(mac, /#include <utility>/u);
	assert.match(windows, /#include <utility>/u);
	assert.match(mac, /F_GETPATH/u);
	assert.match(mac, /sandbox_init/u);
	assert.match(mac, /allow process-exec \(literal [\s\S]*pathFor\(value\.executableFd\)/u);
	assert.match(mac, /const auto policy = profile\(value\);[\s\S]*exactText\(value\.brokerFd, 4096u\) != expectedBroker[\s\S]*enterSandbox\(policy\)/u);
	assert.match(mac, /Darwin has no supported atomic executable-FD operation[\s\S]*machine availability must remain false/u);
	assert.doesNotMatch(mac, /\bsameFile\b/u);
	assert.doesNotMatch(mac, /\b(?:fexecve|execve|posix_spawn)\s*\(/u);
	assert.doesNotMatch(mac, /\bwrite\s*\(\s*value\.attestationFd/u);
	assert.match(mac, /diagnostic ignored "-Wdeprecated-declarations"/u);
	assert.match(mac, /setrlimit\(RLIMIT_AS/u);
	assert.match(mac, /--extra-input-fd=/u);
	assert.match(macProfile, /\(deny default\)/u);
	assert.doesNotMatch(macProfile, /coreaudiod/u);
	assert.match(windows, /DeriveAppContainerSidFromAppContainerName/u);
	assert.match(windows, /--authority-profile=/u);
	assert.match(windows, /soundscaper-professional|framescaper-media|framescaper-openfx/u);
	assert.match(windows, /PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES/u);
	assert.match(windows, /PROC_THREAD_ATTRIBUTE_HANDLE_LIST/u);
	assert.match(windows, /SetEntriesInAclW/u);
	assert.match(windows, /sameFile\(source, handle\)/u);
	assert.doesNotMatch(windows, /class AclLease|originalAcl|~AclLease/u,
		'a crash-safe exact AppContainer grant must never rely on launcher-exit DACL restoration');
	assert.match(windows, /cbReserved2/u);
	assert.match(windows, /--extra-input-fd=/u);
	assert.match(windows, /JOB_OBJECT_LIMIT_ACTIVE_PROCESS/u);
	assert.match(windows, /AssignProcessToJobObject/u);
	assert.match(windowsProfile, /appcontainer-low-integrity/u);
	assert.match(runtime, /soundscaper-macos-seatbelt-broker-v1/u);
	assert.match(runtime, /soundscaper-windows-appcontainer-job-v1/u);
	assert.match(runtime, /windowsAuthorityProfile[\s\S]*brand[\s\S]*workloadPayload[\s\S]*runtimeClosure/u);
	assert.match(windowsAuthority,
		/brand: input\.brand[\s\S]*workloadPayload: artifactBinding[\s\S]*runtimeClosure: sortedBindings[\s\S]*value\.sha256/u);
	assert.match(windowsProfile, /brand-and-machine-workload-payload-bound-appcontainer-low-integrity/u);
	assert.doesNotMatch(runtime, /if \(!target\.startsWith\('linux-'\)/u);
});

/**
 * Every assertion here failed before the JUCE 9 port: the recipe named SDK
 * directories the pinned JUCE revision does not contain, and the host called
 * three APIs JUCE 9 removed or never exposed. Nothing caught it because the
 * plan's own fixture was built in the shape the recipe expected, so the two
 * agreed with each other and disagreed only with JUCE.
 */
test('the professional host builds against the JUCE revision it actually pins', async () => {
	const [cmake, buildRecipe, pluginAdapter, audioAdapter] = await Promise.all([
		readFile(join(ROOT, 'native/soundscaper-professional-host/CMakeLists.txt'), 'utf8'),
		readFile(join(ROOT, 'scripts/lib/soundscaper-professional-native-build.mjs'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/juce_plugin_adapter.cpp'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/juce_audio_adapter.cpp'), 'utf8'),
	]);

	// JUCE 9 vendors every hosted format's SDK under the headless module. The
	// pre-9 directory is absent from JUCE 9.0.1, so naming it was a configure
	// failure on the first line CMake reached, for all five targets.
	for (const source of [cmake, buildRecipe]) {
		assert.match(source, /juce_audio_processors_headless\/format_types\/VST3_SDK/u);
		assert.doesNotMatch(source, /juce_audio_processors\/format_types\/VST3_SDK/u,
			'the pre-JUCE-9 VST3 SDK directory does not exist in the pinned revision');
	}

	// LV2 1.18.10 keeps its headers under `include/`, so `<lv2/core/lv2.h>`
	// resolves from there and from nowhere else in the authenticated tree.
	assert.match(buildRecipe, /const LV2_INCLUDE_ROOT = 'include';/u);
	assert.match(cmake, /SOUNDSCAPER_LV2_ROOT\}\/lv2\/core\/lv2\.h/u);

	// `addDefaultFormats` is `= delete` in JUCE 9, and its replacements register
	// every format JUCE can build rather than the ones this target compiled in.
	assert.doesNotMatch(pluginAdapter, /manager\.addDefaultFormats\s*\(/u);
	assert.match(pluginAdapter, /registerCompiledFormats/u);
	for (const [guard, format] of [
		['JUCE_PLUGINHOST_VST3', 'VST3PluginFormat'],
		['JUCE_PLUGINHOST_AU', 'AudioUnitPluginFormat'],
		['JUCE_PLUGINHOST_LV2', 'LV2PluginFormat'],
	]) {
		assert.match(pluginAdapter, new RegExp(`#if ${guard}\\s*\\n\\s*manager\\.addFormat\\(std::make_unique<juce::${format}>\\(\\)\\);`, 'u'),
			`${format} must be registered only when ${guard} compiled it in`);
	}
	// CLAP is hosted through the direct ABI adapter and must never be reachable
	// as a JUCE format, or the isolation story would have two different doors.
	assert.doesNotMatch(pluginAdapter, /CLAPPluginFormat/u);

	// `createAudioDeviceTypes` is a protected virtual; calling it as a static
	// never compiled, and building one requested type is also the narrower act.
	assert.doesNotMatch(audioAdapter, /juce::AudioDeviceManager::createAudioDeviceTypes\s*\(/u);
	assert.match(audioAdapter, /createAudioIODeviceType_ALSA/u);
	assert.match(audioAdapter, /createAudioIODeviceType_WASAPI/u);
	assert.match(audioAdapter, /createAudioIODeviceType_CoreAudio/u);

	// `createDevice` returns an owning raw pointer and every refusal below it
	// returns early, so adopting it at the call is what stops those leaks.
	assert.match(audioAdapter,
		/std::unique_ptr<juce::AudioIODevice> device\(type->createDevice\(outputName, inputName\)\);/u);

	// juce_gui_extra pulls in GTK and WebKit for a browser this host never shows.
	assert.match(cmake, /JUCE_WEB_BROWSER=0/u);
	assert.match(cmake, /JUCE_USE_CURL=0/u);
});
