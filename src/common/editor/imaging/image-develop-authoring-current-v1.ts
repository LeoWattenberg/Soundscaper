/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateThroughV4, normalizeImageDevelopStateV4 } from './image-develop-state-v4.ts';
import { normalizeImageDevelopStateThroughV3 } from './image-develop-state-through-v3.ts';
import { normalizeImageDevelopStateV3 } from './image-develop-state-v3.ts';

/** Metadata-only input to existing local editors. Pixel execution independently
 * requires the selected authenticated source; this projection grants none. */
export function prepareImageDevelopAuthoringCurrentV1(value: unknown) {
	const saved = normalizeImageDevelopStateThroughV4(value);
	return saved.processVersion !== 4 ? saved : normalizeImageDevelopStateV3({ processVersion: 3, effects: saved.effects,
		geometry: saved.geometry, masks: saved.masks, maskBindings: saved.maskBindings, repairs: saved.repairs });
}

/** Reattach the captured source-processing group after a local metadata edit.
 * Local editors cannot replace that group or discard existing repair state. */
export function retainImageDevelopRawDevelopmentCurrentV1(sourceValue: unknown, editedValue: unknown) {
	const source = normalizeImageDevelopStateThroughV4(sourceValue), edited = normalizeImageDevelopStateThroughV3(editedValue);
	if (source.processVersion !== 4) return edited;
	if (edited.processVersion !== 3) throw new RangeError('Current local editing must retain the complete repair recipe.');
	return normalizeImageDevelopStateV4({ ...edited, processVersion: 4, rawDevelopment: source.rawDevelopment });
}
