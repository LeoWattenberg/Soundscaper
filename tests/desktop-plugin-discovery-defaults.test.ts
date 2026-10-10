/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultPluginDiscoveryConsent } from '../desktop/plugin-discovery-defaults.ts';

test('new enabled installations admit standard folders only for activated platform formats', () => {
	const consent = createDefaultPluginDiscoveryConsent({
		pickDirectory: () => Promise.resolve(null), platform: 'linux', homeDirectory: '/home/editor',
	}, { enabled: true, isFormatActivated: (format) => ['vst3', 'au'].includes(format) });
	const view = consent.describe();
	assert.equal(view.formats.find((format) => format.format === 'vst3')?.granted, true);
	assert.deepEqual(consent.scanTargets('vst3').map((root) => root.path), ['/usr/lib/vst3', '/usr/local/lib/vst3', '/home/editor/.vst3']);
	assert.equal(view.formats.find((format) => format.format === 'clap')?.granted, false);
	assert.equal(view.formats.find((format) => format.format === 'au')?.granted, false);
	assert.equal(view.formats.some((format) => format.roots.some((root) => root.origin === 'custom')), false);
});

test('a saved disabled installation without a consent register receives no default folder grants', () => {
	const consent = createDefaultPluginDiscoveryConsent({ pickDirectory: () => Promise.resolve(null), platform: 'linux' },
		{ enabled: false, isFormatActivated: () => true });
	assert.equal(consent.describe().scanningEnabled, false);
});

test('a restored empty folder selection stays empty even when discovery is enabled', () => {
	const options = { pickDirectory: () => Promise.resolve(null), platform: 'linux' };
	const saved = createDefaultPluginDiscoveryConsent(options, { enabled: false, isFormatActivated: () => true });
	const restored = createDefaultPluginDiscoveryConsent({ ...options, state: saved.exportState() },
		{ enabled: true, isFormatActivated: () => true });
	assert.deepEqual(restored.exportState(), saved.exportState());
	assert.equal(restored.describe().scanningEnabled, false);
});
