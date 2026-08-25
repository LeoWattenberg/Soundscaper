/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const HOST = join(ROOT, 'native/soundscaper-professional-host');

test('Windows native ABI and Node bridge expose only the exact bounded MP3 encoder', async () => {
	const [header, bridge, windows, unavailable] = await Promise.all([
		readFile(join(HOST, 'src/os_audio_codec.h'), 'utf8'),
		readFile(join(HOST, 'src/node_api_bridge.cpp'), 'utf8'),
		readFile(join(HOST, 'src/os_mp3_encode_windows.cpp'), 'utf8'),
		readFile(join(HOST, 'src/os_audio_codec_unavailable.cpp'), 'utf8'),
	]);
	for (const witness of [
		'soundscaper_pro_os_mp3_encode', 'input_bytes', 'maximum_output_bytes',
		'sample_rate', 'channel_count', 'bitrate_kbps',
	]) assert.match(header, new RegExp(witness, 'u'), witness);
	assert.match(bridge, /encodeOperatingSystemMp3/u);
	assert.match(bridge, /soundscaper_pro_os_mp3_encode/u);
	assert.match(unavailable, /soundscaper_pro_os_mp3_encode/u);
	for (const witness of [
		'MPEGLAYER3WAVEFORMAT', 'WAVE_FORMAT_MPEGLAYER3', 'MPEGLAYER3_ID_MPEG',
		'MPEGLAYER3_FLAG_PADDING_ISO', 'MFInitMediaTypeFromWaveFormatEx',
		'MFCreateSinkWriterFromURL', 'MFAudioFormat_PCM', 'MF_MT_AUDIO_BITS_PER_SAMPLE',
		'exactMp3', 'FILE_FLAG_OPEN_REPARSE_POINT', 'maximum_output_bytes',
	]) assert.match(windows, new RegExp(witness, 'u'), witness);
	assert.match(windows, /sample_rate == 48000u/u);
	assert.match(windows, /channel_count == 2u/u);
	assert.match(windows, /bitrate_kbps == 192u/u);
	assert.match(windows, /wave\.nBlockSize = 576u/u);
});

test('build and target self-test bind Windows MP3 encode while macOS stays fail-closed', async () => {
	const [cmake, mac, selfTest] = await Promise.all([
		readFile(join(HOST, 'CMakeLists.txt'), 'utf8'),
		readFile(join(HOST, 'src/os_audio_codec_mac.mm'), 'utf8'),
		readFile(join(HOST, 'tests/os_audio_codec_self_test.cpp'), 'utf8'),
	]);
	assert.match(cmake, /elseif\(WIN32\)[\s\S]*os_mp3_encode_windows\.cpp/u);
	assert.match(cmake, /soundscaper_os_mp3_profile_self_test/u);
	assert.doesNotMatch(cmake, /mac-x64|x86_64-apple/iu);
	assert.match(mac, /Apple documents MP3 as decode-only/u);
	assert.match(mac, /soundscaper_pro_os_mp3_encode[\s\S]*SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE/u);
	assert.doesNotMatch(mac, /ExtAudioFileCreateWithURL[\s\S]*kAudioFormatMPEGLayer3/u);
	assert.match(selfTest, /soundscaper_pro_os_mp3_encode/u);
	assert.match(selfTest, /exactMp3\(bytes, 48000u, 2u, 192u\)/u);
	assert.match(selfTest, /bitrate_kbps = 160u/u);
	assert.match(selfTest, /defined\(_WIN32\)[\s\S]*validMp3Encode/u);
	assert.match(selfTest, /defined\(__APPLE__\)[\s\S]*SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE/u);
});

test('portable exact MP3 profile parser accepts only a complete 192 kbps frame chain', async (context) => {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++20 compiler is unavailable.');
		return;
	}
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-mp3-profile-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const executable = join(temporaryRoot, 'profile-self-test');
	const built = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', join(HOST, 'src'),
		join(HOST, 'src/os_mp3_profile.cpp'),
		join(HOST, 'tests/os_mp3_profile_self_test.cpp'), '-o', executable,
	], { encoding: 'utf8' });
	assert.equal(built.status, 0, built.stderr || built.stdout);
	const executed = spawnSync(executable, [], { encoding: 'utf8' });
	assert.equal(executed.status, 0, executed.stderr || executed.stdout);
});
