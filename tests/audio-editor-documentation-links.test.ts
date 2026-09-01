import test from 'node:test';
import assert from 'node:assert/strict';

import {
	DOCUMENTATION_BASE_URL,
	documentationUrl,
} from '../src/common/editor/documentation-links.ts';
import { handbookPlan } from '../scripts/lib/product-web-routing.mjs';

test('documentation links route each product to its own manual and first-project guide', () => {
	assert.equal(DOCUMENTATION_BASE_URL, 'https://soundscaper.org/docs');
	assert.equal(documentationUrl('soundscaper', 'manual'), 'https://soundscaper.org/docs/soundscaper/');
	assert.equal(
		documentationUrl('soundscaper', 'tutorials'),
		'https://soundscaper.org/docs/soundscaper/first-project/',
	);
	assert.equal(documentationUrl('framescaper', 'manual'), 'https://soundscaper.org/docs/framescaper/');
	assert.equal(
		documentationUrl('framescaper', 'tutorials'),
		'https://soundscaper.org/docs/framescaper/first-project/',
	);
});

test('the handbook the editor links to is the one the Soundscaper build stages', () => {
	const handbook = handbookPlan('soundscaper');
	assert.ok(handbook);
	assert.equal(new URL(DOCUMENTATION_BASE_URL).pathname, handbook.basePath);
	assert.equal(new URL(DOCUMENTATION_BASE_URL).origin, 'https://soundscaper.org');
	assert.equal(handbookPlan('framescaper'), null);
});

test('documentation links reject unknown products and destinations', () => {
	assert.throws(() => documentationUrl('unknown', 'manual'), /Unsupported editor product/u);
	assert.throws(
		() => documentationUrl('soundscaper', 'unknown' as 'manual'),
		/Unsupported documentation destination/u,
	);
});
