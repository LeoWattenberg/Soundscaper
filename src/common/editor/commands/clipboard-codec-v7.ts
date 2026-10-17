/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoEffectsV2 } from '../video-effects-v2.ts';
import { normalizeVideoKeyframeCurvesV2 } from '../video-keyframe-curves-v2.ts';
import { collectAdmittedClipboardMediaSourceIdsCore, normalizeAudioEditorClipboardDescriptorCore, type AudioEditorClipboardV7 } from './clipboard-codec-core.ts';
export type { AudioEditorClipboardV7 } from './clipboard-codec-core.ts';
const OWNER = Object.freeze({ version: 7 as const, normalizeKeyframes: normalizeVideoKeyframeCurvesV2,
	normalizeEffects: normalizeVideoEffectsV2 });

/** Explicit current descriptor. Full resource envelopes are independently
 * admitted even when a clip has no keyframes; refs remain discrete context. */
export function normalizeAudioEditorClipboardDescriptorV7(value: unknown): AudioEditorClipboardV7 {
	const schema = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'schemaVersion') : undefined;
	if (!schema || !Object.hasOwn(schema, 'value') || schema.enumerable !== true || schema.value !== 7) {
		throw new RangeError('The current Frame clipboard requires descriptor V7.');
	}
	return normalizeAudioEditorClipboardDescriptorCore(value, OWNER);
}

/** Reuse the existing scalar source walk after complete current admission. */
export function collectAudioEditorClipboardSourceIdsV7(value: AudioEditorClipboardV7): readonly string[] {
	return collectAdmittedClipboardMediaSourceIdsCore(value, true);
}
