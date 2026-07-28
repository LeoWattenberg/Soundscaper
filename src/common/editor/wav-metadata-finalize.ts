/* SPDX-License-Identifier: AGPL-3.0-only */
import { parseRiffMarkers } from './riff-markers.ts';
import { parseRiffInfo } from './riff-info.ts';

export function finalizeRiffMetadata(cue: Uint8Array | null, adtl: readonly Uint8Array[], info: readonly Uint8Array[], warnings: Array<Readonly<Record<string, unknown>>>): Readonly<Record<string, unknown>> {
	try { return Object.freeze({ markers: parseRiffMarkers(cue, adtl), info: parseRiffInfo(info) }); }
	catch (error) {
		warnings.push(Object.freeze({ code: 'riff-markers-invalid', message: error instanceof Error ? error.message : String(error) }));
		return Object.freeze({ markers: Object.freeze([]), info: Object.freeze({}) });
	}
}

export function wavMetadataWarning(code: string, message: string): Readonly<Record<string, string>> {
	return Object.freeze({ code, field: 'chunk', message });
}
