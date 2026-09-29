/* SPDX-License-Identifier: AGPL-3.0-only */
import { parseRiffMarkers } from './riff-markers.ts';
import { parseRiffInfo } from './riff-info.ts';

export function finalizeRiffMetadata(cue: Uint8Array | null, adtl: readonly Uint8Array[], info: readonly Uint8Array[], warnings: Array<Readonly<Record<string, unknown>>>): Readonly<Record<string, unknown>> {
	let markers: ReturnType<typeof parseRiffMarkers> = Object.freeze([]);
	let parsedInfo: ReturnType<typeof parseRiffInfo> = Object.freeze({});
	try { markers = parseRiffMarkers(cue, adtl); }
	catch (error) {
		warnings.push(Object.freeze({ code: 'riff-markers-invalid', message: error instanceof Error ? error.message : String(error) }));
	}
	try { parsedInfo = parseRiffInfo(info); }
	catch (error) {
		warnings.push(Object.freeze({ code: 'riff-info-invalid', message: error instanceof Error ? error.message : String(error) }));
	}
	return Object.freeze({ markers, info: parsedInfo });
}

export function wavMetadataWarning(code: string, message: string): Readonly<Record<string, string>> {
	return Object.freeze({ code, field: 'chunk', message });
}
