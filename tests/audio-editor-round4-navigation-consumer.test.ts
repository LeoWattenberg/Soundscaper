/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { FOUNDATION_RUNTIME_CONSUMER_SURFACES } from '../src/common/editor/foundation-runtime-consumer-audit.ts';

test('adjacent related-clip selection owns its aggregate timing projection', () => {
	assert.deepEqual(FOUNDATION_RUNTIME_CONSUMER_SURFACES.find(({ id }) => id === 'related-clip-adjacent-selection'), {
		id: 'related-clip-adjacent-selection', surface: 'navigation',
		file: 'src/common/editor/controller/track-audio/internal/clip-selection-navigation-service.ts',
		entryPoint: 'exactClipSelectionCommand', inputIdentifier: 'project', projectedIdentifier: 'projection',
		boundary: 'resolveRuntimeProjectProjection',
		evidence: 'Adjacent clip selection expands authored relationships and resolves their current clip boundaries before publishing the aggregate exact range and owner tracks.',
	});
});
