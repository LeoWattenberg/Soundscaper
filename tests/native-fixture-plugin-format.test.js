/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The benign format fixtures, exercised through the real addon against real
 * shared libraries loaded by the real dynamic loader.
 *
 * The crash and hang fixtures are deliberately NOT exercised here: they really
 * abort and really hang, which is the whole point of them, and running them in
 * this process would take the test runner with them. They are exercised by
 * native-fixture-plugin-fault-supervision.test.js, which runs them in a
 * supervised helper process where a dead helper is the observation being made
 * rather than an accident.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';

import {
	FIXTURE_PLUGIN_SUFFIX,
	FIXTURE_PLUGIN_VARIANTS,
	auditFixturePlugins,
	fixturePluginDirectory,
} from '../scripts/lib/native-fixture-plugins.mjs';
import {
	nativeHelperAddonTargetForRuntime,
	readNativeHelperAddonSourceManifest,
} from '../scripts/lib/native-helper-addon-build.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const manifest = readNativeHelperAddonSourceManifest(ROOT);
const hostTarget = nativeHelperAddonTargetForRuntime(process.platform, process.arch);
const built = hostTarget !== null
	&& manifest.targets[hostTarget.id]?.status === 'built'
	&& manifest.fixturePlugins?.targets?.[hostTarget.id]?.status === 'built';

function addon() {
	return createRequire(import.meta.url)(
		join(ROOT, 'native/soundscaper-helper-addon/prebuilt', hostTarget.id, manifest.payloadName),
	);
}

function fixturePath(name) {
	return join(fixturePluginDirectory(ROOT, hostTarget.id), `${name}${FIXTURE_PLUGIN_SUFFIX}`);
}

test('the checked-in fixture plug-ins match their pins on every claimed target', () => {
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']) {
		assert.deepEqual(auditFixturePlugins({ repositoryRoot: ROOT, manifest, targetId: target }), []);
	}
});

test('the fixture set covers every discovery and hosting fault the milestone names', () => {
	const names = FIXTURE_PLUGIN_VARIANTS.map(({ name }) => name);
	for (const required of [
		'clean-effect', 'gain-effect', 'impulse-effect', 'instrument', 'duplicate-identity',
		'crash-on-scan', 'hang-on-scan', 'crash-on-process', 'oversize-state', 'unstable-latency',
		'not-a-module', 'no-entry-point',
	]) {
		assert.ok(names.includes(required), `the fixture set must include ${required}`);
	}
});

test('discovery reads descriptors and classifies every benign candidate', { skip: !built }, () => {
	const native = addon();
	const directory = fixturePluginDirectory(ROOT, hostTarget.id);
	const candidates = native.listPluginCandidates(directory, FIXTURE_PLUGIN_SUFFIX).sort();
	assert.equal(candidates.length, FIXTURE_PLUGIN_VARIANTS.length);
	assert.ok(candidates.every((path) => path.startsWith(directory)), 'discovery must not escape its granted root');

	const inspected = new Map();
	for (const path of candidates) {
		const name = basename(path, FIXTURE_PLUGIN_SUFFIX);
		if (name.startsWith('crash') || name.startsWith('hang')) continue;
		inspected.set(name, native.inspectPluginCandidate(path));
	}
	assert.equal(inspected.get('clean-effect').status, 'ok');
	assert.equal(inspected.get('clean-effect').stableId, 'soundscaper.fixture.clean');
	assert.equal(inspected.get('clean-effect').classification, 'effect');
	assert.equal(inspected.get('gain-effect').reportedLatencyFrames, 64);
	assert.equal(inspected.get('instrument').classification, 'instrument');
	assert.equal(inspected.get('not-a-module').status, 'not-a-module');
	assert.equal(inspected.get('no-entry-point').status, 'no-entry');
	// A stable-id collision must be visible to the registry rather than resolved
	// by whichever file the directory happened to yield first.
	assert.equal(inspected.get('duplicate-identity').stableId, inspected.get('clean-effect').stableId);
});

test('a candidate that reports no latency is distinguishable from one reporting zero', { skip: !built }, () => {
	const native = addon();
	assert.equal(native.inspectPluginCandidate(fixturePath('clean-effect')).reportedLatencyFrames, 0);
	assert.equal(native.inspectPluginCandidate(fixturePath('not-a-module')).reportedLatencyFrames, null);
});

test('hosting produces the passthrough, gain and impulse goldens', { skip: !built }, () => {
	const native = addon();
	const frames = 4;
	const input = [Float32Array.from([1, 2, 3, 4]), Float32Array.from([5, 6, 7, 8])];
	const output = [new Float32Array(frames), new Float32Array(frames)];

	const passthrough = native.openPluginInstance(fixturePath('clean-effect'), 48_000, 1_024);
	native.processPluginBlock(passthrough, frames, input, output);
	assert.deepEqual(Array.from(output[0]), [1, 2, 3, 4]);
	assert.deepEqual(Array.from(output[1]), [5, 6, 7, 8]);

	const gain = native.openPluginInstance(fixturePath('gain-effect'), 48_000, 1_024);
	native.processPluginBlock(gain, frames, input, output);
	assert.deepEqual(Array.from(output[0]), [0.5, 1, 1.5, 2]);
	assert.equal(native.pluginLatencyFrames(gain), 64);

	const impulse = native.openPluginInstance(fixturePath('impulse-effect'), 48_000, 1_024);
	native.processPluginBlock(impulse, frames, null, output);
	assert.deepEqual(Array.from(output[0]), [1, 0, 0, 0]);
	native.processPluginBlock(impulse, frames, null, output);
	assert.deepEqual(Array.from(output[0]), [0, 0, 0, 0], 'the impulse must not repeat every block');
});

test('an instrument is never instantiated, however it is asked for', { skip: !built }, () => {
	const native = addon();
	assert.throws(
		() => native.openPluginInstance(fixturePath('instrument'), 48_000, 1_024),
		/refused/u,
		'instruments are identified by scanning but never hosted before milestone 8B',
	);
});

test('opaque state round-trips, and an oversize answer is refused rather than truncated', { skip: !built }, () => {
	const native = addon();
	const instance = native.openPluginInstance(fixturePath('clean-effect'), 48_000, 1_024);
	const state = native.savePluginState(instance);
	assert.ok(state.byteLength > 0 && state.byteLength <= 16 * 1024 * 1024);
	assert.equal(native.loadPluginState(instance, new Uint8Array(state)), true);
	assert.throws(() => native.loadPluginState(instance, new Uint8Array(state.byteLength + 1)), /state-rejected/u);

	const oversize = native.openPluginInstance(fixturePath('oversize-state'), 48_000, 1_024);
	assert.throws(() => native.savePluginState(oversize), /state-too-large/u);
});

test('a block larger than the instance ceiling is refused', { skip: !built }, () => {
	const native = addon();
	const instance = native.openPluginInstance(fixturePath('clean-effect'), 48_000, 64);
	const output = [new Float32Array(128), new Float32Array(128)];
	assert.throws(() => native.processPluginBlock(instance, 128, null, output), /invalid-block/u);
});
