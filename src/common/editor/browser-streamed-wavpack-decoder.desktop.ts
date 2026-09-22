/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WavPackImportGroupDecoder } from './browser-streamed-wavpack-import.ts';

/** Desktop WavPack import must receive the main-process codec bridge. */
export function createDefaultWavPackGroupDecoder(): WavPackImportGroupDecoder & Readonly<{ dispose(): void }> {
	throw new Error('Desktop WavPack import requires a main-process codec decoder.');
}
