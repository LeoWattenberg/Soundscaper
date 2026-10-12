/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateCurrentV1 } from '../../../common/editor/imaging/image-develop-state-current-v1.ts';
import { normalizeBrushMaskResourceReferenceV1 } from '../../../common/editor/imaging/brush-mask-resource-v1.ts';

/** An owning Current normalizer has already detached this recipe. Selected
 * native settings have only the immutable brush body namespace, including
 * unused declarations; this scalar admission grants no byte capability. */
export function assertPhotoDevelopSelectedMaskInputsCurrentV1(develop: Readonly<ImageDevelopStateCurrentV1>): void {
	for (const graph of develop.masks) for (const input of graph.inputs) normalizeBrushMaskResourceReferenceV1(input.sourceRef);
}
