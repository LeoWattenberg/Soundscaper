/* SPDX-License-Identifier: AGPL-3.0-only */

import type { NativeQueueReservationsV1 } from '../common/editor/native-queue-record.ts';

/** Shared queue policy without importing either native execution pipeline. */
export const FRAMESCAPER_V28_RENDER_QUEUE_RESERVATIONS: NativeQueueReservationsV1 =
	Object.freeze({
		cpuCores: 2,
		processTreeRssBytes: 4 * 1_024 ** 3,
		scratchBytes: 32 * 1_024 ** 3,
		minimumFreeBytes: 10 * 1_024 ** 3,
		hardwareBackend: null,
	});
