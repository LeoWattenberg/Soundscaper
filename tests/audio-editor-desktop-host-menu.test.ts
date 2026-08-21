/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopHostMenuItems,
	createDesktopNativeTierControlsStore,
	DESKTOP_NATIVE_TIER_REFRESH_INTERVAL_MS,
	type DesktopNativeTierControls,
} from '../src/common/editor/ui/desktop-host-menu.ts';

function snapshot(overrides: Partial<DesktopNativeTierControls> = {}): DesktopNativeTierControls {
	return Object.freeze({
		probeHelperEnabled: false,
		probeHelperQuarantined: false,
		audioHelperEnabled: false,
		audioHelperQuarantined: false,
		nativeEffectDiscoveryEnabled: false,
		...overrides,
	});
}

function copy() {
	return {
		desktopServices: 'Desktop services',
		useNativeProbeHelper: 'Use Native Probe Helper',
		clearProbeHelperQuarantine: 'Clear Probe Helper Quarantine',
		useNativeAudioHelper: 'Use Native Audio Helper',
		clearAudioHelperQuarantine: 'Clear Audio Helper Quarantine',
		discoverNativeEffects: 'Discover Native Effects',
		productHelp: '{product} Help',
		checkUpdates: 'Check for updates',
		viewSource: 'View source',
		reloadApplication: 'Reload',
		toggleDeveloperTools: 'Toggle Developer Tools',
	};
}

test('desktop host menus migrate every native-only row for either desktop product', () => {
	const controls: Array<readonly [string, boolean | undefined]> = [];
	const windows: string[] = [];
	const external: string[] = [];
	let updates = 0;
	const menus = createDesktopHostMenuItems({
		copy: copy(),
		development: true,
		productName: 'Framescaper',
		snapshot: snapshot({ probeHelperEnabled: true, nativeEffectDiscoveryEnabled: true }),
		applyNativeTierControl: (action, enabled) => { controls.push([action, enabled]); },
		runWindowAction: (action) => { windows.push(action); },
		checkForUpdates: () => { updates += 1; },
		openExternal: (destination) => { external.push(destination); },
	});

	assert.deepEqual(menus.tools.map(({ id }) => id), ['desktop-services']);
	assert.deepEqual(menus.tools[0]?.items?.map(({ id, checked }) => [id, checked]), [
		['desktop-use-native-probe-helper', true],
		['desktop-clear-probe-helper-quarantine', undefined],
		['desktop-use-native-audio-helper', false],
		['desktop-clear-audio-helper-quarantine', undefined],
		['desktop-discover-native-effects', true],
	]);
	assert.deepEqual(menus.view.map(({ id }) => id), ['desktop-reload', 'desktop-toggle-dev-tools']);
	assert.deepEqual(menus.help.map(({ id }) => id), [
		'desktop-product-help', 'desktop-check-updates', 'desktop-view-source',
	]);
	assert.equal(menus.help[0]?.label, 'Framescaper Help');

	menus.tools[0]?.items?.[0]?.onClick?.();
	menus.tools[0]?.items?.[1]?.onClick?.();
	menus.tools[0]?.items?.[2]?.onClick?.();
	menus.tools[0]?.items?.[3]?.onClick?.();
	menus.tools[0]?.items?.[4]?.onClick?.();
	menus.view[0]?.onClick?.();
	menus.view[1]?.onClick?.();
	menus.help[0]?.onClick?.();
	menus.help[1]?.onClick?.();
	menus.help[2]?.onClick?.();

	assert.deepEqual(controls, [
		['set-probe-helper-enabled', false],
		['clear-probe-helper-quarantine', undefined],
		['set-audio-helper-enabled', true],
		['clear-audio-helper-quarantine', undefined],
		['set-native-effect-discovery-enabled', false],
	]);
	assert.deepEqual(windows, ['reload', 'toggle-dev-tools']);
	assert.deepEqual(external, ['help', 'source']);
	assert.equal(updates, 1);
});

test('web has no desktop host rows and packaged desktop hides development commands', () => {
	assert.deepEqual(createDesktopHostMenuItems(null), { view: [], tools: [], help: [] });
	const menus = createDesktopHostMenuItems({
		copy: copy(),
		development: false,
		productName: 'Soundscaper',
		snapshot: snapshot(),
		applyNativeTierControl: () => undefined,
		runWindowAction: () => undefined,
		checkForUpdates: () => undefined,
		openExternal: () => undefined,
	});
	assert.deepEqual(menus.view, []);
	assert.equal(menus.tools.length, 1);
	assert.equal(menus.help.length, 3);
});

test('development menu shortcut labels follow the desktop platform', () => {
	const menus = createDesktopHostMenuItems({
		copy: copy(), development: true, platform: 'darwin', productName: 'Soundscaper', snapshot: snapshot(),
		applyNativeTierControl: () => undefined, runWindowAction: () => undefined,
		checkForUpdates: () => undefined, openExternal: () => undefined,
	});
	assert.deepEqual(menus.view.map(({ shortcut }) => shortcut), ['Cmd+R', 'Option+Cmd+I']);
});

test('desktop native-tier control stores preserve identity and reject stale replies', async () => {
	let current = snapshot();
	const pending: Array<(value: DesktopNativeTierControls) => void> = [];
	const bridge = {
		readNativeTierControls: () => new Promise<DesktopNativeTierControls>((resolve) => { pending.push(resolve); }),
		applyNativeTierControl: () => Promise.resolve(current),
	};
	const store = createDesktopNativeTierControlsStore(bridge, () => 100);
	let publications = 0;
	store.subscribe(() => { publications += 1; });
	const older = store.refresh();
	const newer = store.refresh();
	current = snapshot({ audioHelperEnabled: true });
	pending[1]?.(current);
	await newer;
	pending[0]?.(snapshot());
	await older;

	assert.equal(store.getSnapshot()?.audioHelperEnabled, true);
	assert.equal(publications, 1);
	await store.apply('set-audio-helper-enabled', true);
	assert.equal(store.getSnapshot(), current, 'an unchanged authoritative answer keeps snapshot identity');
	assert.equal(publications, 1);
	assert.equal(DESKTOP_NATIVE_TIER_REFRESH_INTERVAL_MS, 5_000);
});

test('native-tier apply publishes its authoritative response immediately', async () => {
	const applied: Array<readonly [string, boolean | undefined]> = [];
	const enabled = snapshot({ probeHelperEnabled: true });
	const store = createDesktopNativeTierControlsStore({
		readNativeTierControls: () => Promise.resolve(snapshot()),
		applyNativeTierControl: ({ action, enabled: nextEnabled }) => {
			applied.push([action, nextEnabled]);
			return Promise.resolve(enabled);
		},
	});
	await store.apply('set-probe-helper-enabled', true);
	assert.deepEqual(applied, [['set-probe-helper-enabled', true]]);
	assert.equal(store.getSnapshot()?.probeHelperEnabled, true);
});

test('a refresh requested after an apply waits and cannot overwrite the mutation', async () => {
	let current = snapshot();
	let releaseApply: (() => void) | undefined;
	const order: string[] = [];
	const store = createDesktopNativeTierControlsStore({
		readNativeTierControls: () => {
			order.push('read');
			return Promise.resolve(current);
		},
		applyNativeTierControl: async () => {
			order.push('apply:start');
			await new Promise<void>((resolve) => { releaseApply = resolve; });
			current = snapshot({ probeHelperEnabled: true });
			order.push('apply:end');
			return current;
		},
	});

	const applying = store.apply('set-probe-helper-enabled', true);
	const refreshing = store.refresh();
	await Promise.resolve();
	assert.deepEqual(order, ['apply:start']);
	releaseApply?.();
	await Promise.all([applying, refreshing]);

	assert.deepEqual(order, ['apply:start', 'apply:end', 'read']);
	assert.equal(store.getSnapshot()?.probeHelperEnabled, true);
});

test('rapid native-tier applies reach the bridge and publish in invocation order', async () => {
	let releaseFirst: (() => void) | undefined;
	const calls: boolean[] = [];
	const store = createDesktopNativeTierControlsStore({
		readNativeTierControls: () => Promise.resolve(snapshot()),
		applyNativeTierControl: async ({ enabled }) => {
			calls.push(enabled === true);
			if (calls.length === 1) {
				await new Promise<void>((resolve) => { releaseFirst = resolve; });
			}
			return snapshot({ audioHelperEnabled: enabled === true });
		},
	});

	const enabling = store.apply('set-audio-helper-enabled', true);
	const disabling = store.apply('set-audio-helper-enabled', false);
	await Promise.resolve();
	assert.deepEqual(calls, [true], 'the second mutation must wait for the first');
	releaseFirst?.();
	await Promise.all([enabling, disabling]);

	assert.deepEqual(calls, [true, false]);
	assert.equal(store.getSnapshot()?.audioHelperEnabled, false);
});

test('stale polling reports errors and remains retryable without an unhandled rejection', async () => {
	const errors: unknown[] = [];
	let attempts = 0;
	const store = createDesktopNativeTierControlsStore({
		readNativeTierControls: () => {
			attempts += 1;
			return attempts === 1
				? Promise.reject(new Error('native tier unavailable'))
				: Promise.resolve(snapshot({ nativeEffectDiscoveryEnabled: true }));
		},
		applyNativeTierControl: () => Promise.resolve(snapshot()),
	});

	store.refreshIfStale(undefined, (error) => { errors.push(error); });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal((errors[0] as Error)?.message, 'native tier unavailable');
	store.refreshIfStale(undefined, (error) => { errors.push(error); });
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(attempts, 2);
	assert.equal(errors.length, 1);
	assert.equal(store.getSnapshot()?.nativeEffectDiscoveryEnabled, true);
});
