/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	assertOfxEffectStateV26,
	type OfxEffectStateV26,
} from './native-ofx-state-v26.ts';
import {
	requireUnifiedExactRenderIdentity,
	type UnifiedExactRenderIdentityIndex,
	type UnifiedExactRenderIdentityKind,
} from './unified-exact-render-identity-authority.ts';
import type { UnifiedExactRenderPlanSource } from './unified-exact-render-plan-v9.ts';

export interface UnifiedExactRenderOpenFxNode {
	readonly kind: 'openfx';
	readonly nodeId: string;
	readonly state: OfxEffectStateV26;
}

const NODE_FIELDS = Object.freeze(['kind', 'nodeId', 'state']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u;

export function normalizeUnifiedExactRenderOpenFxNode(
	value: unknown,
	projectIdentities: UnifiedExactRenderIdentityIndex,
	sourceById: ReadonlyMap<string, UnifiedExactRenderPlanSource>,
	outputFrameCount: number,
): UnifiedExactRenderOpenFxNode {
	const name = 'unified OpenFX render node';
	const node = readClosedDomainRecord(value, name, NODE_FIELDS);
	if (field(node, 'kind', name) !== 'openfx') throw new RangeError(`${name}.kind is unsupported.`);
	const stateValue = field(node, 'state', name);
	assertOfxEffectStateV26(stateValue);
	const state = stateValue;
	requireUnifiedExactRenderIdentity(
		projectIdentities, state.attachment.targetId,
		OFX_ATTACHMENT_KINDS[state.context], `OpenFX ${state.context} attachment target`,
	);
	for (const input of state.inputs) {
		requireUnifiedExactRenderIdentity(
			projectIdentities, input.sourceRef, OFX_INPUT_KINDS,
			`OpenFX named input ${input.name}`,
		);
	}
	if (state.frozenFallback !== null) {
		const source = sourceById.get(state.frozenFallback.externalMediaSourceId);
		if (!source || source.contentSha256 !== state.frozenFallback.renderedAssetSha256) {
			throw new ReferenceError('Unified OpenFX frozen fallback does not bind exact external media.');
		}
		if (state.frozenFallback.frameCount !== outputFrameCount) {
			throw new RangeError('Unified OpenFX frozen fallback does not bind the exact output frame count.');
		}
	}
	return Object.freeze({
		kind: 'openfx' as const,
		nodeId: stableId(field(node, 'nodeId', name), `${name}.nodeId`),
		state,
	});
}

const OFX_INPUT_KINDS: ReadonlySet<UnifiedExactRenderIdentityKind> = new Set([
	'source', 'generator-source', 'clip', 'transition', 'visual-model',
]);
const OFX_ATTACHMENT_KINDS: Readonly<Record<
	OfxEffectStateV26['context'],
	ReadonlySet<UnifiedExactRenderIdentityKind>
>> = Object.freeze({
	generator: new Set<UnifiedExactRenderIdentityKind>(['generator-source']),
	filter: new Set<UnifiedExactRenderIdentityKind>(['clip', 'video-effect', 'visual-model']),
	transition: new Set<UnifiedExactRenderIdentityKind>(['transition']),
	paint: new Set<UnifiedExactRenderIdentityKind>(['clip', 'video-effect', 'visual-model']),
	retimer: new Set<UnifiedExactRenderIdentityKind>(['clip']),
	general: new Set<UnifiedExactRenderIdentityKind>(['source', 'generator-source', 'clip', 'visual-model']),
});

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a canonical stable ID.`);
	return value;
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}
