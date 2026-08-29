/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperNativeImageSequenceActionRuntimeNativeMedia as createRuntime,
	framescaperNativeImageSequenceActionBridgeAvailableNativeMedia as bridgeAvailable,
} from '../src/framescaper/editor-native-image-sequence-action.ts';
import {
	createFramescaperProjectNativeMedia,
} from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const BRIDGE_METHODS = Object.freeze([
	'capabilities', 'selectImageSequence', 'readImageSequenceFile', 'releaseImageSequence',
	'imageSequenceImport', 'writeImageSequenceImportChunk', 'readImageSequenceImportBody',
]);

function bridge(): Data {
	return Object.fromEntries(BRIDGE_METHODS.map((method) => [method, async () => null]));
}

function store(): Data {
	return {
		getMediaAssetMetadata: async () => null,
		beginMediaAssetWrite: async () => ({}),
	};
}

function owner(): Data {
	return {
		project: createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options() as never),
		actions: {
			edit: { commit: async () => undefined, undo: async () => undefined },
			project: { save: async () => undefined },
		},
	};
}

function options(overrides: Data = {}): never {
	return {
		profile: PROFILE, owner: owner(), bridge: bridge(), store: store(), ...overrides,
	} as unknown as never;
}

test('an image-sequence bridge needs every one of its seven ports', () => {
	assert.equal(bridgeAvailable(bridge()), true);

	for (const method of BRIDGE_METHODS) {
		const partial = bridge();
		delete partial[method];
		assert.equal(
			bridgeAvailable(partial),
			false,
			`a bridge missing ${method} must not be treated as available`,
		);
	}
});

test('a non-record bridge is never available', () => {
	assert.equal(bridgeAvailable(null), false);
	assert.equal(bridgeAvailable([]), false);
	assert.equal(bridgeAvailable('bridge'), false);
});

test('the image-sequence runtime registers exactly its import surface', () => {
	assert.deepEqual(createRuntime(options()).surfaces, ['image-sequence-import']);
});

test('an inexact runtime profile is refused at binding time', () => {
	assert.throws(() => createRuntime(options({ profile: {} })), TypeError);
});

test('an incomplete store, controller or identity factory is refused', () => {
	assert.throws(() => createRuntime(options({ store: {} })), TypeError);
	assert.throws(
		() => createRuntime(options({ store: { getMediaAssetMetadata: async () => null } })),
		TypeError,
	);
	assert.throws(() => createRuntime(options({ owner: { project: owner().project } })), TypeError);
	assert.throws(
		() => createRuntime(options({
			owner: { ...owner(), actions: { edit: { commit: async () => undefined } } },
		})),
		TypeError,
	);
	assert.throws(() => createRuntime(options({ mintId: 1 })), TypeError);
});

test('a binding is admitted before the controller has a project to import into', () => {
	assert.doesNotThrow(
		() => createRuntime(options({
			owner: {
				actions: {
					edit: { commit: async () => undefined, undo: async () => undefined },
					project: { save: async () => undefined },
				},
			},
		})),
		'native surfaces bind while the controller is still being built',
	);
});

test('an import request that is absent or malformed is refused', async () => {
	const runtime = createRuntime(options()) as unknown as Data;
	const run = runtime.run as (surface: string, request: unknown) => Promise<void>;

	await assert.rejects(() => run('image-sequence-import', undefined), TypeError);
	await assert.rejects(() => run('image-sequence-import', { unexpected: 1 }), TypeError);
	await assert.rejects(() => run('image-sequence-import', null), TypeError);
});
