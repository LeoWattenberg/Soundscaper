/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { framescaperOpenFxTransitionProgressNativeMedia } from
	'../src/framescaper/editor-openfx-frame-timing-native-media.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

test('OpenFX transition progress uses point-rounded NTSC output frame samples', () => {
	const rate = Object.freeze({ num: 30_000, den: 1_001 });
	const base = unifiedExactPlanFixture(14);
	const nodes = base.nodes.map((node) => node.kind !== 'transition' ? node : ({
		...node,
		edges: {
			...node.edges,
			outgoing: { ...node.edges.outgoing, sequenceRate: rate },
			incoming: { ...node.edges.incoming, sequenceRate: rate },
		},
	}));
	const plan = {
		...base,
		timebase: {
			...base.timebase, sampleRate: 48_000, sampleDuration: 16_016, sequenceRate: rate,
		},
		output: { ...base.output, frameRate: rate },
		nodes,
	};
	assert.equal(
		framescaperOpenFxTransitionProgressNativeMedia(plan as never, 'transition-1', 6),
		0.5,
	);
});
