/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	ACCEPTED_PROJECT_FILE_EXTENSIONS,
	LEGACY_PROJECT_FILE_EXTENSION,
	PROJECT_FILE_EXTENSION_BY_PRODUCT,
} from '../src/common/project-file-extensions.ts';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('the compatibility register states the suffix each product writes and accepts', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-product-native-project-file-suffix');
	assert.ok(rule, 'the product-native suffix rule must exist');
	assert.equal(rule.status, 'implemented');
	assert.match(
		rule.currentBehavior,
		/Soundscaper writes \.sscape, Framescaper writes \.fscape, and the roadmap-only Lightscaper reserves \.liscape/u,
	);
	for (const extension of ACCEPTED_PROJECT_FILE_EXTENSIONS) {
		assert.ok(rule.currentBehavior.includes(extension), extension);
	}
	assert.match(rule.currentBehavior, /routing hint only/u);
	assert.match(rule.currentBehavior, /scape-range-v1 desktop read profile rather than bounded materialization/u);
	assert.match(rule.currentBehavior, /neither shipping app claims \.liscape/u);
	assert.match(rule.currentBehavior, /manifest\/root schema-family tuple.*archive format.*remain authoritative/u);
	assert.match(rule.currentBehavior, /application\/vnd\.soundscaper\.scape\+zip/u);
	assert.match(rule.currentBehavior, /\.scapefx/u);
});

test('the compatibility document repeats that truth for readers', async () => {
	const documentation = await readFile(documentationUrl, 'utf8');
	assert.match(documentation, /## Product-native project file suffixes/u);
	for (const [product, extension] of Object.entries(PROJECT_FILE_EXTENSION_BY_PRODUCT)) {
		const productName = `${product[0].toUpperCase()}${product.slice(1)}`;
		assert.match(documentation, new RegExp(`${productName}[^.]*\\${extension}`, 'u'), product);
	}
	assert.match(documentation, new RegExp(`legacy \`\\${LEGACY_PROJECT_FILE_EXTENSION}\``, 'u'));
	assert.match(documentation, /Mix\.sscape` saved from Framescaper\s+becomes `Mix\.fscape/u);
	assert.match(documentation, /copied byte for byte/u);
});
