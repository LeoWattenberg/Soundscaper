/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	numberAttribute,
	parseXmlDocument,
	serializeXmlDocument,
	xmlElement,
} from '../src/common/editor/dawproject-xml.ts';

test('DAWproject XML preserves tiny and large finite doubles without exponent notation', () => {
	const values = [1e-21, Number.MIN_VALUE, 1e21, Number.MAX_VALUE];
	const document = serializeXmlDocument(xmlElement('Parameters', Object.fromEntries(
		values.map((value, index) => [`value${index}`, value]),
	)));
	const parsed = parseXmlDocument(document);
	for (const [index, value] of values.entries()) {
		assert.equal(numberAttribute(parsed, `value${index}`), value);
	}
	assert.doesNotMatch(document, /="[^"]*[eE][+-]?\d+"/u);
});
