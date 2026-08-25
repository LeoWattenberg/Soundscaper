/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'native/soundscaper-professional-host');

test('target native ABI and Node bridge expose bounded AAC-LC M4A decode', async () => {
	const [header, bridge, unavailable] = await Promise.all([
		readFile(join(SOURCE, 'src/os_audio_codec.h'), 'utf8'),
		readFile(join(SOURCE, 'src/node_api_bridge.cpp'), 'utf8'),
		readFile(join(SOURCE, 'src/os_audio_codec_unavailable.cpp'), 'utf8'),
	]);
	assert.match(header, /soundscaper_pro_os_aac_m4a_decode\s*\(/u);
	assert.match(bridge, /decodeOperatingSystemAacM4a/u);
	assert.match(bridge, /soundscaper_pro_os_aac_m4a_decode/u);
	assert.match(unavailable, /soundscaper_pro_os_aac_m4a_decode/u);
});

test('target native ABI and bridge expose exact bounded AAC-LC M4A encode', async () => {
	const [header, bridge, windows, mac, unavailable, selfTest] = await Promise.all([
		readFile(join(SOURCE, 'src/os_audio_codec.h'), 'utf8'),
		readFile(join(SOURCE, 'src/node_api_bridge.cpp'), 'utf8'),
		readFile(join(SOURCE, 'src/os_audio_codec_windows.cpp'), 'utf8'),
		readFile(join(SOURCE, 'src/os_audio_codec_mac.mm'), 'utf8'),
		readFile(join(SOURCE, 'src/os_audio_codec_unavailable.cpp'), 'utf8'),
		readFile(join(SOURCE, 'tests/os_audio_codec_self_test.cpp'), 'utf8'),
	]);
	for (const witness of [
		'soundscaper_pro_os_aac_m4a_encode', 'sample_rate', 'channel_count',
		'bitrate_kbps', 'maximum_output_bytes',
	]) assert.match(header, new RegExp(witness, 'u'), witness);
	assert.match(bridge, /encodeOperatingSystemAacM4a/u);
	assert.match(unavailable, /soundscaper_pro_os_aac_m4a_encode/u);
	for (const witness of [
		'MFAudioFormat_AAC', 'MFCreateSinkWriterFromURL', 'MF_MT_AUDIO_AVG_BYTES_PER_SECOND',
		'MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION', 'MF_MT_AAC_PAYLOAD_TYPE',
		'exactAacLcM4a',
	]) assert.match(windows, new RegExp(witness, 'u'), witness);
	for (const witness of [
		'ExtAudioFileCreateWithURL', 'kAudioFileM4AType', 'kAudioFormatMPEG4AAC',
		'kAudioConverterEncodeBitRate', 'kExtAudioFileProperty_ConverterConfig', 'exactAacLcM4a',
	]) assert.match(mac, new RegExp(witness, 'u'), witness);
	assert.match(mac, /fileFormat\.mFormatFlags = 0u/u);
	assert.match(mac, /converter = nullptr;[\s\S]*kExtAudioFileProperty_AudioConverter/u);
	assert.match(selfTest, /soundscaper_pro_os_aac_m4a_encode/u);
	assert.match(selfTest, /160u/u);
	assert.match(selfTest, /exactAacLcM4a/u);
});

test('Windows AAC decoder proves M4A mp4a and AAC-LC before emitting float PCM', async () => {
	const source = await readFile(join(SOURCE, 'src/os_audio_codec_windows.cpp'), 'utf8');
	for (const witness of [
		'MFAudioFormat_AAC', 'MF_MT_MPEG4_SAMPLE_DESCRIPTION',
		'MF_MT_MPEG4_CURRENT_SAMPLE_ENTRY', 'MF_MT_AAC_PAYLOAD_TYPE',
		'MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION', 'MFAudioFormat_Float',
		'sourceSampleRate', 'sourceChannelCount',
	]) assert.match(source, new RegExp(witness, 'u'), witness);
	assert.match(source, /['"]mp4a['"]|\{\s*'m',\s*'p',\s*'4',\s*'a'\s*\}/u);
	assert.match(source, /0x29u.*0x2au.*0x2bu/su);
	assert.match(source, /sampleRate != sourceSampleRate.*channelCount != sourceChannelCount/su);
});

test('macOS AAC decoder proves M4A and exact AAC-LC AudioSpecificConfig before decode', async () => {
	const source = await readFile(join(SOURCE, 'src/os_audio_codec_mac.mm'), 'utf8');
	for (const witness of [
		'kExtAudioFileProperty_AudioFile', 'kAudioFilePropertyFileFormat',
		'kAudioFileM4AType', 'kAudioFormatMPEG4AAC',
		'exactAacLcM4a', 'kAudioFormatFlagsNativeFloatPacked',
	]) assert.match(source, new RegExp(witness, 'u'), witness);
});

test('portable M4A profile parser accepts AAC-LC and rejects an implicit HE-AAC declaration', async (context) => {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++20 compiler is unavailable.');
		return;
	}
	const source = await readFile(join(SOURCE, 'tests/os_audio_codec_self_test.cpp'), 'utf8');
	const block = /constexpr char aacM4aCanaryBase64\[\] =([\s\S]*?);/u.exec(source)?.[1];
	assert.equal(typeof block, 'string');
	const encoded = [...block.matchAll(/"([^"]*)"/gu)].map((match) => match[1]).join('');
	const lc = Buffer.from(encoded, 'base64');
	const audioSpecificConfig = Buffer.from('119056e500', 'hex');
	const configOffset = lc.indexOf(audioSpecificConfig);
	assert.equal(configOffset, 528);
	assert.equal(lc.indexOf(audioSpecificConfig, configOffset + 1), -1);
	const he = Buffer.from(lc);
	he[configOffset + 4] = 0x80;
	assert.equal(
		createHash('sha256').update(he).digest('hex'),
		'067e521e3f33e667840e5de1ca8b472d647e11aacce4ed052ef03137cb82a1d0',
	);
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-aac-profile-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const lcPath = join(temporaryRoot, 'lc.m4a');
	const hePath = join(temporaryRoot, 'he.m4a');
	const executable = join(temporaryRoot, 'profile-self-test');
	await Promise.all([writeFile(lcPath, lc), writeFile(hePath, he)]);
	const built = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Werror',
		'-I', join(SOURCE, 'src'),
		join(SOURCE, 'src/os_aac_m4a_profile.cpp'),
		join(SOURCE, 'tests/os_aac_m4a_profile_self_test.cpp'),
		'-o', executable,
	], { encoding: 'utf8' });
	assert.equal(built.status, 0, built.stderr || built.stdout);
	const executed = spawnSync(executable, [lcPath, hePath], { encoding: 'utf8' });
	assert.equal(executed.status, 0, executed.stderr || executed.stdout);
});

test('target CTest uses exact positive M4A and wrong-container/profile fixtures', async () => {
	const [source, cmake] = await Promise.all([
		readFile(join(SOURCE, 'tests/os_audio_codec_self_test.cpp'), 'utf8'),
		readFile(join(SOURCE, 'CMakeLists.txt'), 'utf8'),
	]);
	assert.match(source, /1db255988826f9f6f8322f6cfb6c82c6ee7873c3252c822bc0ac1793d5729451/u);
	assert.match(source, /20eac200d9047ae50a6f34b7fbbe610a49a48bb58c7208df28f6a4789b67e826/u);
	assert.match(source, /067e521e3f33e667840e5de1ca8b472d647e11aacce4ed052ef03137cb82a1d0/u);
	assert.match(source, /soundscaper_pro_os_aac_m4a_decode/u);
	assert.match(source, /SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED/u);
	assert.match(cmake, /soundscaper_os_audio_codec_self_test/u);
	assert.doesNotMatch(cmake, /mac-x64|x86_64/iu);
	for (const [name, byteLength, sha256] of [
		['aacM4aCanaryBase64', 1909, '1db255988826f9f6f8322f6cfb6c82c6ee7873c3252c822bc0ac1793d5729451'],
		['aacAdtsCanaryBase64', 1115, '20eac200d9047ae50a6f34b7fbbe610a49a48bb58c7208df28f6a4789b67e826'],
	]) {
		const block = new RegExp(`constexpr char ${name}\\[\\] =([\\s\\S]*?);`, 'u').exec(source)?.[1];
		assert.equal(typeof block, 'string', name);
		const encoded = [...block.matchAll(/"([^"]*)"/gu)].map((match) => match[1]).join('');
		const fixture = Buffer.from(encoded, 'base64');
		assert.equal(fixture.byteLength, byteLength, name);
		assert.equal(createHash('sha256').update(fixture).digest('hex'), sha256, name);
	}
});
