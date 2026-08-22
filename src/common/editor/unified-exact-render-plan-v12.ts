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
	projectIdentities: ReadonlySet<string>,
	sourceById: ReadonlyMap<string, UnifiedExactRenderPlanSource>,
	outputFrameCount: number,
): UnifiedExactRenderOpenFxNode {
	const name = 'unified OpenFX render node';
	const node = readClosedDomainRecord(value, name, NODE_FIELDS);
	if (field(node, 'kind', name) !== 'openfx') throw new RangeError(`${name}.kind is unsupported.`);
	const stateValue = field(node, 'state', name);
	assertOfxEffectStateV26(stateValue);
	const state = stateValue;
	if (!projectIdentities.has(state.attachment.targetId)) {
		throw new ReferenceError('Unified OpenFX attachment target is not in the exact render graph.');
	}
	for (const input of state.inputs) {
		if (!projectIdentities.has(input.sourceRef)) {
			throw new ReferenceError('Unified OpenFX named input is not in the exact render graph.');
		}
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

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a canonical stable ID.`);
	return value;
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}
