/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	normalizeNativeMediaImageSequenceSourceV25,
	type NativeMediaImageSequenceSourceV25,
} from './native-media-image-sequence-v25.ts';
import { canonicalizeNativeMediaSummaryValue } from './native-media-plan-canonical-form.ts';
import {
	normalizeVideoProxyAttachmentV18,
	type VideoProxyAttachmentV18,
} from './video-proxy-attachment-v18.ts';
import {
	normalizeVideoSourceCharacteristicsV25,
	type VideoSourceCharacteristicsV25,
} from './video-source-professional-characteristics-v25.ts';
import type { UnifiedExactRenderPlanSource } from './unified-exact-render-plan-v9.ts';

export interface UnifiedExactRenderProfessionalMediaNode {
	readonly kind: 'professional-media';
	readonly nodeId: string;
	readonly sourceNodeId: string;
	readonly characteristics: VideoSourceCharacteristicsV25;
	readonly imageSequence: NativeMediaImageSequenceSourceV25 | null;
	readonly proxyAttachment: Readonly<VideoProxyAttachmentV18> | null;
	readonly exportAuthority: 'original';
}

const NODE_FIELDS = Object.freeze([
	'kind', 'nodeId', 'sourceNodeId', 'characteristics', 'imageSequence',
	'proxyAttachment', 'exportAuthority',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u;

export function normalizeUnifiedExactRenderProfessionalNode(
	value: unknown,
	sourceByNodeId: ReadonlyMap<string, UnifiedExactRenderPlanSource>,
): UnifiedExactRenderProfessionalMediaNode {
	const name = 'unified professional-media render node';
	const node = readClosedDomainRecord(value, name, NODE_FIELDS);
	if (field(node, 'kind', name) !== 'professional-media') {
		throw new RangeError(`${name}.kind is unsupported.`);
	}
	const sourceNodeId = stableId(field(node, 'sourceNodeId', name), `${name}.sourceNodeId`);
	const source = sourceByNodeId.get(sourceNodeId);
	if (!source) throw new ReferenceError('Unified professional media references an unknown source node.');
	const rawImageSequence = field(node, 'imageSequence', name);
	const imageSequence = rawImageSequence === null
		? null
		: normalizeNativeMediaImageSequenceSourceV25(rawImageSequence);
	const rate = imageSequence?.frameRate ?? (source.timing.kind === 'cfr' ? source.timing.rate : undefined);
	const characteristics = normalizeVideoSourceCharacteristicsV25(
		field(node, 'characteristics', name),
		rate === undefined ? {} : { rate },
	);
	if (imageSequence !== null) {
		if (imageSequence.id !== source.sourceId
			|| imageSequence.sourcePack.storageKey !== source.storageKey
			|| imageSequence.sourcePack.sha256 !== source.contentSha256
			|| imageSequence.frameCount !== timingFrameCount(source)
			|| source.timing.kind !== 'cfr'
			|| !sameRate(imageSequence.frameRate, source.timing.rate)
			|| canonicalizeNativeMediaSummaryValue(imageSequence.characteristics)
				!== canonicalizeNativeMediaSummaryValue(characteristics)) {
			throw new RangeError('Unified image-sequence authority disagrees with its source, timing, or characteristics.');
		}
	}
	const rawProxy = field(node, 'proxyAttachment', name);
	const proxyAttachment = rawProxy === null ? null : normalizeVideoProxyAttachmentV18(rawProxy);
	if (proxyAttachment !== null) {
		if (proxyAttachment.originalSha256 !== source.contentSha256
			|| proxyAttachment.recipeId !== 'framescaper-native-prores-proxy-mov-v1'
			|| proxyAttachment.recipeVersion !== 1
			|| proxyAttachment.mimeType !== 'video/quicktime') {
			throw new RangeError('Unified proxy authority is not the exact ProRes Proxy/MOV original relationship.');
		}
	}
	if (field(node, 'exportAuthority', name) !== 'original') {
		throw new RangeError('Unified professional media export authority must remain the original.');
	}
	return Object.freeze({
		kind: 'professional-media' as const,
		nodeId: stableId(field(node, 'nodeId', name), `${name}.nodeId`),
		sourceNodeId,
		characteristics,
		imageSequence,
		proxyAttachment,
		exportAuthority: 'original' as const,
	});
}

function timingFrameCount(source: UnifiedExactRenderPlanSource): number {
	return source.timing.kind === 'cfr' ? source.timing.frameCount : source.timing.reference.frameCount;
}

function sameRate(
	left: Readonly<{ readonly num: number; readonly den: number }>,
	right: Readonly<{ readonly num: number; readonly den: number }>,
): boolean {
	return left.num === right.num && left.den === right.den;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a canonical stable ID.`);
	return value;
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}
