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
	const [header, bridge, windowsUnit, windowsBytes, mac, unavailable, selfTest] = await Promise.all([
		readFile(join(SOURCE, 'src/os_audio_codec.h'), 'utf8'),
		readFile(join(SOURCE, 'src/node_api_bridge.cpp'), 'utf8'),
		readFile(join(SOURCE, 'src/os_audio_codec_windows.cpp'), 'utf8'),
		readFile(join(SOURCE, 'src/os_audio_codec_windows_file_bytes.h'), 'utf8'),
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
	]) assert.match(windowsUnit + windowsBytes, new RegExp(witness, 'u'), witness);
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

test('Windows AAC PCM blocks locally pin the admitted stereo layout', async () => {
	const source = await readFile(join(SOURCE, 'src/os_audio_codec_windows.cpp'), 'utf8');
	const encode = source.slice(source.indexOf('encodeOperatingSystemAacM4a'));
	assert.match(
		encode,
		/constexpr UINT32 pcmChannelCount = 2u;\s*constexpr UINT32 pcmBlockAlignment = pcmChannelCount \* sizeof\(int16_t\);\s*assert\(request->channel_count == pcmChannelCount\);/u,
	);
	assert.match(
		encode,
		/std::memcpy\(destination, pcm\.data\(\) \+ frameOffset \* pcmChannelCount, bufferBytes\);/u,
	);
});

test('Windows AAC decoder proves the exact tuple from the file, then decodes float PCM', async () => {
	const source = await readFile(join(SOURCE, 'src/os_audio_codec_windows.cpp'), 'utf8');
	for (const witness of [
		'MFAudioFormat_AAC', 'MF_MT_AAC_PAYLOAD_TYPE', 'MFAudioFormat_Float',
		'sourceSampleRate', 'sourceChannelCount',
	]) assert.match(source, new RegExp(witness, 'u'), witness);
	// The media type says what it is; the file's own AudioSpecificConfig proves
	// it, and at the rate and channel count that media type reported.
	assert.match(source, /exactAacLcInput\(inputPath, request->input_bytes, sampleRate, channelCount/u);
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

/**
 * `audioProfileLevelIndication` lives in an MPEG-4 initial object descriptor,
 * which an ordinary M4A need not carry: the pinned canary, written by the
 * digest-pinned FFmpeg image, has no `iods` box at all. Media Foundation
 * therefore has no such field to report for it, and the Windows decoder used to
 * require the attribute to be present, which refused every conforming file
 * written this way. MF_MT_AAC_PAYLOAD_TYPE is documented as optional with a
 * default of 0 for the same reason. Both must stay optional-if-absent and
 * checked-if-present, with the file's own AudioSpecificConfig as the witness.
 */
test('an admitted M4A is not required to carry an initial object descriptor', async () => {
	const source = await readFile(join(SOURCE, 'tests/os_audio_codec_self_test.cpp'), 'utf8');
	const block = /constexpr char aacM4aCanaryBase64\[\] =([\s\S]*?);/u.exec(source)?.[1];
	const canary = Buffer.from(
		[...block.matchAll(/"([^"]*)"/gu)].map((match) => match[1]).join(''), 'base64');
	assert.equal(canary.subarray(4, 8).toString('latin1'), 'ftyp');
	assert.equal(canary.includes(Buffer.from('iods', 'latin1')), false,
		'the fixture that must be admitted carries no profile-level indication');

	const windows = await readFile(join(SOURCE, 'src/os_audio_codec_windows.cpp'), 'utf8');
	assert.match(windows, /SUCCEEDED\([^\n]*MF_MT_AAC_PAYLOAD_TYPE/u,
		'the payload type is optional and only a stated non-raw value refuses');
	assert.doesNotMatch(windows, /exactUnsigned\(type, MF_MT_AAC_PAYLOAD_TYPE/u);
	// The decoder must not gate admission on either descriptor the source
	// synthesises for a file that carries neither.
	const decodeSide = windows.slice(0, windows.indexOf('encodeOperatingSystemAacM4a'));
	for (const attribute of ['MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION',
		'MF_MT_MPEG4_SAMPLE_DESCRIPTION', 'MF_MT_MPEG4_CURRENT_SAMPLE_ENTRY']) {
		assert.doesNotMatch(decodeSide, new RegExp(`GetUINT32\\([^\\n]*${attribute}`, 'u'), attribute);
		assert.doesNotMatch(decodeSide, new RegExp(`GetBlob[A-Za-z]*\\([^\\n]*${attribute}`, 'u'), attribute);
	}
	// The encoder still states an AAC-LC profile on the type it writes.
	assert.match(windows, /SetUINT32\(MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, 0x29u\)/u);
});

test('both reviewed targets admit an M4A input from its own authenticated bytes', async () => {
	const [windows, windowsBytes, mac, profile, canary] = await Promise.all([
		readFile(join(SOURCE, 'src/os_audio_codec_windows.cpp'), 'utf8'),
		readFile(join(SOURCE, 'src/os_audio_codec_windows_file_bytes.h'), 'utf8'),
		readFile(join(SOURCE, 'src/os_audio_codec_mac.mm'), 'utf8'),
		readFile(join(SOURCE, 'src/os_aac_m4a_profile.h'), 'utf8'),
		readFile(join(SOURCE, 'tests/os_audio_codec_self_test.cpp'), 'utf8'),
	]);
	assert.match(profile, /bool exactAacLcM4aFile\(/u);
	assert.match(mac, /exactAacLcM4aFile\(\s*\n?\s*request->input_path_utf8/u);
	// Windows reads it wide, so an admission never depends on the ANSI code page.
	assert.match(windows, /exactAacLcInput\(inputPath, request->input_bytes/u);
	assert.match(windowsBytes, /boundedFileBytes\(path, expectedBytes, bytes\)/u);
	assert.match(windowsBytes, /const std::wstring &path/u);
	// Definitions live in a header, so a second translation unit including it
	// must not collide with the first.
	for (const definition of ['readAllBytes', 'boundedFileBytes', 'inspectEncodedOutput',
		'exactAacLcInput']) {
		assert.match(windowsBytes, new RegExp(`inline [A-Za-z]+ ${definition}\\(`, 'u'), definition);
	}
	// And with the config proven, the declared-SBR refusal applies to both.
	assert.match(canary, /#if defined\(_WIN32\) \|\| defined\(__APPLE__\)\s*\n\tconst std::string heInputText/u);
});

test('an encoder output that is refused reports the tuple, not an encode failure', async () => {
	for (const name of ['src/os_audio_codec_windows.cpp', 'src/os_audio_codec_mac.mm']) {
		const source = await readFile(join(SOURCE, name), 'utf8');
		assert.match(source, /EncodedOutputInspection::notExact/u, name);
		assert.match(
			source,
			/notExact\s*\n?\s*\?\s*SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED/u,
			`${name} must separate a refused output from a failed encode`,
		);
	}
});

/**
 * A packaged target runs the canary unattended, and `TUPLE_UNSUPPORTED` alone
 * says a rule refused without saying which. The profile parser therefore names
 * the layer it stopped at, both reviewed targets carry that through their
 * result, and the canary prints it beside the status.
 */
test('a refused profile names the layer it stopped at, all the way to the canary', async () => {
	const [profile, header, windows, mac, canary] = await Promise.all([
		readFile(join(SOURCE, 'src/os_aac_m4a_profile.h'), 'utf8'),
		readFile(join(SOURCE, 'src/os_audio_codec.h'), 'utf8'),
		readFile(join(SOURCE, 'src/os_audio_codec_windows.cpp'), 'utf8'),
		readFile(join(SOURCE, 'src/os_audio_codec_mac.mm'), 'utf8'),
		readFile(join(SOURCE, 'tests/os_audio_codec_self_test.cpp'), 'utf8'),
	]);
	assert.match(profile, /enum class AacLcM4aRefusal : uint32_t/u);
	for (const [name, value] of [
		['none', 0], ['bounds', 1], ['boxStructure', 2], ['fileType', 3], ['movie', 4],
		['audioTrackCount', 5], ['trackShape', 6], ['sampleDescription', 7], ['esds', 8],
		['audioSpecificConfig', 9], ['esdsFullBox', 10], ['esdsElementaryStream', 11],
		['esdsDecoderConfig', 12], ['esdsDecoderSpecificInfo', 13], ['esdsSyncLayer', 14],
		['esdsObjectType', 15], ['esdsStreamType', 16],
	]) assert.match(profile, new RegExp(`${name} = ${value}u,`, 'u'), name);

	// The Windows media-type refusals share the field in a disjoint range, so a
	// reader can always tell which admission produced the number.
	const windowsUnit = await readFile(join(SOURCE, 'src/os_audio_codec_windows.cpp'), 'utf8');
	assert.match(windowsUnit, /enum class MediaTypeRefusal : uint32_t/u);
	const codes = [...windowsUnit.matchAll(/^\t([a-zA-Z][a-zA-Z0-9]*) = (\d+)u,$/gmu)]
		.map(([, , value]) => Number(value)).filter((value) => value !== 0);
	assert.deepEqual([...codes].sort((a, b) => a - b), [100, 101, 102, 103, 107, 108],
		'every media-type refusal names itself');
	assert.equal(new Set(codes).size, codes.length, 'two refusals must not share a number');
	assert.ok(codes.every((value) => value >= 100),
		'a media-type refusal must not collide with a profile-parser layer');

	// Both results carry it, and neither target drops it on the floor.
	// Decode, AAC encode and MP3 encode each carry it.
	assert.equal(header.match(/uint32_t refusal_detail;/gu)?.length, 3);
	// macOS reports the admitted input and the encoded output; Windows reports a
	// third, the host media type it would not admit.
	for (const [name, source, sites] of [['windows', windows, 3], ['mac', mac, 2]]) {
		assert.equal(source.match(/refusal_detail = static_cast<uint32_t>/gu)?.length, sites,
			`${name} must report every refusal it can produce`);
	}
	assert.match(canary, /refusal=%u/u);
	assert.match(canary, /result\.refusal_detail/u);
});
