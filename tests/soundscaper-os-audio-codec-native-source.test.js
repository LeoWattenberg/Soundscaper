/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

/**
 * CTest can only observe the canary's exit code, so a bare non-zero status
 * reports that a check failed and nothing about which one. When the packaged
 * Windows and macOS matrices went red the run was undiagnosable without another
 * round trip through CI, which this keeps from happening again: the build with
 * no operating-system codec at all is the one refusal reachable from a Linux
 * host, and it has to name itself and print the result it objected to.
 */
test('the target canary names the check it refused rather than failing silently', async (context) => {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++20 compiler is unavailable.');
		return;
	}
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-os-codec-canary-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const executable = join(temporaryRoot, 'codec-self-test');
	const built = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', join(HOST, 'src'),
		join(HOST, 'src/os_aac_m4a_profile.cpp'),
		join(HOST, 'src/os_mp3_profile.cpp'),
		join(HOST, 'src/os_audio_codec_unavailable.cpp'),
		join(HOST, 'tests/os_audio_codec_self_test.cpp'), '-o', executable,
	], { encoding: 'utf8' });
	assert.equal(built.status, 0, built.stderr || built.stdout);

	const executed = spawnSync(executable, [], { encoding: 'utf8' });
	// Every check before the first decode is portable parsing, so a host without
	// codecs must get exactly that far and refuse there.
	assert.equal(executed.status, 6, executed.stderr || executed.stdout);
	assert.match(executed.stderr, /os-audio-codec canary check 6 failed: MP3 decode/u);
	assert.match(executed.stderr, /decode: status=1 native_api_reached=0/u);
});
