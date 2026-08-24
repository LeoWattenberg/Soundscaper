/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_NATIVE_TIER_CONTROL_ACTIONS,
	applyDesktopNativeTierControl,
	readDesktopNativeTierControls,
	registerDesktopNativeTierControls,
} from '../desktop/native-tier-controls.ts';

type SettingsState = {
	nativeProbeHelperEnabled: boolean;
	nativeAudioHelperEnabled: boolean;
	nativePluginDiscoveryEnabled: boolean;
};

function harness(overrides: Partial<SettingsState> = {}) {
	const state: SettingsState = {
		nativeProbeHelperEnabled: false,
		nativeAudioHelperEnabled: false,
		nativePluginDiscoveryEnabled: false,
		...overrides,
	};
	const calls: Array<readonly [string, unknown?]> = [];
	let probeQuarantined = true;
	let audioQuarantined = true;
	const settings = {
		snapshot: () => ({ ...state }),
		setNativeProbeHelperEnabled: async (enabled: boolean) => {
			calls.push(['set-probe', enabled]);
			state.nativeProbeHelperEnabled = enabled;
			return enabled;
		},
		setNativeAudioHelperEnabled: async (enabled: boolean) => {
			calls.push(['set-audio-setting', enabled]);
			state.nativeAudioHelperEnabled = enabled;
			return enabled;
		},
		setNativePluginDiscoveryEnabled: async (enabled: boolean) => {
			calls.push(['set-effects', enabled]);
			state.nativePluginDiscoveryEnabled = enabled;
			return enabled;
		},
	};
	const tier = {
		probe: {
			availability: () => ({ enabled: state.nativeProbeHelperEnabled, quarantined: probeQuarantined }),
			clearQuarantine: () => { calls.push(['clear-probe']); probeQuarantined = false; },
		},
		audio: {
			controlSnapshot: () => ({ enabled: state.nativeAudioHelperEnabled, quarantined: audioQuarantined }),
			setEnabled: async (enabled: boolean) => {
				calls.push(['set-audio', enabled]);
				state.nativeAudioHelperEnabled = enabled;
				return enabled;
			},
			clearQuarantine: () => { calls.push(['clear-audio']); audioQuarantined = false; },
		},
		plugins: {
			setEnabled: async (enabled: boolean) => {
				calls.push(['set-effects', enabled]);
				state.nativePluginDiscoveryEnabled = enabled;
				return enabled;
			},
		},
	};
	return { calls, settings, state, tier };
}

test('the native-tier controls publish one frozen closed snapshot', () => {
	const fixture = harness({
		nativeProbeHelperEnabled: true,
		nativePluginDiscoveryEnabled: true,
	});
	const snapshot = readDesktopNativeTierControls(fixture.settings, fixture.tier);

	assert.deepEqual(snapshot, {
		probeHelperEnabled: true,
		probeHelperQuarantined: true,
		audioHelperEnabled: false,
		audioHelperQuarantined: true,
		nativeEffectDiscoveryEnabled: true,
	});
	assert.equal(Object.isFrozen(snapshot), true);
	assert.deepEqual(Object.keys(snapshot), [
		'probeHelperEnabled',
		'probeHelperQuarantined',
		'audioHelperEnabled',
		'audioHelperQuarantined',
		'nativeEffectDiscoveryEnabled',
	]);
});

test('the five closed actions route once and return the fresh snapshot', async () => {
	const fixture = harness();
	assert.deepEqual(DESKTOP_NATIVE_TIER_CONTROL_ACTIONS, [
		'set-probe-helper-enabled',
		'clear-probe-helper-quarantine',
		'set-audio-helper-enabled',
		'clear-audio-helper-quarantine',
		'set-native-effect-discovery-enabled',
	]);

	await applyDesktopNativeTierControl(
		{ action: 'set-probe-helper-enabled', enabled: true }, fixture.settings, fixture.tier,
	);
	await applyDesktopNativeTierControl(
		{ action: 'clear-probe-helper-quarantine' }, fixture.settings, fixture.tier,
	);
	await applyDesktopNativeTierControl(
		{ action: 'set-audio-helper-enabled', enabled: true }, fixture.settings, fixture.tier,
	);
	await applyDesktopNativeTierControl(
		{ action: 'clear-audio-helper-quarantine' }, fixture.settings, fixture.tier,
	);
	const result = await applyDesktopNativeTierControl(
		{ action: 'set-native-effect-discovery-enabled', enabled: true }, fixture.settings, fixture.tier,
	);

	assert.deepEqual(fixture.calls, [
		['set-probe', true],
		['clear-probe'],
		['set-audio', true],
		['clear-audio'],
		['set-effects', true],
	]);
	assert.deepEqual(result, {
		probeHelperEnabled: true,
		probeHelperQuarantined: false,
		audioHelperEnabled: true,
		audioHelperQuarantined: false,
		nativeEffectDiscoveryEnabled: true,
	});
});

test('native-tier requests refuse unknown actions, coercion and surplus fields', async () => {
	const fixture = harness();
	for (const request of [
		null,
		{},
		{ action: 'unknown' },
		{ action: 'set-probe-helper-enabled' },
		{ action: 'set-probe-helper-enabled', enabled: 'true' },
		{ action: 'clear-probe-helper-quarantine', enabled: false },
		{ action: 'clear-audio-helper-quarantine', extra: true },
	]) {
		await assert.rejects(
			applyDesktopNativeTierControl(request, fixture.settings, fixture.tier),
			/invalid|unsupported|boolean|fields|required/iu,
		);
	}
	assert.deepEqual(fixture.calls, []);
});

test('registered apply controls validate the active renderer owner before mutation', async () => {
	const fixture = harness();
	const handlers = new Map<string, (event: object, value?: unknown) => unknown>();
	let owns = true;
	registerDesktopNativeTierControls({
		channels: {
			nativeTierControls: 'controls:read',
			nativeTierApply: 'controls:apply',
		},
		handle: (channel, listener) => { handlers.set(channel, listener); },
		ownerFor: () => {
			if (!owns) throw new Error('The renderer owner is stale.');
			return {};
		},
		settings: fixture.settings,
		tier: fixture.tier,
	});

	assert.deepEqual(handlers.get('controls:read')?.({}), readDesktopNativeTierControls(fixture.settings, fixture.tier));
	assert.deepEqual(await handlers.get('controls:apply')?.({}, {
		action: 'set-probe-helper-enabled', enabled: true,
	}), readDesktopNativeTierControls(fixture.settings, fixture.tier));
	assert.equal(fixture.state.nativeProbeHelperEnabled, true);

	owns = false;
	await assert.rejects(async () => handlers.get('controls:apply')?.({}, {
		action: 'set-native-effect-discovery-enabled', enabled: true,
	}), /owner is stale/u);
	assert.equal(fixture.state.nativePluginDiscoveryEnabled, false);
});

test('registration refuses missing, empty or aliased control channels', () => {
	const fixture = harness();
	for (const channels of [
		{},
		{ nativeTierControls: '', nativeTierApply: 'apply' },
		{ nativeTierControls: 'same', nativeTierApply: 'same' },
	]) {
		assert.throws(() => registerDesktopNativeTierControls({
			channels,
			handle: () => undefined,
			ownerFor: () => ({}),
			settings: fixture.settings,
			tier: fixture.tier,
		}), /channel/iu);
	}
});
