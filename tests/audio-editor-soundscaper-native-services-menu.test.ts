/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SOUNDSCAPER_ALWAYS_REACHABLE_SURFACES,
	SOUNDSCAPER_NATIVE_SERVICE_SURFACES,
	type SoundscaperNativeServicesMenuItem,
	type SoundscaperNativeServicesSnapshot,
	createSoundscaperNativeServicesMenuItems,
} from '../src/common/editor/ui/soundscaper-native-services-menu.ts';

const HEALTHY: SoundscaperNativeServicesSnapshot = Object.freeze({
	enabled: true,
	quarantined: false,
	payloadAvailable: true,
	payloadDetail: '',
	usableAudioBackends: Object.freeze(['alsa']),
	enabledPluginFormats: Object.freeze(['fixture']),
});

function build(
	overrides: Partial<Parameters<typeof createSoundscaperNativeServicesMenuItems>[0]> = {},
	snapshot: SoundscaperNativeServicesSnapshot | null = HEALTHY,
) {
	const opened: string[] = [];
	const items = createSoundscaperNativeServicesMenuItems(
		{ productId: 'soundscaper', runtimeAvailable: true, snapshot, ...overrides },
		{ open: (surface) => opened.push(surface) },
	);
	return { items, opened };
}

function flatten(items: readonly SoundscaperNativeServicesMenuItem[]): SoundscaperNativeServicesMenuItem[] {
	return items.flatMap((item) => [item, ...flatten(item.items ?? [])]);
}

function find(items: readonly SoundscaperNativeServicesMenuItem[], id: string): SoundscaperNativeServicesMenuItem {
	const found = flatten(items).find((item) => item.id === id);
	assert.ok(found, `expected a ${id} entry`);
	return found;
}

test('Framescaper receives none of the Soundscaper native audio tier', () => {
	const { items } = build({ productId: 'framescaper' });
	assert.deepEqual(items.tools, []);
	assert.deepEqual(items.effect, []);
});

test('every native surface is reached from an existing menu family and none is always-visible chrome', () => {
	const { items } = build();
	const ids = [...flatten(items.tools), ...flatten(items.effect)].map(({ id }) => id);
	for (const surface of SOUNDSCAPER_NATIVE_SERVICE_SURFACES) {
		assert.ok(ids.includes(surface), `${surface} must be menu-reached`);
	}
	assert.deepEqual(Object.keys(items), ['tools', 'effect']);
});

test('a healthy tier opens each surface exactly once per click', () => {
	const { items, opened } = build();
	find(items.tools, 'native-audio-device').onClick?.();
	find(items.effect, 'native-effect-scan').onClick?.();
	assert.deepEqual(opened, ['native-audio-device', 'native-effect-scan']);
});

test('the surfaces that turn the tier on or repair it stay reachable while it is off', () => {
	for (const snapshot of [
		{ ...HEALTHY, enabled: false },
		{ ...HEALTHY, quarantined: true },
		{ ...HEALTHY, payloadAvailable: false, payloadDetail: 'No Windows ARM64 build host is provisioned.' },
	]) {
		const { items } = build({}, snapshot);
		for (const surface of SOUNDSCAPER_ALWAYS_REACHABLE_SURFACES) {
			const entry = find(surface === 'native-audio-preferences' ? items.tools : items.effect, surface);
			assert.equal(entry.disabled, false, `${surface} must stay reachable so the user can act`);
		}
		assert.equal(find(items.tools, 'native-audio-device').disabled, true);
	}
});

test('a disabled entry says which problem it has, not merely that it is unavailable', () => {
	const quarantined = build({}, { ...HEALTHY, quarantined: true });
	assert.match(find(quarantined.items.tools, 'native-audio-device').disabledReason, /quarantined/iu);

	const unbuilt = build({}, {
		...HEALTHY,
		payloadAvailable: false,
		payloadDetail: 'No Windows ARM64 build host is provisioned.',
	});
	assert.match(find(unbuilt.items.tools, 'native-audio-device').disabledReason, /build host is provisioned/u);

	const noBackend = build({}, { ...HEALTHY, usableAudioBackends: [] });
	assert.match(find(noBackend.items.tools, 'native-audio-device').disabledReason, /no native audio backend/iu);

	const noFormat = build({}, { ...HEALTHY, enabledPluginFormats: [] });
	assert.match(find(noFormat.items.effect, 'native-effect-scan').disabledReason, /no native effect format/iu);
});

test('a disabled entry cannot be activated at all', () => {
	const { items, opened } = build({}, { ...HEALTHY, enabled: false });
	const entry = find(items.tools, 'native-audio-device');
	assert.equal(entry.disabled, true);
	assert.equal(entry.onClick, undefined, 'a disabled entry must carry no activation path');
	assert.deepEqual(opened, []);
});

test('scanning is refused while the project is read-only or editing is blocked', () => {
	for (const overrides of [{ readOnly: true }, { editingBlocked: true }]) {
		const { items } = build(overrides);
		assert.equal(find(items.effect, 'native-effect-scan').disabled, true);
		assert.equal(find(items.effect, 'native-effect-manage').disabled, false,
			'managing existing effects must survive a read-only project');
	}
});

test('a build with no native runtime shows no native entries at all', () => {
	for (const input of [
		{ runtimeAvailable: false },
		{ snapshot: null },
	] as const) {
		const { items } = build(input, 'snapshot' in input ? null : HEALTHY);
		assert.deepEqual(items.tools, [], 'the browser editor advertises no native tier');
		assert.deepEqual(items.effect, []);
	}
});

test('a group stays reachable while any child is, and the always-reachable ones always are', () => {
	const { items } = build({}, { ...HEALTHY, enabled: false, usableAudioBackends: [], enabledPluginFormats: [] });
	assert.equal(items.tools[0].disabled, false, 'preferences keep the audio group reachable');
	assert.equal(items.effect[0].disabled, false, 'manage keeps the effect group reachable');
	assert.equal(find(items.tools, 'native-audio-device').disabled, true);
	assert.equal(find(items.effect, 'native-effect-scan').disabled, true);
});
