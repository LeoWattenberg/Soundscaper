/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The native PipeWire backend, exercised against the real addon.
 *
 * A machine with no PipeWire daemon — a container, a build agent, this WSL2
 * host — is the normal case for CI, and it is the case these assertions are
 * written around: what must hold everywhere is that an absent server is a typed
 * status rather than a crash, and that no request is ever silently substituted.
 * Whether audio actually flows is a question only the provisioned native lab
 * can answer, and nothing here pretends otherwise.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { HELPER_AUDIO_BACKENDS } from '../desktop/helper-job-grant.ts';
import {
	nativeHelperAddonTargetForRuntime,
	readNativeHelperAddonSourceManifest,
} from '../scripts/lib/native-helper-addon-build.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const manifest = readNativeHelperAddonSourceManifest(ROOT);
const hostTarget = nativeHelperAddonTargetForRuntime(process.platform, process.arch);
const built = hostTarget !== null && manifest.targets[hostTarget.id]?.status === 'built';

function addon() {
	return createRequire(import.meta.url)(
		join(ROOT, 'native/soundscaper-helper-addon/prebuilt', hostTarget.id, manifest.payloadName),
	);
}

const OUTPUT = 1;
const BASE_REQUEST = Object.freeze({
	deviceHandle: '@DEFAULT_SINK@',
	direction: OUTPUT,
	exclusive: 0,
	sampleRate: 48_000,
	periodFrames: 1_024,
	channelCount: 2,
});

test('pipewire is a declared backend and the contract admits it', () => {
	assert.ok(HELPER_AUDIO_BACKENDS.includes('pipewire'));
	// ALSA stays for direct hw: access; the addition is not a replacement.
	assert.ok(HELPER_AUDIO_BACKENDS.includes('alsa'));
});

test('the vendored headers are pinned to the tag the addon was built against', () => {
	const upstream = readFileSync(join(ROOT, 'vendor/pipewire-headers/UPSTREAM'), 'utf8');
	assert.match(upstream, /^tag: 1\.0\.5$/mu);
	assert.match(upstream, /^license: MIT$/mu);
	assert.match(upstream, /^archive-sha256: [a-f\d]{64}$/mu);
	assert.match(readFileSync(join(ROOT, 'vendor/pipewire-headers/COPYING'), 'utf8'), /Permission is hereby granted/u);
	assert.deepEqual(manifest.toolchain.vendoredHeaders.license, 'MIT');
	assert.equal(manifest.toolchain.vendoredHeaders.root, 'vendor/pipewire-headers');
});

test('every backend answers discovery with a typed status, never a throw', { skip: !built }, () => {
	const reported = addon().enumerateAudioBackends();
	const byName = new Map(reported.map((entry) => [entry.backend, entry]));
	assert.deepEqual([...byName.keys()].sort(), ['alsa', 'jack', 'pipewire']);
	for (const entry of reported) {
		assert.match(entry.status, /^(?:available|library-absent|symbols-absent|unsupported-platform|server-absent)$/u);
		// A backend that is not available must publish nothing, so an empty list
		// can never be mistaken for "this backend found no devices".
		if (entry.status !== 'available') assert.deepEqual(entry.devices, []);
	}
});

test('an absent PipeWire server is reported rather than started', { skip: !built }, () => {
	const pipewire = addon().enumerateAudioBackends().find(({ backend }) => backend === 'pipewire');
	assert.ok(pipewire);
	if (pipewire.status === 'available') {
		// A host that does have a session: the defaults are what the user chose.
		assert.deepEqual(pipewire.devices.map(({ handle }) => handle), ['@DEFAULT_SINK@', '@DEFAULT_SOURCE@']);
		return;
	}
	assert.equal(pipewire.status, 'server-absent');
	assert.match(pipewire.detail, /does not start one/u);
});

test('opening a device answers with a status instead of throwing', { skip: !built }, () => {
	const result = addon().openAudioDevice(BASE_REQUEST);
	assert.match(result.status, /^(?:ok|backend-unavailable|device-unavailable|format-refused|mode-refused)$/u);
	if (result.status !== 'ok') {
		assert.equal(typeof result.detail, 'string');
		assert.equal(result.session, undefined, 'a refused open must hand back no session handle');
		return;
	}
	// Where a session does open, the granted values are reported separately from
	// the requested ones — that separation is the point of the whole surface.
	assert.equal(typeof result.grantedSampleRate, 'number');
	assert.equal(typeof result.grantedPeriodFrames, 'number');
	assert.equal(result.grantedChannelCount, BASE_REQUEST.channelCount);
	assert.equal(result.grantedExclusive, false);
	assert.equal(addon().closeAudioDevice(result.session), true);
});

test('a malformed open request is refused before any device is touched', { skip: !built }, () => {
	const native = addon();
	for (const [field, value] of [
		['channelCount', 0],
		['periodFrames', 0],
		['sampleRate', 10],
		['direction', 2],
	]) {
		const result = native.openAudioDevice({ ...BASE_REQUEST, [field]: value });
		assert.equal(result.status, 'invalid-request', `${field}=${String(value)} must be refused`);
		assert.equal(result.session, undefined);
	}
	assert.throws(() => native.openAudioDevice({ deviceHandle: '' }), /requires its device handle/u);
});

test('duplex is refused rather than faked from two half-duplex handles', { skip: !built }, () => {
	const result = addon().openAudioDevice({ ...BASE_REQUEST, direction: 2 });
	assert.equal(result.status, 'invalid-request');
	assert.match(result.detail, /duplex/u);
});

test('transferring on a closed or absent session is a status, not a crash', { skip: !built }, () => {
	const native = addon();
	const opened = native.openAudioDevice(BASE_REQUEST);
	if (opened.status !== 'ok') return;
	native.closeAudioDevice(opened.session);
	const channels = [new Float32Array(64), new Float32Array(64)];
	assert.equal(native.writeAudioDevice(opened.session, 64, channels).status, 'closed');
	// Closing twice must not reach the library with a freed handle.
	assert.equal(native.closeAudioDevice(opened.session), true);
});
