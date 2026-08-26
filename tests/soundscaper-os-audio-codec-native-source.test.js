/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const HOST = join(ROOT, 'native/soundscaper-professional-host');

test('professional host builds one target-native MP3 decoder without a macOS x64 target', async () => {
	const [cmake, api, windows, windowsSession, mac, unavailable, selfTest] = await Promise.all([
		readFile(join(HOST, 'CMakeLists.txt'), 'utf8'),
		readFile(join(HOST, 'src/os_audio_codec.h'), 'utf8'),
		readFile(join(HOST, 'src/os_audio_codec_windows.cpp'), 'utf8'),
		readFile(join(HOST, 'src/os_audio_codec_windows_session.h'), 'utf8'),
		readFile(join(HOST, 'src/os_audio_codec_mac.mm'), 'utf8'),
		readFile(join(HOST, 'src/os_audio_codec_unavailable.cpp'), 'utf8'),
		readFile(join(HOST, 'tests/os_audio_codec_self_test.cpp'), 'utf8'),
	]);

	assert.match(cmake, /if\(APPLE\)[\s\S]*enable_language\(OBJCXX\)/u);
	assert.match(cmake, /os_audio_codec_mac\.mm[\s\S]*AudioToolbox[\s\S]*CoreFoundation/u);
	assert.match(cmake, /elseif\(WIN32\)[\s\S]*os_audio_codec_windows\.cpp/u);
	assert.match(cmake, /mfplat[\s\S]*mfreadwrite[\s\S]*mfuuid[\s\S]*ole32/u);
	assert.match(cmake, /else\(\)[\s\S]*os_audio_codec_unavailable\.cpp/u);
	assert.doesNotMatch(cmake, /mac-x64|x86_64-apple/u);

	assert.match(api, /soundscaper_pro_os_mp3_decode/u);
	assert.match(api, /maximum_output_bytes/u);
	assert.match(api, /native_api_reached/u);
	// The platform is started and shut down by the guard the interfaces outlive,
	// so the Windows unit reaches Media Foundation through it rather than directly.
	assert.match(windowsSession, /MFStartup/u);
	assert.match(windows, /MediaFoundationSession session;/u);
	assert.match(windows, /MFCreateSourceReaderFromURL/u);
	assert.match(windows, /MFAudioFormat_MP3/u);
	assert.match(windows, /MFAudioFormat_Float/u);
	assert.match(mac, /ExtAudioFileOpenURL/u);
	assert.match(mac, /kAudioFormatMPEGLayer3/u);
	assert.match(mac, /kExtAudioFileProperty_ClientDataFormat/u);
	assert.match(unavailable, /SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE/u);
	assert.match(selfTest, /soundscaper_pro_os_mp3_decode/u);
	assert.match(selfTest, /90971a846ba5d03488be96ada4f9ea6698aa47e7f487adfe65d606519b0270f2/u);
});

test('the Node-API bridge exposes only the bounded file-based OS decode call', async () => {
	const bridge = await readFile(join(HOST, 'src/node_api_bridge.cpp'), 'utf8');
	assert.match(bridge, /"decodeOperatingSystemMp3"/u);
	assert.match(bridge, /soundscaper_pro_os_mp3_decode/u);
	assert.doesNotMatch(bridge, /CreateProcess|posix_spawn|system\s*\(/u);
});
