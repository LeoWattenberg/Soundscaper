/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityXmlNode } from '../src/common/editor/audacity-binary-xml.js';
import { readAup4ProjectSummary } from '../src/common/editor/aup4-profile.js';

test('AUP4 summary admits Audacity native boundary tempo settings', () => {
	const root = createAudacityXmlNode('project', [
		attribute('rate', 48_000),
		attribute('time_signature_tempo', 1_000),
		attribute('time_signature_upper', 0x7fff_ffff),
		attribute('time_signature_lower', 0x4000_0000),
	]);

	const summary = readAup4ProjectSummary(root);
	assert.equal(summary.tempo, 1_000);
	assert.deepEqual(summary.timeSignature, {
		numerator: 0x7fff_ffff,
		denominator: 0x4000_0000,
	});
});

function attribute(name, value) {
	return { kind: 'attribute', name, type: 'int', value };
}
