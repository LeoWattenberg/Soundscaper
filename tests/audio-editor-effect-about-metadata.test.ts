/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { effectAboutMetadata } from '../src/common/editor/ui/inspector/effect-about-metadata.ts';

function values(type: Parameters<typeof effectAboutMetadata>[0], options?: Parameters<typeof effectAboutMetadata>[2]) {
	return Object.fromEntries(effectAboutMetadata(type, 'en', options).fields.map(({ key, value }) => [key, value]));
}

test('Audacity metadata uses the effect inventory and the applicable pinned source', () => {
	assert.deepEqual(values('audacity-amplify'), {
		format: 'Audacity', author: 'Audacity', version: '3.7.7', license: 'GPL-3.0',
		category: 'volume', source: 'Audacity', identifier: 'audacity-amplify',
	});
	assert.equal(values('audacity-reverb').version, '4.0.0');
});

test('first-party and reviewed effects expose only facts recorded by their packages', () => {
	assert.deepEqual(values('eq'), {
		format: 'Built-in', license: 'AGPL-3.0-only', category: 'EQ and filters',
		source: 'Soundscaper', identifier: 'eq',
	});
	assert.deepEqual(values('reviewed-utility-gain'), {
		format: 'Reviewed WASM', version: '1.0.0', license: 'AGPL-3.0-only',
		category: 'Special effects', source: 'Soundscaper', identifier: 'org.soundscaper.utility-gain',
	});
	assert.equal(values('noise-gate').category, 'Noise and repair');
	const localized = effectAboutMetadata('noise-gate', GERMAN_COPY);
	assert.equal(localized.title, 'Rausch-Gate');
	assert.equal(localized.fields.find(({ key }) => key === 'category')?.value, GERMAN_COPY.noiseRepair);
});

test('Nyquist metadata carries the bundled plug-in header rather than a guessed install path', () => {
	const about = effectAboutMetadata('nyquist:adjustable-fade');
	assert.equal(about.title, 'Adjustable Fade');
	assert.deepEqual(Object.fromEntries(about.fields.map(({ key, value }) => [key, value])), {
		format: 'Nyquist', author: 'Steve Daulton', version: '3.0.4-2',
		license: 'GNU General Public License v2.0 or later', category: 'legacy',
		source: 'Audacity', identifier: 'nyquist:adjustable-fade',
	});
});

test('native metadata uses its effect context and optional admitted descriptor', () => {
	const effect = {
		type: 'native-plugin',
		context: { format: 'vst3', stablePluginId: 'vendor.plugin', binarySha256: 'a'.repeat(64) },
	};
	assert.deepEqual(values(effect), {
		format: 'VST3', identifier: 'vendor.plugin',
	});
	const about = effectAboutMetadata(effect, 'en', { nativePlugin: {
		name: 'Studio EQ', vendor: 'Audio House', version: '2.3.1',
		classification: 'effect', installPath: '/opt/plugins/Studio EQ.vst3',
	} });
	assert.equal(about.title, 'Studio EQ');
	assert.deepEqual(Object.fromEntries(about.fields.map(({ key, value }) => [key, value])), {
		format: 'VST3', author: 'Audio House', version: '2.3.1',
		installPath: '/opt/plugins/Studio EQ.vst3', category: 'effect', identifier: 'vendor.plugin',
	});
	assert.equal(values(effect, { nativePlugin: {
		name: 'Studio EQ', vendor: 'Audio House', format: 'vst3', kind: 'effect',
		installations: [{ version: '2.3.1', selected: true }],
	} }).version, '2.3.1');
});

test('unknown and missing effects never receive invented authors, versions, or licenses', () => {
	assert.deepEqual(values('unrecognized-effect'), { identifier: 'unrecognized-effect' });
	const missing = effectAboutMetadata({ type: 'missing', missing: { name: 'Old Plug-in', nativeId: 'old.vendor.plugin' } });
	assert.match(missing.title, /Old Plug-in/u);
	assert.deepEqual(Object.fromEntries(missing.fields.map(({ key, value }) => [key, value])), {
		identifier: 'old.vendor.plugin',
	});
});
