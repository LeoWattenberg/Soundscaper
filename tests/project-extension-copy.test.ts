/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import {
	PROJECT_EXTENSION_COPY_KEYS,
	resolveProjectExtensionCopy,
} from '../src/common/editor/ui/project-extension-copy.ts';

test('every bundled catalog leaves the project suffix to the running product', () => {
	for (const catalog of [ENGLISH_COPY, GERMAN_COPY]) {
		for (const key of PROJECT_EXTENSION_COPY_KEYS) {
			const template = catalog[key];
			assert.equal(typeof template, 'string', key);
			assert.ok(template.includes('{projectExtension}'), key);
			assert.ok(!template.includes('.scape'), key);
		}
	}
});

test('resolved copy names the suffix of the product that is running', () => {
	const soundscaper = resolveProjectExtensionCopy(ENGLISH_COPY, 'soundscaper');
	const framescaper = resolveProjectExtensionCopy(ENGLISH_COPY, 'framescaper');
	assert.equal(soundscaper.saveScape, 'Export project file (.sscape)');
	assert.equal(framescaper.saveScape, 'Export project file (.fscape)');
	assert.equal(soundscaper.openScape, 'Open Scape project file (.sscape)');
	assert.equal(framescaper.openScape, 'Open Scape project file (.fscape)');
	assert.match(soundscaper.crossProductHandoffUnavailable, /Export a \.sscape file/u);
	assert.match(framescaper.crossProductHandoffUnavailable, /Export a \.fscape file/u);
	assert.match(
		resolveProjectExtensionCopy(GERMAN_COPY, 'framescaper').saveScape,
		/^Projektdatei \(\.fscape\) exportieren$/u,
	);
});

test('a remote pack that lost the placeholder is passed through, not rejected', () => {
	const stale = { ...ENGLISH_COPY, saveScape: 'Projekt sichern' };
	assert.equal(resolveProjectExtensionCopy(stale, 'soundscaper').saveScape, 'Projekt sichern');
	assert.equal(resolveProjectExtensionCopy({}, 'soundscaper').saveScape, '');
});

test('copy cannot be resolved for a product with no registered suffix', () => {
	assert.throws(
		() => resolveProjectExtensionCopy(ENGLISH_COPY, 'lightscaper-preview'),
		/No project file extension is registered for product/u,
	);
	assert.throws(() => resolveProjectExtensionCopy(null as unknown as Record<string, unknown>, 'soundscaper'), /Editor copy is required/u);
});
