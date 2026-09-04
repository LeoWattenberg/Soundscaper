/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * How the professional native host is confined, and what it actually links.
 *
 * A third-party plug-in is arbitrary code the user chose to load, so the host never runs
 * one in the process that owns the project: trusted audio stays in Node and real plug-ins
 * execute only through an isolated peer, launched behind whichever confinement the
 * platform offers. These tests read the built sources rather than the plans, because the
 * question is what the shipped binary does, not what the recipe intended.
 *
 * `tests/soundscaper-professional-native-build.test.js` covers the plans and their pins.
 */

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
	assert.deepEqual([...cmake.matchAll(
		/target_compile_definitions\(soundscaper_professional_(audio|plugin) PUBLIC SOUNDSCAPER_PRO_STATIC=1\)/gu,
	)].map((match) => match[1]).sort(), ['audio', 'plugin'],
	'the two static professional cores must make Windows consumers call their linked definitions directly');
	assert.match(cmake, /add_library\(soundscaper_professional_node MODULE/u);
	assert.match(cmake, /target_link_libraries\(soundscaper_professional_node PRIVATE soundscaper_professional_audio\)/u);
	assert.match(cmake,
		/target_link_libraries\(soundscaper_professional_node PRIVATE soundscaper_professional_audio\)\nif\(APPLE\)\n\ttarget_link_options\(soundscaper_professional_node PRIVATE[\s\S]*"LINKER:-undefined,dynamic_lookup"/u);
	assert.match(cmake, /target_link_libraries\(soundscaper_professional_peer PRIVATE soundscaper_professional_plugin\)/u);
	assert.match(cmake,
		/"-framework AudioToolbox" "-framework CoreFoundation"\)\n\ttarget_link_libraries\(soundscaper_professional_plugin PRIVATE "-framework CoreAudioKit"\)/u);
	assert.match(cmake, /SOUNDSCAPER_NODE_API_INCLUDE/u);
	assert.match(cmake, /OUTPUT_NAME "soundscaper_professional"[\s\S]*SUFFIX "\.node"/u);
	assert.match(cmake, /pipewire_session\.c/u);
	assert.match(cmake, /juce_message_dispatcher\.cpp/u);
	assert.match(api, /SOUNDSCAPER_PRO_API __attribute__\(\(visibility\("default"\)\)\)/u);
	assert.match(api,
		/defined\(_WIN32\)[\s\S]*defined\(SOUNDSCAPER_PRO_STATIC\)[\s\S]*#define SOUNDSCAPER_PRO_API\s*\n[\s\S]*elif defined\(SOUNDSCAPER_PRO_BUILD\)[\s\S]*__declspec\(dllexport\)/u,
		'the Windows static-core ABI must take precedence over its shared-library build decoration');
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
	assert.match(dispatcher, /current->stopDispatchLoop\(\);/u);
	assert.doesNotMatch(dispatcher,
		/callAsync\([^;]*stopDispatchLoop/u,
		'teardown must stop JUCE\'s dispatch loop before joining its worker');
	assert.match(dispatcher, /shutdownJuceMessageDispatcher[\s\S]*value->shutdown\(\)/u);
	assert.match(peer,
		/writeFrame\(answer\)[\s\S]*peer\.finished\(\)[\s\S]*shutdownJuceMessageDispatcher\(\)/u,
		'the successful close frame must precede explicit bounded-lifetime JUCE teardown');
	assert.match(peer,
		/int main\(int argc, char \*\*argv\)[\s\S]*_setmode\(_fileno\(stdout\), _O_BINARY\)[\s\S]*containmentProbe\(argc, argv\)/u,
		'Windows containment receipts must enter binary stdout mode before emitting exact LF markers');
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

test('target builds select concrete Linux, identity-preserving macOS Seatbelt and Windows AppContainer launchers', async () => {
	const [cmake, mac, macBroker, macBootstrap, macBootstrapHeader, professionalCmake, peer, windows, runtime,
		windowsAuthority, macProfile, windowsProfile] = await Promise.all([
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/CMakeLists.txt'), 'utf8'),
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/src/macos_launcher.mm'), 'utf8'),
		readFile(join(ROOT, 'native/milestone-5-native-isolation-launcher/profiles/macos-broker-v1.json'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/professional_host_macos_bootstrap.mm'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/professional_host_macos_bootstrap.hpp'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/CMakeLists.txt'), 'utf8'),
		readFile(join(ROOT, 'native/soundscaper-professional-host/src/professional_host_peer.cpp'), 'utf8'),
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
	assert.match(cmake, /elseif\(APPLE\)[\s\S]*macos_launcher\.mm[\s\S]*"-lproc"/u);
	assert.match(cmake, /elseif\(WIN32\)[\s\S]*windows_launcher\.cpp[\s\S]*advapi32 onecoreuap userenv/u);
	assert.match(mac, /#include <cstdint>/u);
	assert.match(mac, /#include <utility>/u);
	assert.match(windows, /#include <utility>/u);
	assert.match(mac, /F_GETPATH/u);
	assert.match(mac, /allow process-exec \(literal [\s\S]*pathFor\(value\.executableFd\)/u);
	assert.match(mac, /PROC_PIDREGIONPATHINFO/u);
	assert.doesNotMatch(mac, /PROC_PIDREGIONPATHINFO2/u,
		'the exact-vnode verifier must stay on the public macOS process-info API');
	assert.match(mac, /vst_dev[\s\S]*vst_ino[\s\S]*vst_size/u);
	assert.match(mac, /pri_protection[\s\S]*VM_PROT_EXECUTE/u);
	assert.match(mac, /pbi_status[\s\S]*SSTOP[\s\S]*PROC_FLAG_EXEC/u,
		'the verifier must not race the kernel between publishing SSTOP and completing task suspension');
	assert.match(mac, /PROC_PIDLISTFDS/u,
		'the trusted verifier must close the complete descriptor snapshot rather than scan an unbounded limit');
	assert.match(mac, /POSIX_SPAWN_SETEXEC[\s\S]*POSIX_SPAWN_START_SUSPENDED/u);
	assert.doesNotMatch(mac, /POSIX_SPAWN_CLOEXEC_DEFAULT|posix_spawn_file_actions_/u,
		'the single-threaded SETEXEC parent must not rely on Darwin spawn file actions');
	assert.match(mac, /F_DUPFD_CLOEXEC/u,
		'the fixed bootstrap descriptors must be sourced from collision-free private duplicates');
	assert.match(mac,
		/mapBootstrapDescriptors\([\s\S]*const std::vector<int> &openDescriptors[\s\S]*for \(const int descriptor : openDescriptors\)[\s\S]*descriptor > bootstrap::extraInputDescriptor[\s\S]*close\(descriptor\) != 0\) return failureCode\(\)/u,
		'the parent must close every snapshotted descriptor above the exact bootstrap descriptor set');
	assert.doesNotMatch(mac, /closefrom\(/u,
		'the launcher must compile against the macOS SDK without relying on undeclared BSD extensions');
	assert.match(mac,
		/fork\(\)[\s\S]*mapBootstrapDescriptors\([\s\S]*posix_spawn\(nullptr,[\s\S]*nullptr, &attributes/u,
		'the verifier must retain authority before the parent maps and closes the exact peer descriptor set');
	assert.match(mac, /kill\([^,]+, SIGCONT\)[\s\S]*exactWrite/u,
		'the exact stopped peer must resume before a maximum-size policy can fill the pipe');
	assert.match(mac, /kill\([^,]+, SIGKILL\)/u);
	assert.match(mac, /"LANG=C"[\s\S]*"LC_ALL=C"[\s\S]*"PATH="[\s\S]*"HOME=\/nonexistent"/u);
	assert.match(mac, /const int status = posix_spawn[\s\S]*nativeFailure\("posix-spawn", status\)/u,
		'a successful SETEXEC cannot return, so every return path must fail closed');
	assert.doesNotMatch(mac, /sandbox_init/u,
		'the exact peer, not the pre-exec launcher image, must enter Seatbelt');
	assert.doesNotMatch(mac, /setrlimit\(RLIMIT_AS/u,
		'Darwin counts its multi-gigabyte dyld shared region against RLIMIT_AS');
	assert.match(mac, /setrlimit\(RLIMIT_CPU/u);
	assert.match(mac,
		/proc_pid_rusage\([^,]+, RUSAGE_INFO_V2,\s*reinterpret_cast<rusage_info_t \*>\(&usage\)\)/u,
		'the trusted verifier must sample the SETEXEC peer through the public libproc API');
	assert.match(mac, /usage\.ri_phys_footprint > maximumRssBytes/u,
		'the verifier must exclude clean shared mappings while charging private touched pages');
	assert.doesNotMatch(mac, /usage\.ri_resident_size > maximumRssBytes/u,
		'raw resident size can exceed the policy before the framework-linked peer completes enforcement');
	assert.match(mac,
		/monitorPhysicalFootprint\([\s\S]*timespec interval\{ 0, 10'000'000 \}/u,
		'the trusted physical-footprint supervisor must mirror the Linux launcher polling interval');
	assert.match(mac,
		/proc_pid_rusage\([\s\S]*!= 0\)[\s\S]*getppid\(\) != parent\) _exit\(0\);[\s\S]*verifierFailure\(parent\)/u,
		'a sampling failure must kill a still-live peer but must not signal a reused process identifier');
	assert.match(mac,
		/exactWrite\(1, policy\.data\(\), policy\.size\(\)\)[\s\S]*monitorPhysicalFootprint\(parent, maximumRssBytes\)/u,
		'the trusted verifier must remain alive as the physical-footprint supervisor after releasing the peer');
	assert.match(mac, /--extra-input-fd=/u);
	for (const protocol of [mac, macBootstrapHeader]) {
		assert.match(protocol, /enforcementDescriptor\s*=\s*3/u);
		assert.match(protocol, /policyDescriptor\s*=\s*4/u);
		assert.match(protocol, /extraInputDescriptor\s*=\s*5/u);
		assert.match(protocol, /'M', '5', 'M', 'A', 'C', 'S', 'B', '1'/u);
	}
	assert.match(macBroker,
		/"enforcementHandshake":"peer-post-sandbox-enforcement-pipe-v1"/u);
	assert.match(macBroker, /"memory":"trusted-verifier-physical-footprint-poll-10ms-v1"/u);
	assert.match(professionalCmake,
		/soundscaper_professional_peer[\s\S]*professional_host_macos_bootstrap\.mm[\s\S]*"-lsandbox"/u);
	assert.match(professionalCmake,
		/soundscaper_professional_peer PROPERTIES[\s\S]*OBJCXX_STANDARD 20[\s\S]*OBJCXX_STANDARD_REQUIRED YES/u);
	assert.match(macBootstrap, /sandbox_init[\s\S]*exactWrite[\s\S]*close\([^)]*enforcement/u);
	assert.match(macBootstrap, /dup2\(extraInputDescriptor, enforcementDescriptor\)/u);
	assert.match(peer,
		/int main\(int argc, char \*\*argv\)[\s\S]*soundscaperProfessionalMacosBootstrap\(\)[\s\S]*containmentProbe/u,
		'the macOS sandbox bootstrap must precede containment probes and framed protocol work');
	assert.match(macProfile, /\(deny default\)/u);
	assert.doesNotMatch(macProfile, /coreaudiod/u);
	assert.match(windows, /DeriveAppContainerSidFromAppContainerName/u);
	assert.match(windows, /--authority-profile=/u);
	assert.match(windows, /soundscaper-professional|framescaper-media|framescaper-openfx/u);
	assert.match(windows, /PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES/u);
	assert.match(windows, /PROC_THREAD_ATTRIBUTE_HANDLE_LIST/u);
	assert.match(windows, /SetEntriesInAclW/u);
	assert.match(windows, /sameFile\(source, handle\)/u);
	assert.match(windows,
		/OpenProcessToken\(GetCurrentProcess\(\), TOKEN_QUERY[\s\S]*GetTokenInformation\([^,]+, TokenUser[\s\S]*SetEntriesInAclW\(2u/u,
		'exact LPAC grants must authorize both halves of the Windows dual-principal access check');
	assert.doesNotMatch(windows, /class AclLease|originalAcl|~AclLease/u,
		'a crash-safe exact AppContainer grant must never rely on launcher-exit DACL restoration');
	assert.match(windows, /cbReserved2/u);
	assert.match(windows, /--extra-input-fd=/u);
	assert.match(windows, /JOB_OBJECT_LIMIT_ACTIVE_PROCESS/u);
	assert.match(windows, /AssignProcessToJobObject/u);
	assert.match(windows,
		/WriteFile\(values\.enforcement[\s\S]*_close\(values\.enforcementFd\)[\s\S]*values\.enforcementFd = -1[\s\S]*values\.enforcement = nullptr[\s\S]*ResumeThread/u,
		'the enforcement pipe must reach EOF before the child waits for framed input');
	assert.match(windowsProfile, /appcontainer-low-integrity/u);
	assert.match(runtime, /soundscaper-macos-seatbelt-broker-v1/u);
	assert.match(runtime,
		/target === 'mac-arm64'[\s\S]*request\.executable\.sha256[\s\S]*peerPayloadSha256/u,
		'the macOS SETEXEC target must be the exact bootstrap-capable professional peer');
	assert.match(runtime, /soundscaper-windows-appcontainer-job-v1/u);
	assert.match(runtime, /windowsAuthorityProfile[\s\S]*brand[\s\S]*workloadPayload[\s\S]*runtimeClosure/u);
	assert.match(windowsAuthority,
		/brand: input\.brand[\s\S]*workloadPayload: artifactBinding[\s\S]*runtimeClosure: sortedBindings[\s\S]*value\.sha256/u);
	assert.match(windowsProfile,
		/brand-and-machine-workload-payload-bound-less-privileged-appcontainer-low-integrity/u);
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
