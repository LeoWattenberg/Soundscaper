/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	inspectOperatingSystemAudioSource,
} from '../desktop/os-audio-codec-source-inspection.ts';
import { aacLcM4a44_100Fixture } from './helpers/os-audio-codec-fixtures.ts';

const nativeSelfTest = readFileSync(new URL(
	'../native/soundscaper-professional-host/tests/os_audio_codec_self_test.cpp', import.meta.url,
), 'utf8');

function nativeFixture(name: string): Uint8Array {
	const block = new RegExp(`constexpr char ${name}\\[\\] =([\\s\\S]*?);`, 'u')
		.exec(nativeSelfTest)?.[1];
	assert.ok(block !== undefined);
	const encoded = [...block.matchAll(/"([^"]*)"/gu)].map((match) => match[1]).join('');
	return new Uint8Array(Buffer.from(encoded, 'base64'));
}

function mp3Fixture(sampleRateIndex: 0 | 1, channelMode = 0): Uint8Array {
	const sampleRate = sampleRateIndex === 0 ? 44_100 : 48_000;
	const frameBytes = Math.floor(144_000 * 128 / sampleRate);
	const bytes = new Uint8Array(frameBytes * 2);
	const header = 0xffe0_0000 | 3 << 19 | 1 << 17 | 1 << 16
		| 9 << 12 | sampleRateIndex << 10 | channelMode << 6;
	const view = new DataView(bytes.buffer);
	view.setUint32(0, header, false);
	view.setUint32(frameBytes, header, false);
	return bytes;
}

test('source inspection preserves the exact reviewed MP3 frame-chain gate', () => {
	assert.deepEqual(inspectOperatingSystemAudioSource('mp3', mp3Fixture(1)), {
		sampleRate: 48_000, channelCount: 2,
	});
	assert.deepEqual(inspectOperatingSystemAudioSource('mp3', mp3Fixture(0, 3)), {
		sampleRate: 44_100, channelCount: 1,
	});
	assert.equal(inspectOperatingSystemAudioSource('mp3', mp3Fixture(1).subarray(0, 20)), null);
});

test('source inspection admits exact AAC-LC M4A geometry and refuses ADTS or malformed boxes', () => {
	const m4a = nativeFixture('aacM4aCanaryBase64');
	assert.deepEqual(inspectOperatingSystemAudioSource('aac-m4a', m4a), {
		sampleRate: 48_000, channelCount: 2,
	});
	assert.equal(inspectOperatingSystemAudioSource(
		'aac-m4a', nativeFixture('aacAdtsCanaryBase64'),
	), null);
	const truncated = m4a.subarray(0, m4a.byteLength - 1);
	assert.equal(inspectOperatingSystemAudioSource('aac-m4a', truncated), null);
	const trailing = new Uint8Array(m4a.byteLength + 1);
	trailing.set(m4a);
	assert.equal(inspectOperatingSystemAudioSource('aac-m4a', trailing), null);
});

test('source inspection refuses valid but unqualified M4A geometry and implicit HE-AAC', () => {
	const m4a = nativeFixture('aacM4aCanaryBase64');
	assert.deepEqual(inspectOperatingSystemAudioSource(
		'aac-m4a', aacLcM4a44_100Fixture(),
	), { sampleRate: 44_100, channelCount: 2 });
	const he = new Uint8Array(m4a);
	const config = Buffer.from(he).indexOf(Buffer.from('119056e500', 'hex'));
	assert.equal(config, 528);
	he[config + 4] = 0x80;
	assert.equal(inspectOperatingSystemAudioSource('aac-m4a', he), null);
	const noM4aBrand = new Uint8Array(m4a);
	noM4aBrand.set(Buffer.from('isom'), 8);
	noM4aBrand.set(Buffer.from('isom'), 16);
	assert.equal(inspectOperatingSystemAudioSource('aac-m4a', noM4aBrand), null);
});

test('source inspection rejects unreviewed formats at its closed boundary', () => {
	assert.throws(
		() => inspectOperatingSystemAudioSource('opus' as 'mp3', Uint8Array.of(1)),
		/format/iu,
	);
});
