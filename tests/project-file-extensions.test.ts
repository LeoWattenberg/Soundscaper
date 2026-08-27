/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ACCEPTED_PROJECT_FILE_EXTENSION_LIST,
	ACCEPTED_PROJECT_FILE_EXTENSIONS,
	isAcceptedProjectFileExtension,
	isLegacyProjectFileName,
	isProjectFileName,
	LEGACY_PROJECT_FILE_EXTENSION,
	PROJECT_FILE_EXTENSION_BY_PRODUCT,
	projectFileExtensionForProduct,
	projectFileExtensionOf,
	withProjectFileExtension,
} from '../src/common/project-file-extensions.ts';
import { PRODUCT_IDS, PRODUCT_PROFILES, productProfile } from '../src/common/products.js';

test('the registry names one suffix per product and admits every one of them', () => {
	assert.deepEqual(PROJECT_FILE_EXTENSION_BY_PRODUCT, {
		soundscaper: '.sscape',
		framescaper: '.fscape',
		lightscaper: '.liscape',
	});
	assert.equal(LEGACY_PROJECT_FILE_EXTENSION, '.scape');
	assert.deepEqual([...ACCEPTED_PROJECT_FILE_EXTENSIONS], ['.sscape', '.fscape', '.liscape', '.scape']);
	assert.equal(ACCEPTED_PROJECT_FILE_EXTENSION_LIST, '.sscape,.fscape,.liscape,.scape');
	assert.equal(new Set(ACCEPTED_PROJECT_FILE_EXTENSIONS).size, ACCEPTED_PROJECT_FILE_EXTENSIONS.length);
	for (const extension of Object.values(PROJECT_FILE_EXTENSION_BY_PRODUCT)) {
		assert.ok(ACCEPTED_PROJECT_FILE_EXTENSIONS.includes(extension));
	}
	assert.ok(ACCEPTED_PROJECT_FILE_EXTENSIONS.includes(LEGACY_PROJECT_FILE_EXTENSION));
	for (const extension of ACCEPTED_PROJECT_FILE_EXTENSIONS) {
		assert.equal(extension, extension.toLowerCase());
		assert.ok(extension.startsWith('.'));
	}
	assert.ok(Object.isFrozen(PROJECT_FILE_EXTENSION_BY_PRODUCT));
	assert.ok(Object.isFrozen(ACCEPTED_PROJECT_FILE_EXTENSIONS));
});

test('every product profile declares the suffix the registry assigns it', () => {
	for (const productId of PRODUCT_IDS) {
		assert.equal(
			productProfile(productId).projectFileExtension,
			projectFileExtensionForProduct(productId),
		);
	}
	assert.equal(PRODUCT_PROFILES.soundscaper.projectFileExtension, '.sscape');
	assert.equal(PRODUCT_PROFILES.framescaper.projectFileExtension, '.fscape');
});

test('`.liscape` is reserved for a product that has no runtime profile yet', () => {
	assert.equal(projectFileExtensionForProduct('lightscaper'), '.liscape');
	assert.ok(!PRODUCT_IDS.includes('lightscaper'));
	assert.throws(() => productProfile('lightscaper'), /Unsupported editor product/u);
	assert.ok(isProjectFileName('storyboard.liscape'));
});

test('a product suffix is resolved case-insensitively and unknown products are refused', () => {
	assert.equal(projectFileExtensionForProduct('Soundscaper'), '.sscape');
	assert.equal(projectFileExtensionForProduct('FRAMESCAPER'), '.fscape');
	for (const unknown of ['', null, undefined, 'audacity', 'scape', 0]) {
		assert.throws(
			() => projectFileExtensionForProduct(unknown),
			/No project file extension is registered for product/u,
		);
	}
	assert.throws(() => projectFileExtensionForProduct('toString'), /No project file extension/u);
});

test('every accepted suffix is recognized regardless of case', () => {
	for (const extension of ACCEPTED_PROJECT_FILE_EXTENSIONS) {
		assert.equal(projectFileExtensionOf(`mix${extension}`), extension);
		assert.equal(projectFileExtensionOf(`mix${extension.toUpperCase()}`), extension);
		assert.equal(projectFileExtensionOf(`MIX${extension.replace('s', 'S')}`), extension);
		assert.ok(isProjectFileName(`mix${extension.toUpperCase()}`));
		assert.ok(isAcceptedProjectFileExtension(extension.toUpperCase()));
	}
	assert.ok(isLegacyProjectFileName('Legacy.SCAPE'));
	assert.ok(!isLegacyProjectFileName('current.sscape'));
});

test('a disguised or partial suffix is not a project file', () => {
	const disguised = [
		'mix.sscape.zip',
		'mix.scape.exe',
		'mix.fscape.txt',
		'mix.sscape ',
		'mixsscape',
		'mix.sscapex',
		'mix.scapefx',
		'mix.scap',
		'sscape',
		'mix.zip',
		'takes.sscape/notes.txt',
		'takes.fscape\\notes.txt',
		'',
		null,
		undefined,
		42,
	];
	for (const candidate of disguised) {
		assert.equal(projectFileExtensionOf(candidate), null, String(candidate));
		assert.ok(!isProjectFileName(candidate), String(candidate));
	}
	assert.ok(!isAcceptedProjectFileExtension('.sscape.zip'));
	assert.ok(!isAcceptedProjectFileExtension('sscape'));
	assert.ok(!isAcceptedProjectFileExtension(null));
});

test('saving replaces a recognized suffix and otherwise appends the active one', () => {
	assert.equal(withProjectFileExtension('Mix.sscape', '.fscape'), 'Mix.fscape');
	assert.equal(withProjectFileExtension('Mix.scape', '.sscape'), 'Mix.sscape');
	assert.equal(withProjectFileExtension('Mix.LISCAPE', '.sscape'), 'Mix.sscape');
	assert.equal(withProjectFileExtension('Mix', '.fscape'), 'Mix.fscape');
	assert.equal(withProjectFileExtension('Mix.sscape', '.sscape'), 'Mix.sscape');
	assert.equal(withProjectFileExtension('Mix.SSCAPE', '.sscape'), 'Mix.sscape');
	assert.equal(withProjectFileExtension('Mix v2.1', '.sscape'), 'Mix v2.1.sscape');
	assert.equal(withProjectFileExtension('  Mix  ', '.sscape'), 'Mix.sscape');
	assert.equal(withProjectFileExtension('', '.sscape'), 'project.sscape');
	assert.equal(withProjectFileExtension(null, '.fscape'), 'project.fscape');
	assert.equal(withProjectFileExtension('Mix.sscape.zip', '.fscape'), 'Mix.sscape.zip.fscape');
});

test('saving refuses a suffix the registry does not admit', () => {
	for (const extension of ['.zip', 'sscape', '.aup4', '', null, undefined]) {
		assert.throws(
			() => withProjectFileExtension('Mix', extension),
			/Unsupported project file extension/u,
		);
	}
});
