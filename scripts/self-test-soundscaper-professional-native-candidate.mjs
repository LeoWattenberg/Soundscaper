#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Installed-addon contract probe used by the professional candidate receipt. */

import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';

import {
	expectedSoundscaperProfessionalNativeInventory,
} from './lib/soundscaper-professional-native-candidate-contract.mjs';

if (process.argv.length !== 4) {
	throw new TypeError('Usage: self-test-soundscaper-professional-native-candidate.mjs <addon> <target>');
}
const addonPath = process.argv[2];
if (!isAbsolute(addonPath) || resolve(addonPath) !== addonPath) {
	throw new TypeError('The professional addon self-test requires an absolute normalized path.');
}
const target = process.argv[3];
const expected = expectedSoundscaperProfessionalNativeInventory(target);
const addon = createRequire(import.meta.url)(addonPath);
const exports_ = [
	'closeAudioDevice', 'decodeOperatingSystemAacM4a', 'decodeOperatingSystemMp3',
	'describe', 'encodeOperatingSystemAacM4a', 'encodeOperatingSystemMp3',
	'enumerateAudioBackends', 'listPluginCandidates', 'openAudioDevice',
	'readAudioDevice', 'writeAudioDevice',
];
assert(JSON.stringify(Object.keys(addon).sort()) === JSON.stringify(exports_),
	'The professional addon export inventory changed.');
const description = addon.describe();
assert(description?.addonVersion === '1.0.0'
	&& description.buildId === 'soundscaper-professional-host'
	&& description.napiVersion === 8
	&& description.maximumChannelCount === 4_096
	&& description.maximumFrameCount === 65_536
	&& JSON.stringify(description.pluginFormats) === JSON.stringify(expected.addonPluginFormats),
'The professional addon identity or exact format inventory changed.');
const backends = addon.enumerateAudioBackends();
assert(Array.isArray(backends)
	&& JSON.stringify(backends.map(({ backend }) => backend)) === JSON.stringify(expected.backends),
'The professional addon backend inventory changed.');
for (const row of backends) {
	assert(row && JSON.stringify(Object.keys(row).sort())
		=== JSON.stringify(['backend', 'detail', 'devices', 'status'])
		&& typeof row.status === 'string' && row.status.length > 0
		&& typeof row.detail === 'string' && Array.isArray(row.devices),
	'The professional addon returned a malformed backend row.');
}
process.stdout.write(`${JSON.stringify({
	schemaVersion: 1,
	status: 'passed',
	target,
	backends: expected.backends,
	addonPluginFormats: expected.addonPluginFormats,
	peerPluginFormats: expected.peerPluginFormats,
})}\n`);

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
