/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNativeServicesMenuItems,
	FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES,
	FRAMESCAPER_ALWAYS_REACHABLE_SURFACES,
	FRAMESCAPER_NATIVE_SERVICE_SURFACES,
	type FramescaperNativeServiceSurface,
	type FramescaperNativeServicesMenuItem,
} from '../src/common/editor/ui/framescaper-native-services-menu.ts';
import {
	createNativeMediaCapabilitySnapshotV1,
	NATIVE_MEDIA_CAPABILITY_IDS,
	type NativeMediaCapabilityDomain,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	NATIVE_MEDIA_PROXY_PROFILE_ID,
} from '../src/common/editor/native-media-proxy-recipe.ts';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';

test('Soundscaper receives no native video or OFX surface at all', () => {
	const items = createFramescaperNativeServicesMenuItems(
		{
			productId: 'soundscaper', runtimeAvailable: true, snapshot: enabledSnapshot(),
			project: {}, editingBlocked: false,
		},
		noopActions(),
	);

	assert.deepEqual(items, {
		fileImport: [], fileExport: [], view: [], tools: [], effect: [],
	});
});

test('a build with no native-services controller shows no entries at all', () => {
	// A menu item that opens nothing is worse than an absent one: the user
	// cannot tell "not built" from "broken".
	assert.deepEqual(menu({ runtimeAvailable: false }), {
		fileImport: [], fileExport: [], view: [], tools: [], effect: [],
	});
});

test('every named surface is reachable from an existing menu family', () => {
	const items = menu();
	const surfaces = new Set<string>();
	for (const item of allItems(items)) {
		const surface = surfaceFor(item.id);
		if (surface) surfaces.add(surface);
	}

	assert.deepEqual(
		[...surfaces].sort(),
		[...FRAMESCAPER_NATIVE_SERVICE_SURFACES].sort(),
	);
});

test('the surfaces sit in the menu families the plan names', () => {
	const items = menu();

	assert.deepEqual(items.fileImport.map((item) => item.id), ['framescaper-import-image-sequence']);
	assert.deepEqual(items.fileExport.map((item) => item.id), ['framescaper-add-to-render-queue']);
	assert.deepEqual(items.view.map((item) => item.id), ['framescaper-external-display']);
	assert.deepEqual(items.tools.map((item) => item.id), [
		'framescaper-background-jobs',
		'framescaper-watch-folders',
		'framescaper-proxies',
		'framescaper-native-media-preferences',
	]);
	assert.deepEqual(items.effect.map((item) => item.id), ['framescaper-video-effects']);
	assert.deepEqual(items.effect[0]?.items?.map((item) => item.id), [
		'framescaper-ofx-add', 'framescaper-ofx-manage',
	]);
});

test('Framescaper retains only its video-effect menu when audio effects are unavailable', () => {
	const nativeBranch = menu().effect[0];
	const filtered = filterProductMenus([{
		id: 'effect', label: 'Effect', items: [
			{ id: 'audio-effect', label: 'Audio effect' },
			nativeBranch,
		],
	}], {
		audioGenerators: false,
		audioEffects: false,
		audioAnalysis: false,
		audioMacros: false,
		audioRecording: false,
	}, 'framescaper');

	assert.deepEqual(filtered.map(({ id }: { id: string }) => id), ['effect']);
	assert.deepEqual(filtered[0]?.items?.map(({ id }: { id: string }) => id), ['framescaper-video-effects']);
});

test('an enabled tier exposes only surfaces with real selected-runtime actions', () => {
	const opened: string[] = [];
	const items = createFramescaperNativeServicesMenuItems(
		{
			productId: 'framescaper', runtimeAvailable: true, snapshot: enabledSnapshot(),
			project: { schemaVersion: 20 }, editingBlocked: false,
			projectCapabilities: selectedCapabilities(),
			lifecycleMethods: watchLifecycleMethods(),
		},
		{ open: (surface) => opened.push(surface), openExternalDisplay: () => undefined },
	);

	for (const item of allItems(items)) {
		if (!surfaceFor(item.id) || item.items) continue;
		item.onClick?.();
	}
	assert.deepEqual([...opened].sort(), [
		'background-jobs', 'native-media-preferences', 'ofx-manage', 'watch-folders',
	]);
	for (const id of [
		'framescaper-import-image-sequence', 'framescaper-add-to-render-queue',
		'framescaper-proxy-generate', 'framescaper-proxy-attach',
		'framescaper-proxy-detach', 'framescaper-proxy-relink', 'framescaper-ofx-add',
	]) assert.equal(item(items, id)?.disabled, true, id);
});

test('an exact candidate action port enables only its declared project mutations', () => {
	const opened: string[] = [];
	const items = createFramescaperNativeServicesMenuItems(
		{
			productId: 'framescaper', runtimeAvailable: true, snapshot: enabledSnapshot(),
			project: { schemaVersion: 26 }, editingBlocked: false,
			projectCapabilities: { ...selectedCapabilities(), ofxEffects: true },
			lifecycleMethods: watchLifecycleMethods(),
			projectActionSurfaces: FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES,
		},
		{ open: (surface) => opened.push(surface), openExternalDisplay: () => undefined },
	);

	for (const id of [
		'framescaper-import-image-sequence', 'framescaper-add-to-render-queue',
		'framescaper-proxy-generate', 'framescaper-proxy-attach',
		'framescaper-proxy-detach', 'framescaper-proxy-relink', 'framescaper-ofx-add',
	]) {
		const entry = item(items, id);
		assert.equal(entry?.disabled, false, id);
		entry?.onClick?.();
	}
	assert.deepEqual(opened, FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES);
});

test('a candidate action declaration cannot bypass the owning schema and capability gates', () => {
	const items = menu({
		projectActionSurfaces: FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES,
		projectCapabilities: { ...selectedCapabilities(), sourceCharacteristics: false, ofxEffects: false },
	});

	for (const id of [
		'framescaper-import-image-sequence', 'framescaper-proxy-generate',
		'framescaper-proxy-attach', 'framescaper-proxy-detach',
		'framescaper-proxy-relink', 'framescaper-ofx-add',
	]) assert.equal(item(items, id)?.disabled, true, id);
	assert.equal(item(items, 'framescaper-add-to-render-queue')?.disabled, false);
});

test('V25 and V26 authoring surfaces do not borrow broad V20 capability gates', () => {
	const items = menu({
		project: { schemaVersion: 20 },
		projectCapabilities: {
			...selectedCapabilities(),
			sourceCharacteristics: true,
			ofxEffects: true,
		},
	});

	assert.equal(item(items, 'framescaper-import-image-sequence')?.disabled, true);
	assert.equal(item(items, 'framescaper-proxy-generate')?.disabled, true);
	assert.equal(item(items, 'framescaper-ofx-add')?.disabled, true);
});

test('with the tier switched off the user can still reach the pane that turns it on', () => {
	const items = menu({ snapshot: null });
	const enabled = allItems(items)
		.filter((item) => !item.items && item.disabled === false)
		.map((item) => surfaceFor(item.id))
		.filter((surface): surface is FramescaperNativeServiceSurface => surface !== null);

	assert.deepEqual(
		enabled.filter((surface) => FRAMESCAPER_ALWAYS_REACHABLE_SURFACES.includes(surface)).sort(),
		[...FRAMESCAPER_ALWAYS_REACHABLE_SURFACES].sort(),
	);
	assert.equal(enabled.includes('background-jobs'), false);
	assert.equal(enabled.includes('render-queue-enqueue'), false);
	assert.equal(enabled.includes('ofx-add'), false);
});

test('a disabled command never invokes its action', () => {
	let opened = 0;
	const items = createFramescaperNativeServicesMenuItems(
		{
			productId: 'framescaper', runtimeAvailable: true, snapshot: null,
			project: null, editingBlocked: true,
		},
		{ open: () => { opened += 1; }, openExternalDisplay: () => undefined },
	);

	for (const item of allItems(items)) {
		if (item.disabled) item.onClick?.();
	}
	assert.equal(opened, 0);
});

test('a read-only or blocked project disables authoring but not inspection', () => {
	for (const overrides of [{ readOnly: true }, { editingBlocked: true }]) {
		const items = menu(overrides);
		assert.equal(item(items, 'framescaper-import-image-sequence')?.disabled, true);
		assert.equal(item(items, 'framescaper-proxy-generate')?.disabled, true);
		assert.equal(item(items, 'framescaper-background-jobs')?.disabled, false);
		assert.equal(item(items, 'framescaper-native-media-preferences')?.disabled, false);
	}
});

test('a capability the user has not opted into leaves its command disabled', () => {
	const items = menu({
		snapshot: createNativeMediaCapabilitySnapshotV1({
			masterEnabled: true,
			entries: [
				ref('renderQueue', true),
				ref('watchFolders', false),
				ref('proxyCodec', false),
				ref('ofxHost', false),
			],
		}),
	});

	assert.equal(item(items, 'framescaper-background-jobs')?.disabled, false);
	assert.equal(item(items, 'framescaper-watch-folders')?.disabled, true);
	assert.equal(item(items, 'framescaper-proxy-generate')?.disabled, true);
	assert.equal(item(items, 'framescaper-ofx-add')?.disabled, true);
	assert.equal(item(items, 'framescaper-proxy-detach')?.disabled, true);
});

test('candidate-only project capabilities keep authoring commands fail-closed', () => {
	const items = menu({
		projectCapabilities: {
			videoExport: true,
			videoImport: true,
			sourceCharacteristics: false,
			ofxEffects: false,
		},
	});

	assert.equal(item(items, 'framescaper-add-to-render-queue')?.disabled, true);
	assert.equal(item(items, 'framescaper-watch-folders')?.disabled, false);
	assert.equal(item(items, 'framescaper-import-image-sequence')?.disabled, true);
	assert.equal(item(items, 'framescaper-proxy-generate')?.disabled, true);
	assert.equal(item(items, 'framescaper-ofx-add')?.disabled, true);
	assert.equal(item(items, 'framescaper-native-media-preferences')?.disabled, false);
	assert.equal(item(items, 'framescaper-ofx-manage')?.disabled, false);
});

test('a valid proxy codec row cannot enable an unwired project mutation', () => {
	// A producer keyed to the encode profile reports this row and no other; a
	// menu spelling it differently would stay disabled with the tier ready.
	const items = menu({
		project: { schemaVersion: 25 },
		snapshot: createNativeMediaCapabilitySnapshotV1({
			masterEnabled: true,
			entries: [entry('codec', NATIVE_MEDIA_PROXY_PROFILE_ID, true)],
		}),
	});

	assert.equal(item(items, 'framescaper-proxy-generate')?.disabled, true);
	assert.equal(item(items, 'framescaper-proxy-attach')?.disabled, true);
});

test('the external display submenu lists non-primary displays and a None entry', () => {
	const chosen: (string | null)[] = [];
	const items = createFramescaperNativeServicesMenuItems({
		productId: 'framescaper',
		runtimeAvailable: true,
		snapshot: enabledSnapshot(),
		project: { schemaVersion: 20 },
		projectCapabilities: selectedCapabilities(),
		lifecycleMethods: watchLifecycleMethods(),
		editingBlocked: false,
		externalDisplays: [display('display-2', 'Programme'), display('display-3', 'Client')],
		activeExternalDisplayId: 'display-2',
	}, { open: () => undefined, openExternalDisplay: (id) => chosen.push(id) });

	const submenu = items.view[0]!;
	assert.equal(submenu.disabled, false);
	assert.deepEqual(submenu.items?.map((entry_) => entry_.id), [
		'framescaper-external-display-none',
		'framescaper-external-display-display-2',
		'framescaper-external-display-display-3',
	]);
	assert.equal(submenu.items?.[1]?.checked, true);
	assert.equal(submenu.items?.[2]?.checked, false);
	submenu.items?.[2]?.onClick?.();
	submenu.items?.[0]?.onClick?.();
	assert.deepEqual(chosen, ['display-3', null]);
});

test('external display selection requires a current project with video playback authority', () => {
	for (const overrides of [
		{ project: null },
		{ projectCapabilities: { ...selectedCapabilities(), videoPlayback: false } },
	]) {
		const submenu = menu({
			externalDisplays: [display('display-2', 'Programme')],
			...overrides,
		}).view[0]!;
		assert.equal(submenu.disabled, true);
	}
});

test('with no second display the submenu explains itself instead of vanishing', () => {
	const submenu = menu().view[0]!;

	assert.equal(submenu.disabled, true);
	assert.equal(submenu.items?.length, 1);
	assert.equal(submenu.items?.[0]?.disabled, true);
});

test('the clean-display menu never offers the primary display as an output', () => {
	const submenu = menu({
		externalDisplays: [
			{ ...display('display-1', 'Primary'), primary: true },
			display('display-2', 'Programme'),
		],
	}).view[0]!;

	assert.deepEqual(submenu.items?.map(({ id }) => id), [
		'framescaper-external-display-none',
		'framescaper-external-display-display-2',
	]);
});

function surfaceFor(id: string): FramescaperNativeServiceSurface | null {
	const map: Readonly<Record<string, FramescaperNativeServiceSurface>> = {
		'framescaper-import-image-sequence': 'image-sequence-import',
		'framescaper-add-to-render-queue': 'render-queue-enqueue',
		'framescaper-background-jobs': 'background-jobs',
		'framescaper-watch-folders': 'watch-folders',
		'framescaper-proxy-generate': 'proxy-generate',
		'framescaper-proxy-attach': 'proxy-attach',
		'framescaper-proxy-detach': 'proxy-detach',
		'framescaper-proxy-relink': 'proxy-relink',
		'framescaper-native-media-preferences': 'native-media-preferences',
		'framescaper-ofx-add': 'ofx-add',
		'framescaper-ofx-manage': 'ofx-manage',
	};
	return map[id] ?? null;
}

function watchLifecycleMethods() {
	return ['createWatch', 'setWatchEnabled', 'removeWatch', 'reconcileWatch'] as const;
}

function allItems(
	items: ReturnType<typeof createFramescaperNativeServicesMenuItems>,
): readonly FramescaperNativeServicesMenuItem[] {
	const flat: FramescaperNativeServicesMenuItem[] = [];
	const walk = (entries: readonly FramescaperNativeServicesMenuItem[]): void => {
		for (const entry_ of entries) {
			flat.push(entry_);
			if (entry_.items) walk(entry_.items);
		}
	};
	for (const family of [items.fileImport, items.fileExport, items.view, items.tools, items.effect]) {
		walk(family);
	}
	return flat;
}

function item(
	items: ReturnType<typeof createFramescaperNativeServicesMenuItems>,
	id: string,
): FramescaperNativeServicesMenuItem | undefined {
	return allItems(items).find((entry_) => entry_.id === id);
}

function ref(
	key: keyof typeof NATIVE_MEDIA_CAPABILITY_IDS,
	userEnabled: boolean,
) {
	const pinned = NATIVE_MEDIA_CAPABILITY_IDS[key];
	return entry(pinned.domain, pinned.id, userEnabled);
}

function entry(domain: NativeMediaCapabilityDomain, id: string, userEnabled: boolean) {
	return {
		domain,
		id,
		policyCleared: true,
		buildSupported: true,
		probeSucceeded: true,
		selfTestPassed: true,
		userEnabled,
	};
}

function enabledSnapshot() {
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		entries: [
			ref('renderQueue', true),
			ref('watchFolders', true),
			ref('proxyCodec', true),
			ref('imageSequenceImport', true),
			ref('externalDisplay', true),
			ref('ofxHost', true),
		],
	});
}

function display(displayId: string, label: string) {
	return {
		displayId, label, primary: false,
		width: 1_920, height: 1_080, hdrCapable: false, colorManaged: false,
	};
}

function noopActions() {
	return { open: () => undefined, openExternalDisplay: () => undefined };
}

function menu(overrides: Record<string, unknown> = {}) {
	return createFramescaperNativeServicesMenuItems({
		productId: 'framescaper',
		runtimeAvailable: true,
		snapshot: enabledSnapshot(),
		project: { schemaVersion: 20 },
		projectCapabilities: selectedCapabilities(),
		lifecycleMethods: watchLifecycleMethods(),
		editingBlocked: false,
		...overrides,
	} as Parameters<typeof createFramescaperNativeServicesMenuItems>[0], noopActions());
}

function selectedCapabilities(): Readonly<Record<string, boolean>> {
	return Object.freeze({
		sourceCharacteristics: true,
		videoExport: true,
		videoImport: true,
		videoPlayback: true,
		ofxEffects: false,
	});
}
