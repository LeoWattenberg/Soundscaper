import test from 'node:test';
import assert from 'node:assert/strict';

import {
	DOCUMENTATION_ORIGIN,
	documentationUrl,
} from '../src/common/editor/documentation-links.ts';

test('documentation links route each product to its own manual and first-project guide', () => {
	assert.equal(DOCUMENTATION_ORIGIN, 'https://docs.soundscaper.org');
	assert.equal(documentationUrl('soundscaper', 'manual'), 'https://docs.soundscaper.org/soundscaper/');
	assert.equal(
		documentationUrl('soundscaper', 'tutorials'),
		'https://docs.soundscaper.org/soundscaper/first-project/',
	);
	assert.equal(documentationUrl('framescaper', 'manual'), 'https://docs.soundscaper.org/framescaper/');
	assert.equal(
		documentationUrl('framescaper', 'tutorials'),
		'https://docs.soundscaper.org/framescaper/first-project/',
	);
});

test('documentation links reject unknown products and destinations', () => {
	assert.throws(() => documentationUrl('unknown', 'manual'), /Unsupported editor product/u);
	assert.throws(
		() => documentationUrl('soundscaper', 'unknown' as 'manual'),
		/Unsupported documentation destination/u,
	);
});
