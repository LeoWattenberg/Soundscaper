/* SPDX-License-Identifier: AGPL-3.0-only */

export type WavContainerSignature = 'RIFF' | 'RF64' | 'BW64' | null;

type WavFilePredicate = (file: unknown) => boolean;
type WavInspector<Result> = (file: unknown) => Promise<Result>;

interface SliceableFile {
	readonly slice: (start: number, end: number) => unknown;
}

interface BlobSlice {
	readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

export async function inspectWavContainerSignature(
	file: unknown,
	isWavFile: WavFilePredicate,
): Promise<WavContainerSignature> {
	if (!isWavFile(file) || !isSliceableFile(file)) return null;
	try {
		const part = file.slice(0, 4);
		if (!isBlobSlice(part)) return null;
		const buffer = await part.arrayBuffer();
		if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== 4) return null;
		const signature = String.fromCharCode(...new Uint8Array(buffer));
		return signature === 'RIFF' || signature === 'RF64' || signature === 'BW64'
			? signature
			: null;
	} catch {
		return null;
	}
}

export async function inspectWavForImport<Result>(
	file: unknown,
	isWavFile: WavFilePredicate,
	inspectWav: WavInspector<Result>,
	signature: WavContainerSignature,
): Promise<Result | null> {
	if (!isWavFile(file) || !isSliceableFile(file)) return null;
	try {
		return await inspectWav(file);
	} catch (error) {
		if (signature === 'RF64' || signature === 'BW64') throw error;
		return null;
	}
}

function isSliceableFile(value: unknown): value is SliceableFile {
	return typeof value === 'object' && value != null
		&& typeof (value as Readonly<{ slice?: unknown }>).slice === 'function';
}

function isBlobSlice(value: unknown): value is BlobSlice {
	return typeof value === 'object' && value != null
		&& typeof (value as Readonly<{ arrayBuffer?: unknown }>).arrayBuffer === 'function';
}
