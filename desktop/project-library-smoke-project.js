/* SPDX-License-Identifier: AGPL-3.0-only */

export const DESKTOP_SMOKE_PROJECT_SCHEMA_VERSION = 16;
export const DESKTOP_SMOKE_PRIMARY_SEQUENCE_ID = 'main-sequence';

export function createDesktopSmokeProjectFoundation(trackIds) {
	if (!Array.isArray(trackIds) || trackIds.some((trackId) => typeof trackId !== 'string' || !trackId)) {
		throw new TypeError('Desktop smoke project track ids must be non-empty strings');
	}
	return {
		schemaVersion: DESKTOP_SMOKE_PROJECT_SCHEMA_VERSION,
		trackFolders: [],
		sequences: [{
			id: DESKTOP_SMOKE_PRIMARY_SEQUENCE_ID,
			name: 'Main sequence',
			rate: { num: 30, den: 1 },
			dropFrame: false,
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
			trackIds: [...trackIds],
			trackNodes: trackIds.map((id) => ({ kind: 'track', id, parentFolderId: null })),
		}],
		primarySequenceId: DESKTOP_SMOKE_PRIMARY_SEQUENCE_ID,
		tempoMap: {
			mode: 'musical',
			events: [{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
		signatureMap: {
			events: [{ id: 'signature-1', bar: 0, numerator: 4, denominator: 4 }],
		},
		timelineAnnotations: [],
	};
}
