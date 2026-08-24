/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned durable hardware reservation for selected V28/V14 queue work. */

import {
	NATIVE_MEDIA_CPU_BACKEND,
	NATIVE_MEDIA_WEB_BACKEND,
	type NativeMediaBackendPlanV1,
	type NativeMediaPlatform,
} from '../src/common/editor/native-media-backend-policy.ts';
import { NATIVE_MEDIA_V14_PLATFORM_ACCELERATION } from '../src/common/editor/native-media-v14-support.ts';
import type {
	NativeQueueReservationsV1,
	NativeQueueTaskKind,
} from '../src/common/editor/native-queue-record.ts';

interface NativeV14QueueReservationRequest {
	readonly planVersion: number;
	readonly taskKind: NativeQueueTaskKind;
	readonly reservations: NativeQueueReservationsV1;
}

interface NativeV14QueueRecordBackend {
	readonly taskKind: NativeQueueTaskKind;
	readonly reservations: NativeQueueReservationsV1;
}

export function createFramescaperNativeV14QueueReservationAuthority(options: Readonly<{
	readonly platform: NativeMediaPlatform;
	readonly hardwareEncodeEnabled: () => boolean;
}>): (request: NativeV14QueueReservationRequest) => NativeQueueReservationsV1 {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| !Object.hasOwn(NATIVE_MEDIA_V14_PLATFORM_ACCELERATION, options.platform)
		|| typeof options.hardwareEncodeEnabled !== 'function') {
		throw new TypeError('Selected V14 queue reservation authority requires the main OS and preference port.');
	}
	return (request) => {
		if (request.planVersion !== 14) {
			throw new Error('Selected V28 queue admission requires exact plan V14.');
		}
		const hardwareBackend = request.taskKind === 'encoded-export'
			&& options.hardwareEncodeEnabled()
			? NATIVE_MEDIA_V14_PLATFORM_ACCELERATION[options.platform].encode : null;
		return Object.freeze({ ...request.reservations, hardwareBackend });
	};
}

export function framescaperNativeV14BackendPlanForRecord(
	record: NativeV14QueueRecordBackend,
	platform: NativeMediaPlatform,
): NativeMediaBackendPlanV1 {
	const hardwareBackend = record.reservations.hardwareBackend;
	const expected = NATIVE_MEDIA_V14_PLATFORM_ACCELERATION[platform].encode;
	if (hardwareBackend !== null
		&& (record.taskKind !== 'encoded-export' || hardwareBackend !== expected)) {
		throw new Error('The persisted hardware reservation is not the selected V14 OS baseline.');
	}
	const attempts: NativeMediaBackendPlanV1['attempts'] = Object.freeze(
		hardwareBackend === null
			? [NATIVE_MEDIA_CPU_BACKEND]
			: [hardwareBackend, NATIVE_MEDIA_CPU_BACKEND],
	);
	return Object.freeze({
		platform, operation: 'encode', attempts, fallback: NATIVE_MEDIA_WEB_BACKEND,
		reason: hardwareBackend === null ? 'cpu-only' : 'hardware-then-cpu',
	});
}
