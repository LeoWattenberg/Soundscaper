/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { FOUNDATION_RUNTIME_CONSUMER_SURFACES } from '../src/common/editor/foundation-runtime-consumer-audit.ts';

test('contextual item movement owns its musical geometry projection', () => {
	assert.deepEqual(FOUNDATION_RUNTIME_CONSUMER_SURFACES.find(({ id }) => id === 'contextual-item-musical-geometry'), {
		id: 'contextual-item-musical-geometry', surface: 'navigation',
		file: 'src/common/editor/audacity-shortcut-actions/item-navigation-geometry.ts',
		entryPoint: 'projectedItemClipGeometry', inputIdentifier: 'project', projectedIdentifier: null,
		boundary: 'resolveRuntimeClipProjection',
		evidence: 'Contextual item movement resolves musical clip placement at the current tempo before issuing sample-domain edits; native visuals separately convert their owning sequence boundaries and retain source animation phase.',
	});
});

test('adjacent related-clip selection owns its aggregate timing projection', () => {
	assert.deepEqual(FOUNDATION_RUNTIME_CONSUMER_SURFACES.find(({ id }) => id === 'related-clip-adjacent-selection'), {
		id: 'related-clip-adjacent-selection', surface: 'navigation',
		file: 'src/common/editor/controller/track-audio/internal/clip-selection-navigation-service.ts',
		entryPoint: 'exactClipSelectionCommand', inputIdentifier: 'project', projectedIdentifier: 'range',
		boundary: 'clipContentRange',
		evidence: 'Adjacent clip selection expands authored relationships and resolves their current clip boundaries before publishing the aggregate exact range and owner tracks.',
	});
});

test('selected track content owns its musical projection and native sequence boundary', () => {
	assert.deepEqual(FOUNDATION_RUNTIME_CONSUMER_SURFACES.find(({ id }) => id === 'selected-track-musical-content-range'), {
		id: 'selected-track-musical-content-range', surface: 'navigation',
		file: 'src/common/editor/clip-content-range.ts',
		entryPoint: 'projectedClipContentRange', inputIdentifier: 'project', projectedIdentifier: 'resolved',
		boundary: 'resolveRuntimeClipProjection',
		evidence: 'Selected track content resolves musical clip intervals before reading sample endpoints; native visual intervals retain their authored sequence clock through the existing sequence-boundary converter.',
	});
});
