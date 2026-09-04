/* SPDX-License-Identifier: AGPL-3.0-only */

// Small shared helpers for reading and rebuilding Audacity effect XML: laying
// generated attributes back over the imported ones in their original order,
// reading a boolean attribute, and deep-copying an opaque subtree. Split out of
// aup4-effects.js so its two halves can share them; no behaviour changes here.

import { audacityXmlAttribute } from './audacity-binary-xml.js';
import { booleanValue } from './audacity-command-parameters.js';

export function mergeAttributes(generated, opaqueContent) {
	const byName = new Map(generated.map((entry) => [entry.name, entry]));
	const used = new Set();
	const output = [];
	for (const entry of opaqueContent || []) {
		if (entry.kind !== 'attribute') continue;
		const replacement = byName.get(entry.name);
		if (replacement && !used.has(entry.name)) {
			output.push(replacement);
			used.add(entry.name);
		} else if (!replacement) output.push(cloneEntry(entry));
	}
	for (const entry of generated) if (!used.has(entry.name)) output.push(entry);
	return output;
}

export function booleanAttribute(node, name, fallback) {
	const value = audacityXmlAttribute(node, name, fallback);
	const parsed = booleanValue(value);
	return parsed === undefined ? fallback : parsed;
}

export function isPlainObject(value) {
	if (!value || typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

export function cloneNode(node) {
	return {
		name: node.name,
		content: (node.content || []).map(cloneEntry),
	};
}

export function cloneEntry(entry) {
	if (entry.kind === 'node') return { kind: 'node', node: cloneNode(entry.node) };
	if (entry.value instanceof Uint8Array) return { ...entry, value: entry.value.slice() };
	return { ...entry };
}
