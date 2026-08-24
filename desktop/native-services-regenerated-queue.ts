/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact authority for replacing one process-local V14 carrier on a paused durable row. */

import type { NativeQueueReservationsV1 } from '../src/common/editor/native-queue-record.ts';
import type { NativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import type { FramescaperNativeQueueEnqueueRequest } from './native-services-lifecycle-contracts.ts';

export function assertFramescaperRegeneratedQueue(
	current: NativeQueueRecordV3,
	request: FramescaperNativeQueueEnqueueRequest,
	reservations: NativeQueueReservationsV1,
): void {
	if (current.state !== 'paused' || current.lastFailureCode !== 'awaiting-carrier-regeneration'
		|| current.taskKind !== request.taskKind
		|| current.planVersion !== request.planVersion
		|| current.planFingerprint !== request.planFingerprint
		|| current.planPayload !== request.planPayload
		|| current.projectId !== request.projectId
		|| current.projectRevision !== request.projectRevision
		|| JSON.stringify(current.inputFingerprints) !== JSON.stringify(request.inputFingerprints)
		|| current.rootGrantId !== request.rootGrantId
		|| current.relativeDestination !== request.relativeDestination
		|| JSON.stringify(current.reservations) !== JSON.stringify(reservations)
		|| current.recoveryClass !== request.recoveryClass) {
		throw new Error('A regenerated V14 carrier does not match its paused durable queue row.');
	}
}
