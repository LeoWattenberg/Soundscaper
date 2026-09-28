/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { runDirectWavRendererSmoke } from '../desktop/direct-wav-renderer-smoke.js';
import { createRendererScope } from './helpers/desktop-direct-wav-renderer-scope.js';

const PLAN = Object.freeze({
	schemaVersion: 1,
	mode: 'direct-wav-export-v1',
	productId: 'soundscaper',
	token: '0123456789abcdef0123456789abcdef',
});

test('packaged BW64 import waits for the new project to finish activation', async () => {
	const scope = createRendererScope({ projectActivationDelayTicks: 3 });
	const serializedRoutine = Function(`"use strict"; return (${runDirectWavRendererSmoke.toString()});`)();
	const result = await serializedRoutine(scope, PLAN);
	assert.equal(result.bw64Completed, true);
	assert.equal(scope.document.fixture.importedFiles.length, 2);
});
