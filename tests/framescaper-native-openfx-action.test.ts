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
import { applyFramescaperProjectCommandNativeMedia } from
	'../src/framescaper/editor-project-native-media-commands.ts';
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

test('all mutating OpenFX entry points share one save-and-rollback queue', async () => {
	const projectOptions = framescaperV20Options() as Data;
	let project = createFramescaperProjectNativeMedia(PROFILE, {
		...projectOptions,
		selection: {
			...(projectOptions.selection as Data), clipIds: ['video-clip'], trackIds: ['video-track'],
		},
	} as never);
	const history: typeof project[] = [];
	const firstSave = deferred<void>();
	const firstSaveStarted = deferred<void>();
	let saveCount = 0;
	let commitCount = 0;
	const controller = {
		get project() { return project; },
		actions: {
			edit: {
				commit: async (command: unknown) => {
					history.push(project);
					commitCount += 1;
					project = applyFramescaperProjectCommandNativeMedia(
						PROFILE, project, command, { now: `2026-08-31T12:00:0${String(commitCount)}.000Z` },
					);
				},
				undo: async () => { project = history.pop()!; },
			},
			project: {
				save: async () => {
					saveCount += 1;
					if (saveCount === 1) {
						firstSaveStarted.resolve();
						await firstSave.promise;
					}
				},
			},
		},
	};
	const plugin = {
		pluginHandle: '12'.repeat(20), pluginId: 'net.example.Filter', vendor: 'Example',
		version: { major: 1, minor: 0 }, binarySha256: 'ab'.repeat(32),
		supportedContexts: ['filter'], parameters: [], components: ['RGBA'], pixelDepths: ['byte'],
		threading: 'instance-safe', state: 'enabled', quarantined: false,
	};
	let mint = 0;
	const built = composition({
		owner: controller,
		bridge: bridge({ listOpenFxPlugins: async () => [plugin] }),
		mintId: () => `ofx-${String(++mint)}`,
	});
	const author = authoring(built);
	const model = await (author.model as () => Promise<Data>)();
	const target = (model.targets as Data[]).find(({ context }) => context === 'filter')!;
	const first = (built.actionRuntime as { run(surface: 'ofx-add'): Promise<void> }).run('ofx-add');
	await Promise.race([
		firstSaveStarted.promise,
		first.then(() => { throw new Error('first OpenFX operation ended before save'); }),
	]);
	const second = (author.author as (request: unknown) => Promise<void>)({
		pluginHandle: plugin.pluginHandle, context: 'filter', targetId: target.targetId,
		inputs: target.inputs, parameters: [], customEncodings: {},
	});
	await new Promise<void>((resolve) => setImmediate(resolve));
	const commitsBeforeRollback = commitCount;
	firstSave.reject(new Error('first save failed'));
	await assert.rejects(first, /first save failed/u);
	await second;
	assert.equal(commitsBeforeRollback, 1,
		'a second entry point must not commit while the first save can still roll back');
});

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((accept, refuse) => { resolve = accept; reject = refuse; });
	return { promise, resolve, reject };
}
