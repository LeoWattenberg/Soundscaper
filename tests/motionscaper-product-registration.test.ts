/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PRODUCT_IDS, otherProductIds, productIdentity } from '../src/common/product-identities.js';
import { productProfile } from '../src/common/products.js';
import { productHref, productWebOrigin } from '../src/common/product-web-links.js';
import {
	ACCEPTED_PROJECT_FILE_EXTENSIONS, projectFileExtensionForProduct, withProjectFileExtension,
} from '../src/common/project-file-extensions.ts';
import { resolveWebRoute } from '../src/common/site/route.js';
import { resolveOfflineApplicationShellTarget } from '../src/common/offline/application-shell.ts';

test('Motionscaper owns independent project commands without inheriting media authoring capabilities', () => {
	assert.deepEqual(PRODUCT_IDS, ['soundscaper', 'framescaper', 'motionscaper']);
	assert.equal(productIdentity('motionscaper').name, 'Motionscaper');
	const profile = productProfile('motionscaper');
	assert.equal(profile.desktop.appId, 'org.motionscaper.desktop');
	assert.equal(profile.desktop.sessionPartition, 'persist:motionscaper-production');
	assert.deepEqual(profile.panels, []);
	assert.deepEqual(profile.importChoices, ['scape']);
	assert.deepEqual(profile.exportChoices, ['scape']);
	assert.ok(profile.enabledCommands.includes('project'));
	assert.ok(Object.values(profile.capabilities).every((enabled) => enabled === false));
	assert.deepEqual(profile.applicationFeatures, { motionscaperMotionWorkspace: true });
	assert.ok(Object.isFrozen(profile));
});

test('Motionscaper keeps explicit peer choices and owns its origin root and offline worker', () => {
	assert.deepEqual(otherProductIds('motionscaper'), ['soundscaper', 'framescaper']);
	assert.deepEqual(otherProductIds('soundscaper'), ['framescaper', 'motionscaper']);
	assert.equal(productWebOrigin('motionscaper'), 'https://motionscaper.org');
	assert.equal(productHref('motionscaper', 'de', { builtProductId: 'motionscaper' }), '/de/');
	assert.equal(productHref('motionscaper', 'de', { builtProductId: 'framescaper' }), 'https://motionscaper.org/de/');
	assert.deepEqual(resolveWebRoute('/embed/de/', 'motionscaper'), {
		productId: 'motionscaper', locale: 'de', embedded: true,
	});
	assert.deepEqual(resolveOfflineApplicationShellTarget('motionscaper', 'motionscaper'), {
		scriptUrl: '/service-worker.js', scope: '/',
	});
	assert.throws(() => resolveOfflineApplicationShellTarget('motionscaper', 'framescaper'));
});

test('Motionscaper project suffix is recognized without taking Lightscaper’s reserved suffix', () => {
	assert.equal(projectFileExtensionForProduct('motionscaper'), '.mscape');
	assert.equal(projectFileExtensionForProduct('lightscaper'), '.liscape');
	assert.ok(ACCEPTED_PROJECT_FILE_EXTENSIONS.includes('.mscape'));
	assert.equal(withProjectFileExtension('Title.FSCAPE', '.mscape'), 'Title.mscape');
	assert.equal(withProjectFileExtension('Title.mscape', '.fscape'), 'Title.fscape');
});
