/* SPDX-License-Identifier: AGPL-3.0-only */

/** SubRip has common legacy ANSI writers; WebVTT and Audacity TXT stay UTF-8. */
export function decodeLabelInputText(bytes: Uint8Array | ArrayBuffer, legacySubRip: boolean): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		if (!legacySubRip) throw error;
		return new TextDecoder('windows-1252').decode(bytes);
	}
}
