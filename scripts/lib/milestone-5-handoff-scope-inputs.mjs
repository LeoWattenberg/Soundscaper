/* SPDX-License-Identifier: AGPL-3.0-only */

/** Product-scoped checked-input inventory for Milestone 5 handoff cells. */

import { MILESTONE_5_HANDOFF_INPUT_PATHS } from './milestone-5-handoff.mjs';
import {
	MILESTONE_5_NATIVE_DELEGATED_SOURCE_PATHS,
} from './milestone-5-native-source-acquisitions.mjs';

const PAYLOAD_KEYS = new Set([
	'nativeAddonPayload', 'soundscaperProfessionalPayload', 'mediaHostPayload', 'openFxHostPayload',
]);

export function milestone5RequiredHandoffInputPaths(engineeringScope) {
	const selectedPayloadKeys = new Set(engineeringScope.payloadInputKeys);
	return [
		...Object.entries(MILESTONE_5_HANDOFF_INPUT_PATHS)
			.filter(([key]) => !PAYLOAD_KEYS.has(key) || selectedPayloadKeys.has(key))
			.map(([, path]) => path),
		...(engineeringScope.includeDelegatedSources ? MILESTONE_5_NATIVE_DELEGATED_SOURCE_PATHS : []),
	];
}
