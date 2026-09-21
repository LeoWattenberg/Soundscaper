/* SPDX-License-Identifier: AGPL-3.0-only */

/** One platform target/profile admission for native report seed and closure. */

import type { NativeMediaV14EncodeProfileId } from '../common/editor/native-media-v14-native-dispatch.ts';
import {
	findPlatformDeliveryPreset,
	type PlatformNativeMediaV15Execution,
} from '../common/editor/platform-delivery-presets.ts';

export function nativeDeliveryTargetExecution(
	targetId: string,
	profileId: NativeMediaV14EncodeProfileId,
): PlatformNativeMediaV15Execution {
	const preset = findPlatformDeliveryPreset(targetId);
	if (!preset) throw new RangeError(`Native delivery report target ${targetId} is not in the platform catalog.`);
	if (preset.execution.kind !== 'native-media-v15') {
		throw new RangeError(`Platform delivery target ${targetId} is not a native-media-v15 target.`);
	}
	if (preset.execution.profileId !== profileId) {
		throw new RangeError(
			`Platform delivery target ${targetId} does not select exact profile ${profileId}.`,
		);
	}
	return preset.execution;
}
