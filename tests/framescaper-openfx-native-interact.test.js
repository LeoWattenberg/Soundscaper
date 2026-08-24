/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
	buildOpenFxNativeContractFixture as buildContractFixture,
	cleanupOpenFxNativeContractFixture,
} from './helpers/openfx-native-scanner-fixture.js';
import { sha256 } from './helpers/openfx-native-v12-fixture.js';
import { runNativeExecutable as run } from './helpers/openfx-native-runtime-process.js';

test.after(cleanupOpenFxNativeContractFixture);

test('native Interact hydrates authored state, preserves ordered actions, and returns typed mutations', (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		const events = [
			{ kind: 'focus', sequence: 1, focused: true },
			{ kind: 'pointer', phase: 'down', sequence: 2, x: 0.25, y: 0.75,
				button: 1, modifiers: ['shift'] },
			{ kind: 'pointer', phase: 'motion', sequence: 3, x: 0.5, y: 0.5,
				button: 1, modifiers: ['shift'] },
			{ kind: 'pointer', phase: 'up', sequence: 4, x: 0.5, y: 0.5,
				button: 1, modifiers: [] },
			{ kind: 'keyboard', phase: 'down', sequence: 5, key: 'Enter', code: 'Enter',
				modifiers: [] },
			{ kind: 'keyboard', phase: 'up', sequence: 6, key: 'Enter', code: 'Enter',
				modifiers: [] },
			{ kind: 'focus', sequence: 7, focused: false },
		];
		const overlay = invoke(build, {
			target: 'overlay', parameterName: null, events,
			parameters: [{ name: 'parameter0', type: 'integer', value: 3,
				keyframes: [{ frame: 12, value: 9 }] }],
		}, 'overlay');
		assert.equal(overlay.status, 0, overlay.stderr);
		const result = JSON.parse(overlay.stdout);
		assert.deepEqual(result.project, { id: 'selected-v28', revision: 9 });
		assert.equal(result.instanceId, 'authored-effect');
		assert.equal(result.effectStateSha256, '44'.repeat(32));
		assert.deepEqual(result.acceptedSequences, [1, 2, 3, 4, 5, 6, 7]);
		assert.deepEqual(result.parameterMutations, [{
			parameter: { name: 'parameter0', type: 'integer', value: 42,
				keyframes: [{ frame: 12, value: 9 }] },
		}]);
		assert.equal(result.surfaceDisposition, 'drawn');
		assert.equal(result.rgbaHex.length, 64 * 64 * 4 * 2);
		assert.equal(result.drawCalls, 3);
		assert.equal(result.pixelsTouched, 10);
	} finally { build.cleanup(); }
});

test('native ReplyDefault/no-draw custom Interact returns a retained transparent surface', (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		const noop = invoke(build, {
			target: 'custom-parameter', parameterName: 'parameter15', events: [],
			parameters: [{ name: 'parameter15', type: 'custom', value: 'reply-default', keyframes: [] }],
		}, 'no-op');
		assert.equal(noop.status, 0, noop.stderr);
		const result = JSON.parse(noop.stdout);
		assert.equal(result.surfaceDisposition, 'retained');
		assert.equal(result.drawCalls, 0);
		assert.equal(result.pixelsTouched, 0);
		assert.equal(result.rgbaHex, '00'.repeat(64 * 64 * 4));
		assert.deepEqual(result.parameterMutations, []);
	} finally { build.cleanup(); }
});

function invoke(build, request, suffix) {
	const path = join(build.directory, `interact-${suffix}.json`);
	const bytes = Buffer.from(JSON.stringify({
		schemaVersion: 1,
		pluginBinary: { path: build.plugin, sha256: build.sha256, pluginIndex: 0,
			pluginId: 'org.framescaper.conformance' },
		project: { id: 'selected-v28', revision: 9 }, instanceId: 'authored-effect',
		effectStateSha256: '44'.repeat(32), context: 'filter',
		target: request.target, parameterName: request.parameterName,
		parameters: request.parameters, events: request.events,
	}));
	writeFileSync(path, bytes);
	return run(build.runtime, [
		'--interact-v1-grant', path, '--grant-sha256', sha256(bytes),
	]);
}
