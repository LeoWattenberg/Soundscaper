/* SPDX-License-Identifier: AGPL-3.0-only */

export interface FramescaperSidecarFileReader {
	openReadDescriptor?(
		descriptor: unknown, options?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<unknown> | unknown;
	withReadDescriptors?<Value>(
		descriptors: readonly unknown[], options: Readonly<{ readonly signal?: AbortSignal }>,
		consume: (files: readonly unknown[]) => Promise<Value>,
	): PromiseLike<Value> | Value;
}

/** Complete a sidecar consumer before its native selected-range lease is released. */
export async function withFramescaperSidecarFile<Value>(
	service: FramescaperSidecarFileReader, descriptor: unknown, signal: AbortSignal | undefined,
	consume: (file: Blob) => PromiseLike<Value> | Value,
): Promise<Value> {
	const options = signal ? { signal } : {};
	if (typeof service.withReadDescriptors === 'function') {
		return await service.withReadDescriptors([descriptor], options, async (files) =>
			await consume(fileBody(files[0])));
	}
	if (typeof service.openReadDescriptor !== 'function') {
		throw new Error('Desktop sidecar file reading is unavailable.');
	}
	return await consume(fileBody(await service.openReadDescriptor(descriptor, options)));
}

function fileBody(value: unknown): Blob {
	if (!(value instanceof Blob)) throw new TypeError('The selected sidecar is not a pathless file body.');
	return value;
}
