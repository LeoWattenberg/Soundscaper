/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createNativeMediaCapabilitySnapshotV1,
} from '../../src/common/editor/native-media-capability-snapshot.ts';

export function nativeServicesSnapshot(enabled = true) {
	return Object.freeze({
		snapshotVersion: 1 as const,
		runtimeAvailable: true,
		nativeMediaEnabled: enabled,
		queue: Object.freeze([]),
		roots: Object.freeze([]),
		watchRules: Object.freeze([]),
	});
}

export function nativeWatchCapabilitySnapshot(
	masterEnabled = true,
	userEnabled = masterEnabled,
) {
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled,
		entries: [{
			domain: 'watch', id: 'watch-folders',
			buildSupported: true, probeSucceeded: true, selfTestPassed: true,
			userEnabled,
		}],
	});
}

export function enabledNativeWatchAdmission() {
	return Object.freeze({
		snapshot: async () => nativeServicesSnapshot(),
		capabilities: async () => nativeWatchCapabilitySnapshot(),
	});
}
