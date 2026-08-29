/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperNativeOpenFxActionRuntimeNativeMedia as createComposition,
	framescaperNativeOpenFxActionBridgeAvailableNativeMedia as bridgeAvailable,
} from '../src/framescaper/editor-native-openfx-action.ts';
import {
	createFramescaperProjectNativeMedia,
} from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const OFX_ENTRY = Object.freeze({
	domain: 'ofx',
	id: 'isolated-host',
	policyCleared: true,
	buildSupported: true,
	probeSucceeded: true,
	selfTestPassed: true,
	userEnabled: true,
});

function owner(): Data {
	return {
		project: createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options() as never),
		actions: {
			edit: { commit: async () => undefined, undo: async () => undefined },
			project: { save: async () => undefined },
		},
	};
}

function bridge(overrides: Data = {}, hostEnabled = true): Data {
	return {
		capabilities: async () => createNativeMediaCapabilitySnapshotV1({
			masterEnabled: hostEnabled,
			entries: hostEnabled ? [OFX_ENTRY] : [],
		} as never),
		listOpenFxPlugins: async () => [],
		...overrides,
	};
}

function composition(overrides: Data = {}): Data {
	return createComposition({
		profile: PROFILE,
		owner: owner(),
		bridge: bridge(),
		...overrides,
	} as never) as unknown as Data;
}

function authoring(built: Data): Data {
	return built.authoringRuntime as Data;
}

test('a bridge is recognised only when it offers both OpenFX ports', () => {
	assert.equal(bridgeAvailable(bridge()), true);
	assert.equal(bridgeAvailable({ capabilities: async () => undefined }), false);
	assert.equal(bridgeAvailable({ listOpenFxPlugins: async () => [] }), false);
	assert.equal(bridgeAvailable(null), false);
	assert.equal(bridgeAvailable([]), false);
	assert.equal(bridgeAvailable('bridge'), false);
});

test('the OpenFX composition registers exactly its add surface', () => {
	assert.deepEqual((composition().actionRuntime as Data).surfaces, ['ofx-add']);
});

test('an authoring model reports the filter targets the open project offers', async () => {
	const model = await (authoring(composition()).model as () => Promise<Data>)();

	assert.deepEqual(model.plugins, []);
	assert.ok(Array.isArray(model.targets));
	assert.ok(
		(model.targets as Data[]).some((target) => target.context === 'filter'),
		'a project with a video clip must offer a filter target',
	);
});

test('an interact model with no installed plug-ins reports no instances', async () => {
	const model = await (authoring(composition()).interactModel as () => Promise<Data>)();

	assert.deepEqual(model.instances, []);
});

test('an incomplete controller, bridge or identity factory is refused', () => {
	assert.throws(() => composition({ owner: {} }), TypeError);
	assert.throws(() => composition({ bridge: {} }), TypeError);
	assert.throws(() => composition({ mintId: 1 }), TypeError);
	assert.throws(
		() => composition({
			owner: { project: {}, actions: { edit: { commit: async () => undefined } } },
		}),
		TypeError,
	);
});

test('authoring is refused when the isolated OpenFX host is not usable', async () => {
	const built = composition({ bridge: bridge({}, false) });

	await assert.rejects(
		() => (authoring(built).model as () => Promise<Data>)(),
		/unavailable in the exact native runtime/u,
	);
});

test('a plug-in inventory that is sparse or oversized is refused', async () => {
	const sparse = composition({
		bridge: bridge({
			listOpenFxPlugins: async () => {
				const values: unknown[] = [];
				values.length = 3;
				return values;
			},
		}),
	});
	const oversized = composition({
		bridge: bridge({ listOpenFxPlugins: async () => Array.from({ length: 1_025 }, () => ({})) }),
	});

	await assert.rejects(
		() => (authoring(sparse).model as () => Promise<Data>)(),
		/must be a bounded dense array/u,
	);
	await assert.rejects(
		() => (authoring(oversized).model as () => Promise<Data>)(),
		/must be a bounded dense array/u,
	);
});

test('the interact model applies the same inventory bound as the authoring model', async () => {
	const built = composition({
		bridge: bridge({ listOpenFxPlugins: async () => Array.from({ length: 1_025 }, () => ({})) }),
	});

	await assert.rejects(
		() => (authoring(built).interactModel as () => Promise<Data>)(),
		/must be a bounded dense array/u,
	);
});
