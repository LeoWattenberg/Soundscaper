/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SourceProvenanceV1 } from './source-provenance.ts';
import { createRecordingDeviceProvenanceExtension } from './source-provenance-extensions.ts';

/** Mark a source that was created locally and therefore has no imported attribution. */
export function createNonImportedSourceProvenance(
	classification: 'recorded' | 'generated',
	options: Readonly<{ readonly recordingDeviceLabel?: string | null }> = {},
): SourceProvenanceV1 {
	if (classification !== 'recorded' && classification !== 'generated') {
		throw new RangeError('Non-imported provenance must be recorded or generated.');
	}
	const extensions = createRecordingDeviceProvenanceExtension(options.recordingDeviceLabel);
	return Object.freeze({
		schemaVersion: 1,
		classification,
		contributions: Object.freeze([]),
		...(extensions ? { extensions } : {}),
	});
}
