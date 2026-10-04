/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { productProfile } from '../src/common/products.js';
import { mergeCatalog } from '../src/common/i18n/runtime.js';
import { aboutDialogInformation } from '../src/common/editor/ui/dialogs/about-dialog-model.ts';
import { resolveAboutDialogCopy } from '../src/common/editor/ui/about-dialog-copy.ts';

test('About identifies each product and only lists its enabled command modules', () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		const information = aboutDialogInformation(productId, '1.2.3-rc.4');
		assert.equal(information.name, productProfile(productId).name);
		assert.equal(information.version, '1.2.3-rc.4');
		assert.deepEqual(information.modules.map(({ id }) => id), productProfile(productId).enabledCommands);
		assert.equal(new Set(information.modules.map(({ id }) => id)).size, information.modules.length);
	}
	assert.ok(aboutDialogInformation('soundscaper').modules.some(({ id }) => id === 'audio-record'));
	assert.ok(!aboutDialogInformation('soundscaper').modules.some(({ id }) => id === 'video-effects'));
	assert.ok(!aboutDialogInformation('framescaper').modules.some(({ id }) => id === 'audio-record'));
	assert.throws(() => aboutDialogInformation('unsupported'), /Unsupported editor product/u);
});

test('About copy belongs to the translation inventory and resolves bundled German and scoped overrides', () => {
	const german = resolveAboutDialogCopy(mergeCatalog('de'));
	assert.equal(german.contributors, 'Mitwirkende');
	assert.equal(german.enabledModules, 'Aktivierte Module');
	assert.equal(german.license, 'Lizenz');
	assert.equal(resolveAboutDialogCopy({ 'ui.about.contributors': 'People' }).contributors, 'People');
	assert.equal(resolveAboutDialogCopy({ 'ui.about.contributors': '' }).contributors, 'Contributors');
});
