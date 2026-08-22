/* SPDX-License-Identifier: AGPL-3.0-only */

/** Optional pathless image-sequence methods exposed by an authenticated desktop bridge. */
export interface FramescaperNativeImageSequenceBridge {
	selectImageSequence?(): Promise<Readonly<{
		readonly selectionId: string;
		readonly files: readonly Readonly<{
			readonly fileId: string;
			readonly name: string;
			readonly byteLength: number;
		}>[];
	}> | null>;
	readImageSequenceFile?(request: Readonly<{
		readonly selectionId: string;
		readonly fileId: string;
		readonly offset: number;
		readonly length: number;
	}>): Promise<Uint8Array>;
	releaseImageSequence?(request: Readonly<{ readonly selectionId: string }>): Promise<boolean>;
}
