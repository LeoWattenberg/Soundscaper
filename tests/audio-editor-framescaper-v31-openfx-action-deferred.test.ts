/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	createNativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	framescaperNativeOpenFxAuthoringRuntimeForV28 as registeredOpenFxAuthoringRuntimeFor,
} from '../src/common/editor/framescaper-native-openfx-authoring-runtime-registry.ts';
import {
	bindFramescaperNativeProjectActionRuntime,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
	type FramescaperNativeProjectActionRuntime,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	bindDeferredFramescaperNativeOpenFxActionV28,
	type DeferredFramescaperNativeOpenFxActionModuleV28,
} from '../src/framescaper/editor-controller-v31-inherited-bindings.ts';
import {
	createFramescaperNativeOpenFxActionRuntimeV28,
	type FramescaperNativeOpenFxActionRuntimeCompositionV28,
	type FramescaperNativeOpenFxAuthoringRuntimeV28,
} from '../src/framescaper/editor-native-openfx-action-v28.ts';

test('the V28 OpenFX factory returns exact unbound action and authoring runtimes', () => {
	const owner = openFxOwner();
	const created = createFramescaperNativeOpenFxActionRuntimeV28(actionOptions(owner));

	assert.equal(framescaperNativeProjectActionRuntimeFor(owner), null);
	assert.equal(registeredOpenFxAuthoringRuntimeFor(owner), null);
	assert.deepEqual(created.actionRuntime.surfaces, ['ofx-add']);
	assert.deepEqual(
		Reflect.ownKeys(created.authoringRuntime).sort(),
		['author', 'commitInteract', 'interactModel', 'model'],
	);
});

test('deferred F31 OpenFX registers menu and authoring proxies before one shared first load', async () => {
	const owner = boundOpenFxOwner();
	const release = deferred<void>();
	const calls: string[] = [];
	let loads = 0;
	let creations = 0;
	const runtime = bindDeferredFramescaperNativeOpenFxActionV28(
		actionOptions(owner), async () => {
			loads += 1;
			await release.promise;
			return openFxModule(() => {
				creations += 1;
				return openFxComposition(calls);
			});
		},
	);
	const authoring = registeredOpenFxAuthoringRuntimeFor(owner) as
		FramescaperNativeOpenFxAuthoringRuntimeV28 | null;

	assert.equal(loads, 0);
	assert.equal(framescaperNativeProjectActionRuntimeFor(owner), runtime);
	assert.deepEqual(runtime.surfaces, ['render-queue-enqueue', 'ofx-add']);
	assert.ok(authoring);
	const operations = [
		runtime.run('ofx-add', { ordinal: 1 }),
		authoring.model(),
		authoring.author({} as never),
		authoring.interactModel(),
		authoring.commitInteract({} as never, {} as never),
	];
	await Promise.resolve();
	assert.equal(loads, 1, 'menu and all authoring calls share the first module load');
	release.resolve();
	await Promise.all(operations);
	await runtime.run('ofx-add', { ordinal: 2 });
	await authoring.model();

	assert.deepEqual({ loads, creations }, { loads: 1, creations: 1 });
	assert.deepEqual(calls.sort(), [
		'action', 'action', 'author', 'commitInteract', 'interactModel', 'model', 'model',
	]);
});

test('deferred OpenFX load and malformed factory failures retry without replacing proxies', async () => {
	const owner = boundOpenFxOwner();
	const loadFailure = new Error('OpenFX module unavailable');
	let loads = 0;
	let creations = 0;
	const runtime = bindDeferredFramescaperNativeOpenFxActionV28(
		actionOptions(owner), async () => {
			loads += 1;
			if (loads === 1) throw loadFailure;
			if (loads === 2) {
				return openFxModule(() => ({
					actionRuntime: ofxActionRuntime(async () => undefined),
					authoringRuntime: Object.freeze({ model: null }),
				}) as unknown as FramescaperNativeOpenFxActionRuntimeCompositionV28);
			}
			return openFxModule(() => {
				creations += 1;
				return openFxComposition([]);
			});
		},
	);
	const authoring = registeredOpenFxAuthoringRuntimeFor(owner) as
		FramescaperNativeOpenFxAuthoringRuntimeV28;

	const first = await Promise.allSettled([
		runtime.run('ofx-add'),
		authoring.model(),
	]);
	for (const result of first) {
		assert.equal(result.status === 'rejected' ? result.reason : null, loadFailure);
	}
	assert.equal(loads, 1);
	await assert.rejects(runtime.run('ofx-add'), /invalid OpenFX action composition/iu);
	assert.equal(loads, 2);
	await Promise.all([runtime.run('ofx-add'), authoring.model()]);
	await authoring.interactModel();

	assert.deepEqual({ loads, creations }, { loads: 3, creations: 1 });
	assert.equal(framescaperNativeProjectActionRuntimeFor(owner), runtime);
	assert.equal(registeredOpenFxAuthoringRuntimeFor(owner), authoring);
});

test('ordinary deferred OpenFX action and authoring failures retain the loaded composition', async () => {
	const owner = boundOpenFxOwner();
	const actionFailure = new Error('OpenFX action failed');
	const authoringFailure = new Error('OpenFX authoring failed');
	let loads = 0;
	let creations = 0;
	let actions = 0;
	let authors = 0;
	const runtime = bindDeferredFramescaperNativeOpenFxActionV28(
		actionOptions(owner), async () => {
			loads += 1;
			return openFxModule(() => {
				creations += 1;
				return openFxComposition([], {
					action: async () => {
						actions += 1;
						if (actions === 1) throw actionFailure;
					},
					author: async () => {
						authors += 1;
						if (authors === 1) throw authoringFailure;
					},
				});
			});
		},
	);
	const authoring = registeredOpenFxAuthoringRuntimeFor(owner) as
		FramescaperNativeOpenFxAuthoringRuntimeV28;

	await assert.rejects(runtime.run('ofx-add'), (error) => error === actionFailure);
	await assert.rejects(authoring.author({} as never), (error) => error === authoringFailure);
	await runtime.run('ofx-add');
	await authoring.author({} as never);

	assert.deepEqual(
		{ loads, creations, actions, authors },
		{ loads: 1, creations: 1, actions: 2, authors: 2 },
	);
});

test('the F31 binder owns OpenFX through the common registry and one dynamic import', () => {
	const inherited = source('src/framescaper/editor-controller-v31-inherited-bindings.ts');
	assert.match(
		inherited,
		/from '\.\.\/common\/editor\/framescaper-native-openfx-authoring-runtime-registry\.ts'/u,
	);
	assert.match(inherited, /import\('\.\/editor-native-openfx-action-v28\.ts'\)/u);
	assert.doesNotMatch(
		inherited,
		/import \{[^}]+\} from '\.\/editor-native-openfx-action-v28\.ts'/su,
	);
	assert.match(
		source('src/framescaper/editor-native-openfx-action-v28.ts'),
		/export function createFramescaperNativeOpenFxActionRuntimeV28/u,
	);
});

function openFxOwner(): ReturnType<typeof ownerFixture> {
	return ownerFixture();
}

function boundOpenFxOwner(): ReturnType<typeof ownerFixture> {
	const owner = ownerFixture();
	bindFramescaperNativeProjectActionRuntime(owner,
		createFramescaperNativeProjectActionSubsetRuntime(['render-queue-enqueue'], {
			'render-queue-enqueue': async () => undefined,
		}));
	return owner;
}

function ownerFixture() {
	return {
		project: Object.freeze({}),
		actions: Object.freeze({
			edit: Object.freeze({
				commit: async () => undefined,
				undo: async () => undefined,
			}),
			project: Object.freeze({ save: async () => undefined }),
		}),
	};
}

function actionOptions(
	owner: ReturnType<typeof ownerFixture>,
): Parameters<typeof bindDeferredFramescaperNativeOpenFxActionV28>[0] {
	return {
		profile: Object.freeze({}), owner,
		bridge: Object.freeze({
			capabilities: async () => createNativeMediaCapabilitySnapshotV1({
				masterEnabled: false, entries: [],
			}),
			listOpenFxPlugins: async () => [],
		}),
		mintId: () => 'ofx-deferred-test',
	};
}

function openFxModule(
	create: () => FramescaperNativeOpenFxActionRuntimeCompositionV28,
): DeferredFramescaperNativeOpenFxActionModuleV28 {
	return Object.freeze({
		createFramescaperNativeOpenFxActionRuntimeV28: create,
	}) as unknown as DeferredFramescaperNativeOpenFxActionModuleV28;
}

function openFxComposition(
	calls: string[],
	overrides: Readonly<{
		readonly action?: () => Promise<void>;
		readonly author?: () => Promise<void>;
	}> = {},
): FramescaperNativeOpenFxActionRuntimeCompositionV28 {
	const actionRuntime = ofxActionRuntime(async () => {
		calls.push('action');
		await overrides.action?.();
	});
	const authoringRuntime: FramescaperNativeOpenFxAuthoringRuntimeV28 = Object.freeze({
		model: async () => { calls.push('model'); return {} as never; },
		author: async () => { calls.push('author'); await overrides.author?.(); },
		interactModel: async () => { calls.push('interactModel'); return {} as never; },
		commitInteract: async () => { calls.push('commitInteract'); return {} as never; },
	});
	return Object.freeze({ actionRuntime, authoringRuntime });
}

function ofxActionRuntime(
	action: (request: unknown) => Promise<void>,
): FramescaperNativeProjectActionRuntime {
	return createFramescaperNativeProjectActionSubsetRuntime(['ofx-add'], {
		'ofx-add': action,
	});
}

function deferred<Value>(): Readonly<{
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value | PromiseLike<Value>) => void;
}> {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return Object.freeze({ promise, resolve });
}

function source(path: string): string {
	return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}
