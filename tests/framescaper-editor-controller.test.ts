/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after, type TestContext } from 'node:test';

import {
	framescaperCandidateAuthoringActionRuntimeFor,
} from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import {
	framescaperNativeProjectActionRuntimeFor,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	framescaperVideoProxyActionRuntimeFor,
} from '../src/common/editor/framescaper-video-proxy-action-runtime-registry.ts';
import {
	createFramescaperAudioEditorController,
} from '../src/framescaper/editor-controller.ts';
import {
	createFramescaperEditorProjectEnvironment,
	type FramescaperEditorProjectEnvironment,
} from '../src/framescaper/editor-project-environment.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Data = Record<string, unknown>;
type Sequences = Record<string, (...args: never[]) => unknown>;

/** The controller factory demands the WeakSet-registered environment, so one real store is shared. */
let opened: Promise<Readonly<FramescaperEditorProjectEnvironment>> | null = null;

function environment(): Promise<Readonly<FramescaperEditorProjectEnvironment>> {
	const value = opened ?? createFramescaperEditorProjectEnvironment({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
			storageManager: {
				estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
				persisted: async () => true,
				persist: async () => true,
			} as unknown as StorageManager,
		},
	} as never);
	opened = value;
	return value;
}

after(async () => {
	if (opened) await (await opened).close();
});

async function controllerWith(presentation?: unknown): Promise<Data> {
	const value = await environment();
	return (presentation === undefined
		? createFramescaperAudioEditorController(value)
		: createFramescaperAudioEditorController(value, presentation)) as unknown as Data;
}

function sequences(controller: Data): Sequences {
	return (controller.actions as Record<string, Sequences>).sequences;
}

/** Publish the preload's V1 surface for one test, the way the packaged renderer sees it. */
function installBridge(context: TestContext, nativeServices: Data): void {
	Reflect.set(globalThis, 'framescaperDesktop', { v1: { nativeServices } });
	context.after(() => { Reflect.deleteProperty(globalThis, 'framescaperDesktop'); });
}

function desktopBridge(): Data {
	return {
		snapshot: async () => null,
		control: async () => null,
		reorder: async () => null,
		remove: async () => null,
		capabilities: async () => null,
		listOpenFxPlugins: async () => [],
		selectImageSequence: async () => null,
		readImageSequenceFile: async () => null,
		releaseImageSequence: async () => null,
		imageSequenceImport: async () => null,
		writeImageSequenceImportChunk: async () => null,
		readImageSequenceImportBody: async () => null,
	};
}

test('an environment that was not minted by the product factory is refused', async () => {
	const real = await environment();

	for (const candidate of [null, undefined, {}, [], 'environment', 42]) {
		assert.throws(
			() => createFramescaperAudioEditorController(candidate),
			/product-created Framescaper environment/u,
		);
	}
	// A structural copy carries every field yet none of the registered identity.
	assert.throws(
		() => createFramescaperAudioEditorController({ ...real }),
		TypeError,
	);
});

test('a presentation that is not a plain record is refused', async () => {
	const real = await environment();

	for (const candidate of [null, 'en', 7, [], new Map(), Object.create({})]) {
		assert.throws(
			() => createFramescaperAudioEditorController(real, candidate),
			/presentation must be a plain record/u,
		);
	}
});

test('a null-prototype presentation record is accepted and its fields still apply', async () => {
	const real = await environment();
	const presentation = Object.assign(Object.create(null) as Data, { locale: 'fr' });

	const controller = createFramescaperAudioEditorController(real, presentation) as unknown as Data;

	assert.equal((controller.getSnapshot as () => Data)().locale, 'fr');
});

test('a presentation field outside the three published names is refused', async () => {
	const real = await environment();

	assert.throws(
		() => createFramescaperAudioEditorController(real, { locale: 'en', store: {} }),
		/unsupported authority/u,
	);
	assert.throws(
		() => createFramescaperAudioEditorController(real, { [Symbol('copy')]: {} }),
		/unsupported authority/u,
	);
});

test('a presentation field reached through an accessor or a hidden slot is refused', async () => {
	const real = await environment();
	const accessor = Object.defineProperty({}, 'locale', { enumerable: true, get: () => 'en' });
	const hidden = Object.defineProperty({}, 'copy', { enumerable: false, value: {} });

	assert.throws(
		() => createFramescaperAudioEditorController(real, accessor),
		/locale must be an own data property/u,
	);
	assert.throws(
		() => createFramescaperAudioEditorController(real, hidden),
		/copy must be an own data property/u,
	);
});

test('a non-string locale and a non-object copy are refused after the field survey', async () => {
	const real = await environment();

	assert.throws(
		() => createFramescaperAudioEditorController(real, { locale: 42 }),
		/locale must be a string/u,
	);
	for (const copy of [null, [], 'copy']) {
		assert.throws(
			() => createFramescaperAudioEditorController(real, { copy }),
			/copy must be an object/u,
		);
	}
	// An explicitly absent value is not a supplied value and must pass through.
	assert.doesNotThrow(
		() => createFramescaperAudioEditorController(real, { locale: undefined, copy: undefined }),
	);
});

test('the supplied locale and copy reach the controller snapshot', async () => {
	const controller = await controllerWith({ locale: 'de', copy: { ready: 'Bereit' } });

	const snapshot = (controller.getSnapshot as () => Data)();

	assert.equal(snapshot.locale, 'de');
	assert.deepEqual(snapshot.status, { message: 'Bereit', state: 'info' });
	assert.equal(snapshot.productId, 'framescaper');
});

test('the controller is composed headless with no project until one is opened', async () => {
	const controller = await controllerWith();

	assert.equal(controller.headless, true);
	assert.equal(controller.project, null);
	assert.equal((controller.getSnapshot as () => Data)().productId, 'framescaper');
});

test('native render input preparation is installed as a sealed non-enumerable member', async () => {
	const controller = await controllerWith();

	const descriptor = Object.getOwnPropertyDescriptor(controller, 'prepareNativeRenderInputStream');

	assert.ok(descriptor);
	assert.equal(typeof descriptor.value, 'function');
	assert.deepEqual(
		{ writable: descriptor.writable, enumerable: descriptor.enumerable, configurable: descriptor.configurable },
		{ writable: false, enumerable: false, configurable: false },
	);
	assert.throws(() => {
		(controller as Data).prepareNativeRenderInputStream = () => undefined;
	}, TypeError);
});

test('the product sequence actions are published under their exact authoring spellings', async () => {
	const controller = await controllerWith();

	const published = sequences(controller);

	for (const name of [
		'createSequence', 'deleteSequence', 'addNested', 'updateNested', 'removeNested',
		'createMulticamera', 'updateMulticamera', 'removeMulticamera', 'switchMulticamera',
		'retimeSet', 'retimeReset', 'retimeConstant', 'retimeReverse', 'retimeFreeze', 'retimeRamp',
	]) {
		assert.equal(typeof published[name], 'function', `${name} must be bound`);
	}
	assert.deepEqual(
		Object.keys(published).filter((name) => name.startsWith('retime')),
		['retimeSet', 'retimeReset', 'retimeConstant', 'retimeReverse', 'retimeFreeze', 'retimeRamp'],
	);
	assert.ok(Object.isFrozen(published), 'the published slice must not admit a later escape hatch');
});

test('an invalid product request is refused before any command reaches the edit history', async () => {
	const controller = await controllerWith();
	const bound = sequences(controller);

	assert.throws(() => bound.retimeReset(null as never), /must be a plain record/u);
	assert.throws(
		() => bound.retimeReset({ clipId: 'video-clip' } as never),
		/unsupported or missing field/u,
	);
	assert.throws(() => bound.deleteSequence('' as never), /sequence ID must be a non-empty string/u);
	assert.throws(
		() => bound.createMulticamera('project' as never, -1 as never, {} as never),
		RangeError,
	);
});

test('a well-formed product command is routed into the controller edit history', async () => {
	const controller = await controllerWith();
	const bound = sequences(controller);

	// The history refusal proves the command passed validation and reached edit.commit.
	assert.throws(
		() => bound.retimeReset({ clipId: 'video-clip', expectedRetimeMap: null } as never),
		/active project history is required/u,
	);
	assert.throws(
		() => bound.deleteSequence('secondary-sequence' as never),
		/active project history is required/u,
	);
	assert.throws(
		() => bound.removeMulticamera('p' as never, 0 as never, 'g' as never, 'm' as never),
		/active project history is required/u,
	);
});

test('without a desktop bridge only the render-queue native surface is bound', async () => {
	const controller = await controllerWith();

	const runtime = framescaperNativeProjectActionRuntimeFor(controller);

	assert.ok(runtime);
	assert.deepEqual(runtime.surfaces, ['render-queue-enqueue']);
});

test('an authenticated desktop bridge adds the image-sequence and OpenFX surfaces', async (context) => {
	installBridge(context, desktopBridge());

	const runtime = framescaperNativeProjectActionRuntimeFor(await controllerWith());

	assert.deepEqual(
		runtime?.surfaces,
		['render-queue-enqueue', 'image-sequence-import', 'ofx-add'],
	);
});

test('an incomplete desktop bridge is treated as absent rather than half-trusted', async (context) => {
	const bridge = desktopBridge();
	Reflect.deleteProperty(bridge, 'remove');
	installBridge(context, bridge);

	const runtime = framescaperNativeProjectActionRuntimeFor(await controllerWith());

	assert.deepEqual(runtime?.surfaces, ['render-queue-enqueue']);
});

test('the video-still surface refuses when no file picker is reachable', async () => {
	const controller = await controllerWith();

	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller);

	assert.ok(authoring);
	assert.ok(authoring.surfaces.includes('video-still'));
	await assert.rejects(
		() => authoring.run('video-still'),
		/requires a browser or desktop file picker/u,
	);
});

test('a presentation file service drives the video-still picker on desktop', async () => {
	const requests: unknown[] = [];
	const controller = await controllerWith({
		fileService: {
			isDesktop: true,
			chooseFiles: async (request: unknown) => { requests.push(request); return []; },
			withReadDescriptors: async () => [],
		},
	});

	await framescaperCandidateAuthoringActionRuntimeFor(controller)!.run('video-still');

	assert.deepEqual(requests, [{ purpose: 'media', multiple: true }]);
});

test('a desktop file service without bounded read capabilities is refused', async () => {
	const controller = await controllerWith({ fileService: { isDesktop: true } });

	await assert.rejects(
		() => framescaperCandidateAuthoringActionRuntimeFor(controller)!.run('video-still'),
		/bounded media read capabilities/u,
	);
});

test('each controller owns its own video-proxy runtime with untouched defaults', async () => {
	const first = await controllerWith();
	const second = await controllerWith();

	const runtime = framescaperVideoProxyActionRuntimeFor(first);

	assert.ok(runtime);
	assert.notEqual(runtime, framescaperVideoProxyActionRuntimeFor(second));
	assert.equal(runtime.mode('video-source'), 'auto');
	assert.equal(runtime.pressure('video-source'), null);
	assert.throws(
		() => runtime.previewTrust('video-source'),
		/requires a writable Framescaper 1\.0 project/u,
	);
});
