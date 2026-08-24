/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoSourceCharacteristics,
	type VideoSourceCharacteristics,
	type VideoSourceCharacteristicsOptions,
} from './video-source-characteristics.ts';
import { normalizeVideoSourceCharacteristicsV25 } from './video-source-professional-characteristics-v25.ts';

const PROFESSIONAL_KEYS = Object.freeze([
	'bitDepth', 'pixelFormat', 'chromaFormat', 'alphaMode', 'alphaInterpretation',
]);
const PROFESSIONAL_COLOUR_KEYS = Object.freeze(['masteringDisplay', 'contentLight']);

/** Read either the historical closed record or V25's closed in-place extension. */
export function normalizeVideoSourceCharacteristicsForConsumer(
	value: unknown,
	options: VideoSourceCharacteristicsOptions = {},
): VideoSourceCharacteristics {
	return carriesProfessionalCharacteristics(value)
		? normalizeVideoSourceCharacteristicsV25(value, options)
		: normalizeVideoSourceCharacteristics(value, options);
}

function carriesProfessionalCharacteristics(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as Readonly<Record<string, unknown>>;
	if (PROFESSIONAL_KEYS.some((key) => Object.hasOwn(candidate, key))) return true;
	const colour = candidate.colour;
	return Boolean(colour && typeof colour === 'object' && !Array.isArray(colour)
		&& PROFESSIONAL_COLOUR_KEYS.some((key) => Object.hasOwn(colour, key)));
}
