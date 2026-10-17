/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeImageDevelopStateThroughV4 } from './image-develop-state-v4.ts';
import { prepareImageDevelopRawSourceCurrentV1 } from './image-develop-raw-source-current-v1.ts';
import { prepareImageDevelopMaskOverlaySelectionV1 } from './image-develop-mask-overlay-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';

/** Capture the complete saved recipe, then authorize its actual source before
 * any sampling or adjustment. Only this ephemeral request loses the RAW slot;
 * the saved recipe and its Original binding retain their exact identities. */
export function captureImageDevelopRawRequestCurrentV1(value: unknown) {
	const signalField = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('Current Develop signal must be own data.');
	const signal = captureRepairSignalV1(signalField?.value), check = () => { checkRepairSignalV1(signal); };
	check();
	try {
		const input = record(value, 'Current RAW Develop', ['frame', 'develop', 'signal', 'maskOverlay'], ['frame', 'develop']);
		const saved = normalizeImageDevelopStateThroughV4(field(input, 'develop', 'Current RAW Develop'));
		const rawSelection = Object.hasOwn(input, 'maskOverlay') ? field(input, 'maskOverlay', 'Current RAW Develop') : undefined;
		const selection = rawSelection === undefined ? undefined : prepareImageDevelopMaskOverlaySelectionV1(rawSelection);
		const frame = field(input, 'frame', 'Current RAW Develop');
		const develop = prepareImageDevelopRawSourceCurrentV1(saved, frame);
		check(); return Object.freeze({ frame, develop, ...(signal ? { signal } : {}), ...(selection ? { maskOverlay: selection } : {}) });
	} catch (error) { check(); throw error; }
}
