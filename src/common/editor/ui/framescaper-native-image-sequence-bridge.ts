/* SPDX-License-Identifier: AGPL-3.0-only */

/** Optional pathless image-sequence methods exposed by an authenticated desktop bridge. */
export interface FramescaperNativeImageSequenceDecodeClaim {
	readonly claimId: string;
	readonly sourceId: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly frameCount: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
}

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
	imageSequenceImport?(request: unknown): Promise<unknown>;
	writeImageSequenceImportChunk?(request: Readonly<{
		readonly transactionId: string;
		readonly asset: 'pack' | 'inventory';
		readonly offset: number;
		readonly bytes: Uint8Array;
	}>): Promise<unknown>;
	readImageSequenceImportBody?(request: Readonly<{
		readonly transactionId: string;
		readonly asset: 'pack' | 'inventory';
		readonly offset: number;
		readonly length: number;
	}>): Promise<Uint8Array>;
	decodeImageSequenceSource?(request: Readonly<{
		readonly requestId: string;
		readonly projectId: string;
		readonly projectRevision: number;
		readonly sourceId: string;
	}>): Promise<Readonly<FramescaperNativeImageSequenceDecodeClaim>>;
	cancelImageSequenceDecode?(request: Readonly<{ readonly requestId: string }>): Promise<boolean>;
	readImageSequenceDecode?(request: Readonly<{
		readonly claimId: string;
		readonly offset: number;
		readonly length: number;
	}>): Promise<Uint8Array>;
	releaseImageSequenceDecode?(request: Readonly<{ readonly claimId: string }>): Promise<boolean>;
}
