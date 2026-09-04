/* SPDX-License-Identifier: AGPL-3.0-only */

// Keeping the parts of an imported Audacity document the browser does not
// model. Every node and attribute Soundscaper does not understand is copied
// aside so that saving the project back writes it out in its original position
// rather than dropping it. Split out of aup4-conversion.js; no behaviour
// changes here.

import { cloneAup4OpaqueProjectValue as cloneOpaqueValue } from './aup4-opaque-persistence.ts';

export function opaqueNode(node) { return node ? { kind: 'node', node: cloneOpaqueValue(node) } : null; }
export function opaqueWaveTrackNode(node) {
	if (!node) return null;
	return {
		kind: 'node',
		node: {
			...node,
			content: (node.content || []).map((entry) => (
				entry?.kind === 'node' && entry.node?.name === 'waveclip'
					? { kind: 'node', node: { name: 'waveclip', content: [] } }
					: cloneOpaqueEntryWithoutWaveClips(entry)
			)),
		},
	};
}
export function opaqueWaveClipNode(node) {
	if (!node) return null;
	return {
		kind: 'node',
		node: {
			...node,
			content: (node.content || [])
				.map(cloneOpaqueEntryWithoutWaveClips)
				.filter(Boolean),
		},
	};
}
export function opaqueRootTemplate(root, masterEffectsNode) {
	return {
		kind: 'node',
		node: {
			name: 'project',
			content: (root.content || [])
				.filter((entry) => entry.kind !== 'attribute')
				.map((entry) => {
					if (entry?.kind !== 'node') return cloneOpaqueValue(entry);
					if (entry.node === masterEffectsNode) return { kind: 'node', node: { name: 'effects', content: [] } };
					if (entry.node?.name === 'wavetrack' || entry.node?.name === 'labeltrack') {
						return { kind: 'node', node: { name: entry.node.name, content: [] } };
					}
					return cloneOpaqueEntryWithoutWaveClips(entry);
				})
				.filter(Boolean),
		},
	};
}
export function findNodeContentIndex(parent, node) {
	if (!node) return -1;
	return (parent.content || [])
		.filter((entry) => entry.kind !== 'attribute')
		.findIndex((entry) => entry.kind === 'node' && entry.node === node);
}
function cloneOpaqueEntryWithoutWaveClips(entry) {
	if (entry?.kind !== 'node') return cloneOpaqueValue(entry);
	if (entry.node?.name === 'waveclip') return null;
	return {
		kind: 'node',
		node: {
			...entry.node,
			content: (entry.node.content || [])
				.map(cloneOpaqueEntryWithoutWaveClips)
				.filter(Boolean),
		},
	};
}
