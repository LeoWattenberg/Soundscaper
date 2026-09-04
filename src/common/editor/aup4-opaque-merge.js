/* SPDX-License-Identifier: AGPL-3.0-only */

// How a generated Audacity document is laid back over the one that was
// imported. An AUP4 project Soundscaper reopens carries attributes and child
// nodes it does not model; these helpers keep each of them in the position the
// original file had it, replace only what the editor regenerates, and drop the
// opaque subtree of anything the user deleted. Split out of aup4-profile.js;
// no behaviour changes here.

import { createAudacityXmlNode } from './audacity-binary-xml.js';
import { rehydrateAup4OpaqueInt64Attribute } from './aup4-opaque-persistence.ts';

// A generated child that claims this key removes the opaque node it matched
// instead of keeping it, which is how a nested wave clip Audacity 4 no longer
// supports is dropped rather than resurrected.
export const OMIT_OPAQUE_CHILD = Symbol('omit opaque AUP4 child');

export function attribute(name, type, value, digits) {
	return { kind: 'attribute', name, type, value, ...(digits == null ? {} : { digits }) };
}

export function mergeAttributes(generated, opaqueContent) {
	const generatedByName = new Map();
	for (let index = 0; index < generated.length; index += 1) {
		const entry = generated[index];
		const indexes = generatedByName.get(entry.name) || [];
		indexes.push(index);
		generatedByName.set(entry.name, indexes);
	}
	const consumed = new Set();
	const output = [];
	for (const entry of opaqueContent || []) {
		if (entry?.kind !== 'attribute') continue;
		const indexes = generatedByName.get(entry.name);
		if (!indexes) {
			output.push(cloneXmlEntry(entry));
			continue;
		}
		const replacement = indexes.find((index) => !consumed.has(index));
		if (replacement == null) continue;
		consumed.add(replacement);
		output.push(generated[replacement]);
	}
	for (let index = 0; index < generated.length; index += 1) {
		if (!consumed.has(index)) output.push(generated[index]);
	}
	return output;
}

function appendOpaqueChildren(content, opaqueNode, excludedNames = new Set()) {
	for (const entry of opaqueNode?.content || []) {
		if (entry?.kind === 'attribute') continue;
		if (entry?.kind === 'node' && excludedNames.has(entry.node?.name)) continue;
		content.push(cloneXmlEntry(entry));
	}
}

export function mergeOpaqueChildren(opaqueNode, generated, keyForOpaque) {
	const descriptors = generated || [];
	if (!opaqueNode) return descriptors.map((descriptor) => descriptor.entry);
	const queues = new Map();
	for (const descriptor of descriptors) {
		const queue = queues.get(descriptor.key) || [];
		queue.push(descriptor);
		queues.set(descriptor.key, queue);
	}
	const consumed = new Set();
	const output = [];
	for (const [index, entry] of (opaqueNode.content || []).entries()) {
		if (entry?.kind === 'attribute') continue;
		const key = keyForOpaque(entry, index);
		if (key === OMIT_OPAQUE_CHILD) continue;
		if (key != null) {
			const descriptor = queues.get(key)?.shift();
			if (descriptor) {
				consumed.add(descriptor);
				output.push(descriptor.entry);
			}
			// A modeled child which no longer has a generated counterpart was
			// deleted. Never resurrect its stale opaque subtree.
			continue;
		}
		output.push(cloneXmlEntry(entry));
	}
	for (const descriptor of descriptors) {
		if (!consumed.has(descriptor)) output.push(descriptor.entry);
	}
	return output;
}

export function opaqueChildren(node) {
	const output = [];
	appendOpaqueChildren(output, node);
	return output;
}

export function cloneXmlEntry(entry) {
	const int64 = rehydrateAup4OpaqueInt64Attribute(entry);
	if (int64) return int64;
	if (typeof structuredClone === 'function') return structuredClone(entry);
	if (entry?.value instanceof Uint8Array) return { ...entry, value: entry.value.slice() };
	if (entry?.kind === 'node') return { kind: 'node', node: createAudacityXmlNode(entry.node.name, [], (entry.node.content || []).map(cloneXmlEntry)) };
	return { ...entry };
}

export function stripUnsupportedNestedWaveClips(root) {
	const visit = (node, directProjectWaveTrack = false) => ({
		...node,
		content: (node.content || []).flatMap((entry) => {
			if (entry?.kind !== 'node') return [cloneXmlEntry(entry)];
			if (entry.node?.name === 'waveclip') {
				return directProjectWaveTrack ? [{
					kind: 'node',
					node: visit(entry.node, false),
				}] : [];
			}
			return [{
				kind: 'node',
				node: visit(entry.node, node.name === 'project' && entry.node?.name === 'wavetrack'),
			}];
		}),
	});
	return visit(root);
}

