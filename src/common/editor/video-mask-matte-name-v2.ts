/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record, type ClosedDomainRecord } from './closed-domain-value.ts';
import { readCanonicalSafeVisualText } from './safe-visual-text.ts';
import { normalizeVideoMaskMatteGraphV1, type VideoMaskMatteGraphV1 } from './video-mask-matte-v24.ts';

/** Names are graph-local display metadata; IDs remain binding identities. */
export interface VideoMaskMatteGraphV2 extends Omit<VideoMaskMatteGraphV1, 'schemaVersion'> {
	readonly schemaVersion: 2;
	readonly name: string;
}
export type VideoMaskMatteGraphV1OrV2 = VideoMaskMatteGraphV1 | VideoMaskMatteGraphV2;

const FIELDS = Object.freeze(['schemaVersion', 'id', 'kind', 'inputs', 'nodes', 'outputNodeId', 'name']);
const TRIM = String.prototype.trim;
const NORMALIZE = String.prototype.normalize;
const CODE_UNIT = String.prototype.charCodeAt;

/** Successor admission delegates every computational field to the strict V1 owner. */
export function normalizeVideoMaskMatteGraphV2(value: unknown): VideoMaskMatteGraphV2 {
	const input = record(value, 'named video mask/matte graph', FIELDS);
	if (field(input, 'schemaVersion', 'named video mask/matte graph') !== 2) throw new RangeError('Named mask graph.schemaVersion must be 2.');
	const name = canonicalName(field(input, 'name', 'named video mask/matte graph'));
	const graph = normalizeVideoMaskMatteGraphV1(computationalFields(input));
	return Object.freeze({ ...graph, schemaVersion: 2, name });
}

/** Current owners opt into this dispatcher; V1 itself never gains a name field. */
export function normalizeVideoMaskMatteGraphV1OrV2(value: unknown): VideoMaskMatteGraphV1OrV2 {
	const input = record(value, 'video mask/matte graph version', FIELDS, ['schemaVersion']);
	const version = field(input, 'schemaVersion', 'video mask/matte graph version');
	if (version === 1) return normalizeVideoMaskMatteGraphV1(input);
	if (version === 2) return normalizeVideoMaskMatteGraphV2(input);
	throw new RangeError('Unsupported video mask/matte graph version.');
}

/** Rendering alone receives this view. Persistence and recipe hashes retain names. */
export function videoMaskMatteGraphComputationV1(value: unknown): VideoMaskMatteGraphV1 {
	return computation(normalizeVideoMaskMatteGraphV1OrV2(value));
}

/** An explicit author action canonicalizes raw text; blank clears only the name. */
export function renameVideoMaskMatteGraphV2(value: unknown, nameValue: unknown): VideoMaskMatteGraphV1OrV2 {
	const graph = normalizeVideoMaskMatteGraphV1OrV2(value);
	if (typeof nameValue !== 'string') throw new TypeError('A mask name requires primitive text.');
	const name = Reflect.apply(NORMALIZE, Reflect.apply(TRIM, nameValue, []), ['NFC']) as string;
	if (name === '') return computation(graph);
	return Object.freeze({ ...computation(graph), schemaVersion: 2, name: canonicalName(name) });
}

function computation(graph: VideoMaskMatteGraphV1OrV2): VideoMaskMatteGraphV1 {
	if (graph.schemaVersion === 1) return graph;
	return Object.freeze({ schemaVersion: 1, id: graph.id, kind: graph.kind, inputs: graph.inputs,
		nodes: graph.nodes, outputNodeId: graph.outputNodeId });
}

function computationalFields(input: ClosedDomainRecord) {
	const label = 'named video mask/matte graph';
	return { schemaVersion: 1, id: field(input, 'id', label), kind: field(input, 'kind', label),
		inputs: field(input, 'inputs', label), nodes: field(input, 'nodes', label), outputNodeId: field(input, 'outputNodeId', label) };
}

function canonicalName(value: unknown): string {
	const name = readCanonicalSafeVisualText(value, 'mask name', 256, false);
	if (Reflect.apply(TRIM, name, []) !== name || name === '') throw new TypeError('A mask name requires nonempty trimmed canonical text.');
	for (let index = 0; index < name.length; index++) {
		const unit = Reflect.apply(CODE_UNIT, name, [index]) as number;
		if (unit < 32 || unit >= 127 && unit <= 159) throw new TypeError('A mask name cannot contain control characters.');
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = Reflect.apply(CODE_UNIT, name, [index + 1]) as number;
			if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('A mask name cannot contain an unpaired surrogate.');
			index++;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError('A mask name cannot contain an unpaired surrogate.');
	}
	return name;
}
