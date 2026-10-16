/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeBextMetadata, type BextMetadata } from './broadcast-wave.ts';
import { createBwfExportMetadata, type BwfExportMetadataOptions } from './broadcast-wave-project.ts';
import type { MasteringSequenceDeliveryPlan } from './mastering-sequence-delivery.ts';

/** BEXT identifies the file's first sample, even when its first take is later in the project. */
export function createMasteringSequenceBext(
	project: Parameters<typeof createBwfExportMetadata>[0],
	options: BwfExportMetadataOptions,
	plan: MasteringSequenceDeliveryPlan,
): BextMetadata {
	const first = plan.segments[0];
	if (!first) throw new RangeError('A mastering BWF requires a delivered entry.');
	const metadata = createBwfExportMetadata(project, { ...options, rangeStartFrame: first.sourceStartFrame });
	// The gap already uses the output clock. Subtract it after the absolute
	// source timestamp has been converted, retaining exact uint64 precision.
	const timeReference = BigInt(metadata.timeReference) - BigInt(first.outputStartFrame);
	if (timeReference < 0n) throw new RangeError('The mastering lead-in would place the first BWF sample before midnight.');
	return normalizeBextMetadata({ ...metadata, timeReference: timeReference.toString() }, { version: 2 });
}
