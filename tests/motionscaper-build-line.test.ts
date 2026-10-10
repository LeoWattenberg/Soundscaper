/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFramescaperBuildLine } from '../scripts/lib/product-build-line.mjs';

test('Motionscaper cannot accidentally select the Framescaper successor schema line', () => {
	assert.equal(resolveFramescaperBuildLine('motionscaper', undefined), 'baseline');
	assert.equal(resolveFramescaperBuildLine('framescaper', ''), 'baseline');
	assert.equal(resolveFramescaperBuildLine('framescaper', 'successor'), 'successor');
	assert.throws(() => resolveFramescaperBuildLine('motionscaper', 'successor'), /only.*Framescaper/u);
	assert.throws(() => resolveFramescaperBuildLine('soundscaper', 'successor'), /only.*Framescaper/u);
	assert.throws(() => resolveFramescaperBuildLine('framescaper', 'latest'), /baseline or successor/u);
});
