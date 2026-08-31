/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { framescaperOpenFxPluginProjectionV1 } from '../src/common/editor/native-ofx-service-contract.ts';

const projection = Object.freeze({
	pluginHandle: 'ab'.repeat(20), pluginId: 'net.example.Filter', vendor: 'Example',
	version: { major: 1, minor: 0 }, binarySha256: 'cd'.repeat(32),
	supportedContexts: ['filter'], parameters: [], components: ['RGBA'], pixelDepths: ['byte'],
	threading: 'instance-safe', state: 'enabled', quarantined: false,
});

test('OpenFX projection identity fields reject coercible non-strings', () => {
	assert.equal(framescaperOpenFxPluginProjectionV1(projection).pluginId, 'net.example.Filter');
	for (const [key, value] of [
		['pluginHandle', [projection.pluginHandle]],
		['pluginId', [projection.pluginId]],
		['vendor', [projection.vendor]],
		['binarySha256', [projection.binarySha256]],
	] as const) {
		assert.throws(
			() => framescaperOpenFxPluginProjectionV1({ ...projection, [key]: value }),
			/invalid identity or state/u,
		);
	}
});

test('OpenFX projection parameter names reject coercible non-strings', () => {
	const parameter = { name: 'Gain', type: 'double', animates: true };
	assert.equal(framescaperOpenFxPluginProjectionV1({
		...projection, parameters: [parameter],
	}).parameters[0]?.name, 'Gain');
	for (const name of [['Gain'], new String('Gain'), { toString: () => 'Gain' }]) {
		assert.throws(
			() => framescaperOpenFxPluginProjectionV1({
				...projection, parameters: [{ ...parameter, name }],
			}),
			/parameter projection is invalid/u,
		);
	}
});
