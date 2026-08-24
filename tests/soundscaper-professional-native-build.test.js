/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { create as createTar } from 'tar';

import {
	createSoundscaperProfessionalNativeBuildPlan,
	executeSoundscaperProfessionalNativeBuild,
} from '../scripts/lib/soundscaper-professional-native-build.mjs';
import { collectExtractedSourceTree } from '../native/framescaper-media-host/build/source-authentication.mjs';

const ROOT = resolve(import.meta.dirname, '..');

async function sourceRoots(context) {
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
		join(roots.juce, 'modules/juce_audio_processors/format_types/VST3_SDK/.closure'),
		join(roots.clap, 'include/clap/clap.h'),
		join(roots['vst3-sdk'], 'README.md'),
		join(roots['asio-sdk'], 'common/asio.h'),
		join(roots.lv2, 'lv2/core/lv2.h'),
	]) {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, 'authenticated fixture\n');
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
		root: join(linux.sourceSnapshotRoot, 'juce/modules/juce_audio_processors/format_types/VST3_SDK'),
		provenanceOnlySourceId: 'vst3-sdk',
		commit: '9fad9770f2ae8542ab1a548a68c1ad1ac690abe0',
	});
	assert.match(linux.configure.argv.join(' '), /SOUNDSCAPER_LV2_ROOT/u);
	assert.match(linux.configure.argv.join(' '), /SOUNDSCAPER_NODE_API_INCLUDE=.*electron-node-api-headers/u);
	assert.equal(linux.configure.argv.some((argument) => Object.values(roots).some((root) => argument.includes(root))), false,
		'CMake may consume only auditor-owned source snapshots.');
	assert.doesNotMatch(linux.configure.argv.join(' '), /vst3-sdk(?:\/|\\)/u);
	assert.throws(() => executeSoundscaperProfessionalNativeBuild(linux), /activation is blocked/u);

	const windows = createSoundscaperProfessionalNativeBuildPlan({
		repositoryRoot: ROOT, target: 'win-x64', sourceRoots: roots, sourceArchives: archives,
		sourceManifestPath: manifestPath,
		sourceSnapshotRoot: await createSnapshotParent(roots.juce, 'snapshots-win'),
		buildRoot: join(roots.juce, '..', 'build-win'),
	});
	assert.deepEqual(windows.features.audioStreaming, ['wasapi', 'asio']);
	assert.match(windows.configure.argv.join(' '), /CMAKE_SYSTEM_VERSION=10\.0\.26100/u);
	assert.match(windows.configure.argv.join(' '), /SOUNDSCAPER_ASIO_ROOT/u);
	assert.throws(() => executeSoundscaperProfessionalNativeBuild(windows), /activation is blocked/u);
	const windowsOverride = createSoundscaperProfessionalNativeBuildPlan({
		repositoryRoot: ROOT, target: 'win-x64', sourceRoots: roots, sourceArchives: archives,
		sourceManifestPath: manifestPath,
		sourceSnapshotRoot: await createSnapshotParent(roots.juce, 'snapshots-win-override'),
		buildRoot: join(roots.juce, '..', 'build-win-override'),
	});
	assert.throws(() => executeSoundscaperProfessionalNativeBuild(windowsOverride, {
		approvedActivation: true,
		run: () => ({ status: 0, stderr: '', stdout: '' }),
	}), /activation is blocked/u);
	assert.throws(() => executeSoundscaperProfessionalNativeBuild({
		...windows,
		sourceActivation: { status: 'accepted', sourceIds: [] },
	}, {
		run: () => ({ status: 0, stderr: '', stdout: '' }),
	}), /authenticated build plan/u);
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

test('target builds select concrete Linux, macOS Seatbelt and Windows AppContainer launchers', async () => {
	const [cmake, mac, windows, runtime, windowsAuthority, macProfile, windowsProfile] = await Promise.all([
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/CMakeLists.txt'), 'utf8'),
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/src/macos_launcher.mm'), 'utf8'),
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/src/windows_launcher.cpp'), 'utf8'),
		readFile(join(ROOT, 'desktop/native-child-isolation-launcher.ts'), 'utf8'),
		readFile(join(ROOT, 'desktop/native-child-windows-authority.ts'), 'utf8'),
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/profiles/macos-v1.sb'), 'utf8'),
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/profiles/windows-v1.json'), 'utf8'),
	]);
	assert.match(cmake, /elseif\(APPLE\)[\s\S]*macos_launcher\.mm[\s\S]*-lsandbox/u);
	assert.match(cmake, /elseif\(WIN32\)[\s\S]*windows_launcher\.cpp[\s\S]*advapi32 userenv/u);
	assert.match(mac, /F_GETPATH/u);
	assert.match(mac, /sandbox_init/u);
	assert.match(mac, /fexecve/u);
	assert.match(mac, /setrlimit\(RLIMIT_AS/u);
	assert.match(mac, /--extra-input-fd=/u);
	assert.match(mac, /dup2\(value\.extraInputFd, 3\)/u);
	assert.match(mac, /close\(grant\.fd\)/u);
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
	assert.match(runtime, /windowsAuthorityProfile[\s\S]*brand[\s\S]*reviewedPayload[\s\S]*runtimeClosure/u);
	assert.match(windowsAuthority,
		/brand: input\.brand[\s\S]*reviewedPayload: artifactBinding[\s\S]*runtimeClosure: sortedBindings[\s\S]*value\.sha256/u);
	assert.match(windowsProfile, /brand-and-reviewed-payload-bound-appcontainer-low-integrity/u);
	assert.doesNotMatch(runtime, /if \(!target\.startsWith\('linux-'\)/u);
});
