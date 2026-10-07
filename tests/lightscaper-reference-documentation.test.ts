/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { loadReferenceSources, renderReferenceDocuments } from '../scripts/lib/docs-reference-generator.mjs';
import { PRODUCT_IDS } from '../src/common/product-identities.js';
import { FRAMESCAPER_PROFILE, LIGHTSCAPER_PROFILE, SOUNDSCAPER_PROFILE } from '../src/common/product-profiles.js';

test('Lightscaper generated references describe managed photo import and the catalog without enabling develop or export', async () => {
	const documents = renderReferenceDocuments(await loadReferenceSources(resolve(import.meta.dirname, '..')));
	const capabilities = documents.get('product-capabilities.md');
	assert.equal(typeof capabilities, 'string');
	assert.match(capabilities as string, /\| Capability \| Soundscaper \| Framescaper \| Lightscaper \|/u);
	assert.match(capabilities as string, /\| Photo library shell \| Not enabled \| Not enabled \| Enabled \|/u);
	assert.match(capabilities as string, /\| Photo catalog \| Not enabled \| Not enabled \| Enabled \|/u);
	for (const label of ['Photo develop', 'Photo export', 'Raw photo decoding']) {
		assert.ok((capabilities as string).includes(`| ${label} | Not enabled | Not enabled | Not enabled |`));
	}
	assert.match(capabilities as string, /\| Lightscaper \| Photos \| None \|/u);
	assert.match(capabilities as string, /managed.*import.*brows.*rating/iu);
	for (const page of ['commands.md', 'nyquist-plugins.md', 'workspaces.md']) {
		assert.doesNotMatch(documents.get(page) as string, /Lightscaper/u, `${page} must not expose timeline-editor commands in the photo shell`);
	}
	const projects = documents.get('project-files.md') as string;
	assert.match(projects, /Soundscaper and Framescaper each write their own suffix/u);
	assert.doesNotMatch(projects, /Lightscaper.*(?:write|open)/u);
	assert.match(projects, /`\.liscape` \| No shipping product/u);
});

test('enabling a photo catalog does not inherit shared timeline command inventories', async () => {
	const sources = await loadReferenceSources(resolve(import.meta.dirname, '..'));
	const documents = renderReferenceDocuments({ ...sources, products: {
		PRODUCT_IDS,
		PRODUCT_PROFILES: { soundscaper: SOUNDSCAPER_PROFILE, framescaper: FRAMESCAPER_PROFILE, lightscaper: {
			...LIGHTSCAPER_PROFILE, capabilities: { ...LIGHTSCAPER_PROFILE.capabilities, project: true, photoCatalog: true },
		} },
	} });
	for (const page of ['commands.md', 'nyquist-plugins.md', 'workspaces.md']) {
		assert.doesNotMatch(documents.get(page) as string, /Lightscaper/u);
	}
});
