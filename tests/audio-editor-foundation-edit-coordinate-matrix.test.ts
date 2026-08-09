/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	FOUNDATION_EDIT_COORDINATE_MATRIX,
	FOUNDATION_EDIT_PRIMITIVES,
} from '../src/common/editor/foundation-edit-coordinate-matrix.ts';

const ROOT = new URL('../src/common/editor/', import.meta.url);

test('foundation edit matrix is exhaustive and every implementation cites its owned row', async () => {
	assert.deepEqual(Object.keys(FOUNDATION_EDIT_COORDINATE_MATRIX), [...FOUNDATION_EDIT_PRIMITIVES]);
	for (const primitive of FOUNDATION_EDIT_PRIMITIVES) {
		const rule = FOUNDATION_EDIT_COORDINATE_MATRIX[primitive];
		assert.equal(rule.primitive, primitive);
		for (const field of [
			'audioPlacement', 'audioExtent', 'audioSourceRange',
			'videoPlacement', 'videoExtent', 'videoSourceRange', 'operationConformance',
		] as const) assert.ok(rule[field].length > 5, `${primitive}.${field} must state its rule`);
		assert.ok(rule.implementation.length > 0);
		for (const relativeFile of rule.implementation) {
			const source = await readFile(new URL(relativeFile, ROOT), 'utf8');
			assert.match(source, new RegExp(`foundation-edit-matrix: ${primitive}`, 'u'));
		}
	}
});
