/* SPDX-License-Identifier: AGPL-3.0-only */

import { booleanValue } from './aup4-conversion-values.js';
import {
	AUP4_REALTIME_EFFECT_PROFILES,
	aup4NativeEffectId,
	realtimeEffectTypeForNativeId,
} from './aup4-effect-profiles.js';
import { parseNativeEffectId } from './aup4-browser-effect-payload.js';
import { createMissingEffect } from './effects.js';

import type { Aup3XmlNode, Aup3XmlOmission } from './aup3-profile.ts';

// Audacity 3.7.9 exposes realtime racks, but only these built-ins override the
// default `RealtimeSince::Never` capability at the pinned upstream revision.
const AUP3_REALTIME_EFFECT_TYPES = new Set([
	'audacity-bass-treble',
	'audacity-compressor',
	'audacity-distortion',
	'audacity-limiter',
	'audacity-phaser',
	'audacity-reverb',
	'audacity-wahwah',
]);

export function projectAup3EffectState(project: unknown): Readonly<{
	project: unknown;
	omissions: readonly Aup3XmlOmission[];
}> {
	const source = recordValue(project);
	if (!source) return { project, omissions: [] };
	const omissions: Aup3XmlOmission[] = [];
	let changed = false;
	const tracks = Array.isArray(source.tracks) ? source.tracks.map((value, index) => {
		const track = recordValue(value);
		if (!track) return value;
		const projected = projectEffectRack(track, index);
		changed ||= projected !== track;
		return projected;
	}) : source.tracks;
	const master = recordValue(source.master);
	const projectedMaster = master
		? projectEffectRack(master, 'master')
		: source.master;
	changed ||= projectedMaster !== source.master;
	return {
		project: changed ? { ...source, tracks, master: projectedMaster } : project,
		omissions,
	};
}

export function aup3EffectOmission(
	node: Aup3XmlNode,
	path: string,
	rackActive: boolean,
): Aup3XmlOmission | null {
	const nativeId = String(attributeValue(node, 'id') ?? '');
	const type = realtimeEffectTypeForNativeId(nativeId);
	const active = rackActive && booleanValue(attributeValue(node, 'active'), true);
	const blobState = nestedBlobState(node);
	if (blobState.present) return {
		kind: 'node',
		name: AUP4_REALTIME_EFFECT_PROFILES[type ?? '']?.symbol
			?? parseNativeEffectId(nativeId)?.name
			?? (nativeId || 'effect'),
		path,
		reason: 'unsupported-aup3-effect-binary-state',
		byteLength: blobState.byteLength,
		active,
		...(nativeId ? { nativeId } : {}),
		...(type ? { type } : {}),
	};
	if (!type || AUP3_REALTIME_EFFECT_TYPES.has(type)) return null;
	return {
		kind: 'node',
		name: AUP4_REALTIME_EFFECT_PROFILES[type]?.symbol ?? type,
		path,
		reason: 'unsupported-aup3-realtime-effect',
		active,
		nativeId,
		type,
	};
}

function nestedBlobState(node: Aup3XmlNode): Readonly<{ present: boolean; byteLength: number }> {
	let present = false;
	let byteLength = 0;
	for (const entry of node.content) {
		if (entry.kind === 'blob') {
			present = true;
			byteLength += entry.value.byteLength;
		}
		if (entry.kind === 'node') {
			const child = nestedBlobState(entry.node);
			present ||= child.present;
			byteLength += child.byteLength;
		}
	}
	return { present, byteLength };
}

function attributeValue(node: Aup3XmlNode, name: string): unknown {
	for (let index = node.content.length - 1; index >= 0; index -= 1) {
		const entry = node.content[index];
		if (entry?.kind === 'attribute' && entry.name === name) return entry.value;
	}
	return undefined;
}

function projectEffectRack(
	owner: Record<string, unknown>,
	ownerIndex: number | 'master',
): Record<string, unknown> {
	if (!Array.isArray(owner.effects)) return owner;
	let changed = false;
	const effects = owner.effects.map((value, index) => {
		const effect = recordValue(value);
		const opaque = recordValue(effect?.opaqueAudacityNode);
		const node = opaque?.kind === 'node' ? recordValue(opaque.node) as Aup3XmlNode | null : null;
		if (!effect || !node || !Array.isArray(node.content)) return value;
		const blobState = nestedBlobState(node);
		if (!blobState.present) return value;
		changed = true;
		const type = String(effect.type ?? '');
		const missing = recordValue(effect.missing);
		const nativeId = String(
			attributeValue(node, 'id') ?? missing?.nativeId ?? aup4NativeEffectId(type) ?? '',
		);
		// Keep a generated slot for every modeled effect so mergeRackChildren can
		// still align later effects around malformed opaque-only rack entries. A
		// missing placeholder clones the exact native node; the AUP3 tree rewrite
		// then omits that whole node when it sees the blob and reports it once.
		return createMissingEffect({
			id: typeof effect.id === 'string' && effect.id
				? effect.id : `aup3-opaque-${String(ownerIndex)}-${String(index)}`,
			enabled: booleanValue(effect.enabled, true),
			missing: {
				name: String(
					missing?.name
						?? AUP4_REALTIME_EFFECT_PROFILES[type]?.symbol
						?? parseNativeEffectId(nativeId)?.name
						?? (nativeId || type || 'effect')
				),
				nativeId: nativeId || 'Effect_Soundscaper_Soundscaper_Omitted_AUP3 projection',
				reason: 'unsupported-state',
				source: 'aup4',
			},
			opaqueAudacityNode: {
				kind: 'node',
				node: node.name === 'effect' ? node : { ...node, name: 'effect' },
			},
		});
	});
	return changed ? { ...owner, effects } : owner;
}

function recordValue(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}
