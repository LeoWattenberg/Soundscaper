/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

const expectedHelpers = [
	['src/common/editor/audio-freeze-work-index.ts', 'editor-domain'],
	['src/common/editor/commands/source-command-work.ts', 'editor-controller-core'],
	['src/common/editor/commands/source-range-work.ts', 'editor-controller-core'],
	['src/common/editor/commands/track-mixer-work.ts', 'editor-controller-core'],
	['src/common/editor/engine/parallel-stack-effect-plan.ts', 'editor-parallel-stacks'],
	['src/common/editor/engine/parallel-stack-planning-index.ts', 'editor-parallel-stacks'],
	['src/common/editor/engine/scheduled-parameter-frame-projector.ts', 'editor-engine'],
	['src/common/editor/ui/clip-spreadsheet/SpreadsheetRow.tsx', 'editor-optional-surfaces'],
	['src/common/editor/ui/clip-spreadsheet/row-presentation.ts', 'editor-optional-surfaces'],
	['src/common/editor/ui/dialogs/take-comp-boundaries.ts', null],
	['src/common/editor/ui/dialogs/useAnalyzerLookup.ts', null],
	['src/common/editor/ui/dialogs/useGeneratorPresentation.ts', null],
	['src/common/editor/ui/inspector/useEffectPresentation.ts', null],
	['src/common/editor/ui/useCompressionCurve.ts', 'editor-effect-parameter-surfaces'],
	['src/common/editor/ui/useLegacyEffectGraphPresentation.ts', 'editor-effect-parameter-surfaces'],
	['src/common/editor/ui/workspace/RoutingGraphWires.tsx', 'editor-optional-surfaces'],
	['src/common/editor/ui/workspace/routing-graph-presentation.ts', 'editor-optional-surfaces'],
	['src/common/editor/ui/workspace/useRoutingHoverFrame.ts', 'editor-optional-surfaces'],
] as const;

test('round-four preparation helpers retain the semantic owners their production callers load', () => {
	assert.equal(expectedHelpers.length, 18);
	for (const [path, owner] of expectedHelpers) {
		assert.equal(chunkGroupForModulePath(path), owner, path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), owner, path);
		assert.equal(chunkGroupForModulePath('/checkout/' + path), owner, path);
	}
});

test('optional preparation ownership retains existing priorities, bounded chunks and nonrecursive dependencies', () => {
	for (const [name, priority] of [
		['editor-vamp-analyzer', 99],
		['editor-effect-parameter-surfaces', 98],
		['editor-optional-surfaces', 92],
	] as const) {
		const group = chunkGroups.find(candidate => candidate.name === name);
		assert.ok(group);
		assert.equal(group.priority, priority);
		assert.equal(group.maxSize, 400_000);
		assert.equal(group.includeDependenciesRecursively, false);
	}
});

test('preparation ownership does not absorb unrelated UI, similarly named modules or eager engine work', () => {
	for (const [path, owner] of [
		['src/common/editor/ui/useCompressionCurve-extra.ts', 'editor-shell'],
		['src/common/editor/ui/workspace/routing-graph-presentation-extra.ts', 'editor-shell'],
		['src/common/editor/ui/dialogs/useGeneratorPresentation-extra.ts', null],
		['src/common/editor/ui/dialogs/useAnalyzerLookup-extra.ts', null],
		['src/common/editor/ui/inspector/useEffectPresentation-extra.ts', null],
		['src/common/editor/engine/scheduled-parameter-registry.ts', 'editor-engine'],
		['src/common/editor/engine/parallel-stack-playback.ts', 'editor-engine'],
		['src/common/editor/ui/workspace/ProjectBinCard.jsx', 'editor-shell'],
	] as const) assert.equal(chunkGroupForModulePath(path), owner, path);
});
