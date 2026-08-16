/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveCopyCatalogOverrides,
} from '../src/common/editor/ui/copy-catalog-overrides.ts';
import {
	FRAMESCAPER_NATIVE_SERVICES_COPY,
	resolveFramescaperNativeServicesCopy,
} from '../src/common/editor/ui/framescaper-native-services-copy.ts';
import {
	SOUNDSCAPER_PRODUCTION_COPY,
	resolveSoundscaperProductionCopy,
} from '../src/common/editor/ui/soundscaper-production-copy.ts';

const CATALOG = Object.freeze({ apply: 'Apply', cancel: 'Cancel' });

test('an override replaces a declared key only when it carries text', () => {
	assert.deepEqual(resolveCopyCatalogOverrides(CATALOG, {}), { apply: 'Apply', cancel: 'Cancel' });
	assert.deepEqual(resolveCopyCatalogOverrides(CATALOG), { apply: 'Apply', cancel: 'Cancel' });
	assert.deepEqual(resolveCopyCatalogOverrides(CATALOG, { apply: 'Anwenden' }), {
		apply: 'Anwenden', cancel: 'Cancel',
	});
	// An empty or absent translation falls back rather than blanking the control.
	assert.deepEqual(resolveCopyCatalogOverrides(CATALOG, { apply: '', cancel: undefined }), {
		apply: 'Apply', cancel: 'Cancel',
	});
	// A key the catalog does not declare is not a control this surface has.
	assert.deepEqual(resolveCopyCatalogOverrides(CATALOG, { close: 'Schließen' }), {
		apply: 'Apply', cancel: 'Cancel',
	});
	assert.equal(Object.isFrozen(resolveCopyCatalogOverrides(CATALOG, {})), true);
});

test('both editor copy catalogs resolve through the one override policy', () => {
	// The policy is decided once: a change to trimming or the empty-string rule
	// cannot land in one catalog and be missed in the other.
	for (const overrides of [
		{},
		{ proxies: 'Stellvertreter', freeze: 'Einfrieren' },
		{ proxies: '', freeze: '', unknownKey: 'x' },
	]) {
		assert.deepEqual(
			resolveFramescaperNativeServicesCopy(overrides),
			resolveCopyCatalogOverrides(FRAMESCAPER_NATIVE_SERVICES_COPY, overrides),
		);
		assert.deepEqual(
			resolveSoundscaperProductionCopy(overrides),
			resolveCopyCatalogOverrides(SOUNDSCAPER_PRODUCTION_COPY, overrides),
		);
	}
});
