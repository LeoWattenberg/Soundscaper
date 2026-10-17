/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertPhotoDevelopHandoffMasksForProfileV1 } from './internal/photo-image-handoff-model-kernel-v1.ts';
export function assertPhotoDevelopHandoffMasksCurrentV1(develop: unknown, width: number, height: number): void { assertPhotoDevelopHandoffMasksForProfileV1('current3', develop, width, height); }
