/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ClosedDomainRecord } from '../closed-domain-value.ts';
import { normalizeVideoMaskMatteGraphV1OrV2, type VideoMaskMatteGraphV1OrV2 } from '../video-mask-matte-name-v2.ts';
import { IMAGE_DEVELOP_LIMITS_V1, type ImageDevelopGeometryV1, type ImageDevelopMaskBindingV1 } from './image-develop-contract-v1.ts';
import { normalizeImageDevelopEnvelopeV1 } from './image-develop-envelope-v1.ts';
import { array, compareText, field } from './image-develop-value.ts';

interface ImageDevelopEnvelopeV2 {
	readonly geometry: ImageDevelopGeometryV1;
	readonly masks: readonly VideoMaskMatteGraphV1OrV2[];
	readonly maskBindings: readonly ImageDevelopMaskBindingV1[];
}

/** Process2 alone admits named graphs. Geometry and binding rules remain V1-owned. */
export function normalizeImageDevelopEnvelopeV2(input: ClosedDomainRecord,
	effects: readonly Readonly<{ id: string }>[]): ImageDevelopEnvelopeV2 {
	const masks = array(field(input, 'masks'), 'photo masks', 0, IMAGE_DEVELOP_LIMITS_V1.maximumMasks)
		.map(normalizeVideoMaskMatteGraphV1OrV2).sort((left, right) => compareText(left.id, right.id));
	const computationalMasks = masks.map(graph => ({ schemaVersion: 1, id: graph.id, kind: graph.kind,
		inputs: graph.inputs, nodes: graph.nodes, outputNodeId: graph.outputNodeId }));
	const legacy = normalizeImageDevelopEnvelopeV1({ geometry: field(input, 'geometry'), masks: computationalMasks,
		maskBindings: field(input, 'maskBindings') }, effects);
	return Object.freeze({ ...legacy, masks: Object.freeze(masks) });
}
