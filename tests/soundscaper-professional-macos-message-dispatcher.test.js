/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

test('macOS pumps JUCE on the main CFRunLoop while framed RPC runs on a worker', async () => {
	const [cmake, header, peer, macDispatcher, nativeTest, macProfile] = await Promise.all([
		readFile(join(ROOT, 'native/soundscaper-professional-host/CMakeLists.txt'), 'utf8'),
		readFile(join(ROOT,
			'native/soundscaper-professional-host/src/juce_message_dispatcher.h'), 'utf8'),
		readFile(join(ROOT,
			'native/soundscaper-professional-host/src/professional_host_peer.cpp'), 'utf8'),
		readFile(join(ROOT,
			'native/soundscaper-professional-host/src/juce_message_dispatcher_mac.mm'), 'utf8')
			.catch(() => ''),
		readFile(join(ROOT,
			'native/soundscaper-professional-host/tests/juce_message_dispatcher_mac_self_test.cpp'),
		'utf8'),
		readFile(join(ROOT,
			'native/milestone-5-native-isolation-launcher/profiles/macos-v1.sb'), 'utf8'),
	]);

	assert.match(header, /runMacJuceMessageDispatcher/u);
	assert.match(peer,
		/#if defined\(__APPLE__\)[\s\S]*runMacJuceMessageDispatcher\(runFramedPeer\)[\s\S]*#else[\s\S]*runFramedPeer\(\)/u);
	assert.match(macProfile, /\(deny default\)/u);
	assert.doesNotMatch(macProfile, /\(allow mach-lookup/u);
	assert.doesNotMatch(macDispatcher,
		/AppKit|NSApplication|NSApp|runDispatchLoop|stopDispatchLoop/u);
	assert.doesNotMatch(macDispatcher, /std::atomic<juce::MessageManager \*>/u);
	assert.match(macDispatcher,
		/struct DispatcherState[\s\S]*std::mutex mutex[\s\S]*pendingTasks[\s\S]*acceptingTasks[\s\S]*transportFinished/u);
	assert.match(macDispatcher,
		/signalCompletionIfDrainedLocked[\s\S]*transportFinished[\s\S]*pendingTasks != 0u[\s\S]*CFRunLoopSourceSignal[\s\S]*CFRunLoopWakeUp/u);
	assert.match(macDispatcher,
		/CompletionWake[\s\S]*CFRunLoopGetMain\(\)[\s\S]*CFRunLoopSourceCreate/u);
	assert.match(macDispatcher,
		/runMacJuceMessageDispatcher[\s\S]*pthread_main_np\(\)[\s\S]*ScopedJuceInitialiser_GUI[\s\S]*CompletionWake[\s\S]*std::thread/u);
	assert.match(macDispatcher, /constexpr CFTimeInterval pumpSliceSeconds = 0\.25/u);
	assert.match(macDispatcher,
		/CFRunLoopRunInMode\(kCFRunLoopDefaultMode, pumpSliceSeconds, true\)/u);
	assert.match(macDispatcher,
		/CFRunLoopSourceSignal[\s\S]*CFRunLoopWakeUp[\s\S]*transport\.join/u);
	assert.match(macDispatcher,
		/CFRunLoopRemoveSource[\s\S]*CFRunLoopSourceInvalidate[\s\S]*CFRelease/u);
	assert.match(macDispatcher,
		/dispatchJuceMessageTask[\s\S]*dispatcherState\.mutex[\s\S]*MessageManager::callAsync/u);
	assert.match(macDispatcher,
		/postJuceMessageTask[\s\S]*dispatcherState\.mutex[\s\S]*MessageManager::callAsync/u);
	assert.match(macDispatcher,
		/shutdownJuceMessageDispatcher[\s\S]*dispatcherState\.mutex[\s\S]*acceptingTasks = false/u);
	assert.match(macDispatcher,
		/finishTransport[\s\S]*transportFinished = true[\s\S]*signalCompletionIfDrainedLocked/u);
	assert.match(nativeTest,
		/runOnce[\s\S]*postJuceMessageTask[\s\S]*shutdownJuceMessageDispatcher[\s\S]*racePostRejected[\s\S]*CFRunLoopSourceSignal[\s\S]*afterShutdownOnMain[\s\S]*runOnce\(\) && runOnce\(\)/u);
	assert.match(cmake,
		/APPLE[\s\S]*juce_message_dispatcher_mac\.mm[\s\S]*soundscaper_juce_message_dispatcher_mac_self_test[\s\S]*TIMEOUT 15/u);
	assert.match(cmake,
		/soundscaper_professional_plugin PRIVATE "-framework CoreFoundation"/u);
});
