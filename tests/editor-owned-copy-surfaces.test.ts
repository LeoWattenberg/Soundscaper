/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { resolveSoundscaperRoutingGraphCopy } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { layoutSoundscaperRoutingGraph } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-layout.ts';
import { createFramescaperSelectedVisualAuthoringModel } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';

test('computed proxy phases and selected authoring surfaces have canonical copy identities', () => {
	assert.equal(EDITOR_ENGLISH_COPY['ui.videoProxy.videoProxyPhaseGenerating'], 'Generating proxy');
	assert.equal(EDITOR_ENGLISH_COPY['ui.selectedVisualAuthoring.captureFrame'], 'Capture authenticated rendered frame');
	const model = createFramescaperSelectedVisualAuthoringModel({
		surface: 'video-freeze', selectedClipId: null, playheadSample: 0,
		project: { schemaFamily: 'framescaper', schemaVersion: 1, id: 'p', revision: 0,
			primarySequenceId: 's', sequences: [{ id: 's', rate: { num: 24, den: 1 } }],
			clips: [], tracks: [], sources: [], selection: {}, sampleRate: 48_000,
			videoVisualPresets: [], videoFinishingPresets: [], videoFreezeFallbacks: [] },
		copy: { 'ui.selectedVisualAuthoring.surfaces.video-freeze.title': 'Bild einfrieren' },
	});
	assert.equal(model.title, 'Bild einfrieren');
});

test('routing layout presentation uses translated type and count wording without changing topology', () => {
	const graph: MixerGraphV21 = { schemaVersion: 1, groups: [], sends: [], cues: [], outputs: [], vcas: [], edges: [] };
	const project = { tracks: [{ id: 'voice', type: 'audio', name: 'Voice' }], masterChannels: 2 };
	const original = layoutSoundscaperRoutingGraph(project, graph);
	const translated = layoutSoundscaperRoutingGraph(project, graph, resolveSoundscaperRoutingGraphCopy({
		'ui.routing.track': 'Spur', 'ui.routing.master': 'Master übersetzt',
	}));
	assert.equal(translated.nodes.find(node => node.kind === 'track')?.detail, 'Spur');
	assert.equal(translated.nodes.find(node => node.kind === 'master')?.label, 'Master übersetzt');
	assert.deepEqual(translated.nodes.map(({ key, x, y, channelCount }) => ({ key, x, y, channelCount })),
		original.nodes.map(({ key, x, y, channelCount }) => ({ key, x, y, channelCount })));
});
