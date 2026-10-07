/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDefaultMixerGraphV21, normalizeMixerGraphV21 } from '../../src/common/editor/mixer-graph-v21.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';

export function mixerSurfaceFixture(count = 30) {
	const strip = (id: string) => ({ id, name: id, color: '', collapsed: false, gain: 1, pan: 0, mute: false,
		solo: false, effectsActive: true, effects: [], channelCount: 2 });
	const groups = Array.from({ length: count }, (_, index) => strip(`group-${String(index)}`));
	const sends = Array.from({ length: count }, (_, index) => strip(`send-${String(index)}`));
	const base = createDefaultMixerGraphV21([{ id: 'track', channelCount: 2 }], 2);
	const mixer = normalizeMixerGraphV21({ ...base, groups, sends, edges: [...base.edges,
		...[...groups, ...sends].map(node => ({ id: `assignment:mixer-node:${node.id}:master`, kind: 'assignment',
			source: { kind: 'mixer-node', id: node.id }, destination: { kind: 'master' }, position: 'post-fader',
			level: 1, enabled: true, channelMap: [0, 1] }))] });
	return createSoundscaperProject({ id: 'round4-mixer-surface', now: '2026-10-07T00:00:00.000Z',
		tracks: [{ id: 'track', type: 'audio', name: 'Track' }], mixer });
}
