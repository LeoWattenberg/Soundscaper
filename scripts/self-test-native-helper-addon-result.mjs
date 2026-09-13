#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Load one target-native helper result and emit its bounded machine receipt. */

import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, isAbsolute, join, resolve } from 'node:path';

import { nativeHelperAddonTargetForRuntime } from './lib/native-helper-addon-build.mjs';
import {
	FIXTURE_PLUGIN_SUFFIX,
	FIXTURE_PLUGIN_VARIANTS,
} from './lib/native-fixture-plugins.mjs';

const values = parseArguments(process.argv.slice(2));
const payload = canonicalFile(values.payload);
const fixtureRoot = canonicalDirectory(values.fixtures);
const expected = nativeHelperAddonTargetForRuntime(process.platform, process.arch);
if (expected?.id !== values.target) {
	throw new Error(`Self-test target ${values.target} requires its target-native Node.js runtime.`);
}
const addon = createRequire(import.meta.url)(payload);
const description = addon.describe();
if (description?.addonVersion !== values.version || description?.napiVersion !== 8
	|| description?.buildId !== `${values.version}+${values.target}`
	|| description?.capabilities?.syntheticRealtimeEngine !== true
	|| description?.capabilities?.audioBackendDiscovery !== true) {
	throw new Error('The target-native helper description does not match its build request.');
}
const backends = addon.enumerateAudioBackends();
if (!Array.isArray(backends)
	|| backends.map(({ backend }) => backend).join(',') !== 'alsa,jack,pipewire') {
	throw new Error('The target-native helper did not expose its complete audio-backend inventory.');
}
const candidates = addon.listPluginCandidates(fixtureRoot, FIXTURE_PLUGIN_SUFFIX);
const expectedFixtureNames = FIXTURE_PLUGIN_VARIANTS
	.map(({ name }) => `${name}${FIXTURE_PLUGIN_SUFFIX}`).sort();
if (!Array.isArray(candidates)
	|| candidates.map((path) => basename(path)).sort().join(',') !== expectedFixtureNames.join(',')) {
	throw new Error('The target-native helper did not discover its complete fixture inventory.');
}
let inspectedFixtureCount = 0;
for (const variant of FIXTURE_PLUGIN_VARIANTS) {
	if (variant.behaviour === 'CRASH_ON_SCAN' || variant.behaviour === 'HANG_ON_SCAN') continue;
	const result = addon.inspectPluginCandidate(join(fixtureRoot,
		`${variant.name}${FIXTURE_PLUGIN_SUFFIX}`));
	const expectedStatus = variant.kind === 'text' ? 'not-a-module'
		: variant.kind === 'module-without-entry' ? 'no-entry' : 'ok';
	if (result?.status !== expectedStatus
		|| (variant.kind === 'compiled' && result.stableId !== variant.stableId)) {
		throw new Error(`The target-native helper misclassified fixture ${variant.name}.`);
	}
	inspectedFixtureCount += 1;
}
const hostedVariants = [
	{ name: 'clean-effect', expected: (sample) => sample },
	{ name: 'gain-effect', expected: (sample) => sample * 0.5 },
	{ name: 'impulse-effect', expected: (_sample, frame) => frame === 0 ? 1 : 0 },
];
const pluginFrameCount = 8;
let hostedFixtureCount = 0;
for (const variant of hostedVariants) {
	const handle = addon.openPluginInstance(join(fixtureRoot,
		`${variant.name}${FIXTURE_PLUGIN_SUFFIX}`), 48_000, pluginFrameCount);
	const input = Array.from({ length: 2 }, (_unused, channel) => Float32Array.from(
		{ length: pluginFrameCount }, (_entry, frame) => channel * 16 + frame,
	));
	const output = Array.from({ length: 2 }, () => new Float32Array(pluginFrameCount));
	if (addon.processPluginBlock(handle, pluginFrameCount, input, output) !== pluginFrameCount) {
		throw new Error(`The target-native helper did not host fixture ${variant.name}.`);
	}
	for (let channel = 0; channel < output.length; channel += 1) {
		for (let frame = 0; frame < pluginFrameCount; frame += 1) {
			if (output[channel][frame] !== variant.expected(input[channel][frame], frame)) {
				throw new Error(`The target-native helper misrendered fixture ${variant.name}.`);
			}
		}
	}
	hostedFixtureCount += 1;
}
const frameCount = 64;
const channelCount = 2;
const configuration = {
	channelCount, frameCount, sampleRate: 48_000, generation: 7,
	mode: 3, fault: 0, gain: 1, faultFrame: 0,
};
const engine = addon.createSyntheticEngine(configuration);
const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
const renderedFrames = addon.renderSyntheticBlock(engine, 0, frameCount, null, channels);
for (const channel of channels) {
	for (let frame = 0; frame < frameCount; frame += 1) {
		if (channel[frame] !== (frame === 0 ? 1 : 0)) {
			throw new Error('The target-native helper failed its deterministic synthetic render.');
		}
	}
}
if (renderedFrames !== frameCount || addon.expectedSyntheticSample({ generation: 7, mode: 3 }, 0, 0) !== 1) {
	throw new Error('The target-native helper reported the wrong synthetic render result.');
}
const renderSha256 = createHash('sha256');
for (const channel of channels) {
	renderSha256.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
}
const observation = {
	status: 'passed', runtime: expected.runtime, addonVersion: description.addonVersion,
	napiVersion: description.napiVersion, buildId: description.buildId,
	backendCount: backends.length, renderedFrames, fixtureCount: candidates.length,
	inspectedFixtureCount, hostedFixtureCount, renderSha256: renderSha256.digest('hex'),
};
const output = `${JSON.stringify(observation)}\n`;
process.stdout.write(output);
process.stderr.write(`receipt-sha256 ${createHash('sha256').update(output).digest('hex')}\n`);

function parseArguments(args) {
	const output = {};
	for (const argument of args) {
		const match = /^--(fixtures|payload|target|version)=(.+)$/u.exec(argument);
		if (!match || output[match[1]] !== undefined) {
			throw new TypeError(`Unsupported or duplicate argument ${argument}.`);
		}
		output[match[1]] = match[2];
	}
	for (const name of ['fixtures', 'payload', 'target', 'version']) {
		if (!output[name]) throw new TypeError(`--${name}=... is required.`);
	}
	return output;
}

function canonicalDirectory(value) {
	if (!isAbsolute(value) || resolve(value) !== value || value.includes('\0')) {
		throw new TypeError('The self-test fixture root must be an absolute normalized path.');
	}
	const metadata = lstatSync(value);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(value) !== value) {
		throw new Error('The self-test fixture root must be one canonical directory.');
	}
	return value;
}

function canonicalFile(value) {
	if (!isAbsolute(value) || resolve(value) !== value || value.includes('\0')) {
		throw new TypeError('The self-test payload must be an absolute normalized path.');
	}
	const metadata = lstatSync(value);
	if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(value) !== value) {
		throw new Error('The self-test payload must be one canonical regular file.');
	}
	return value;
}
