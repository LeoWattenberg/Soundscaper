/* SPDX-License-Identifier: AGPL-3.0-only */

import { Gunzip } from 'fflate';

const GZIP_INPUT_CHUNK_BYTES = 4_096;

export class AdmXmlExpandedSizeError extends RangeError {
	constructor(maximumBytes: number) {
		super(`The decompressed ADM XML payload exceeds the ${formatByteLimit(maximumBytes)} safety limit.`);
	}
}

export function gunzipAdmXmlBounded(input: Uint8Array, maximumBytes: number): Uint8Array {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
		throw new RangeError('The ADM XML expansion limit must be a non-negative safe integer.');
	}
	if (input.byteLength >= 4) {
		const declaredBytes = new DataView(input.buffer, input.byteOffset, input.byteLength)
			.getUint32(input.byteLength - 4, true);
		if (declaredBytes > maximumBytes) throw new AdmXmlExpandedSizeError(maximumBytes);
	}
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	let complete = false;
	const stream = new Gunzip((chunk, final) => {
		if (chunk.byteLength > maximumBytes - byteLength) throw new AdmXmlExpandedSizeError(maximumBytes);
		byteLength += chunk.byteLength;
		chunks.push(chunk);
		complete ||= final;
	});
	if (input.byteLength === 0) stream.push(input, true);
	for (let offset = 0; offset < input.byteLength; offset += GZIP_INPUT_CHUNK_BYTES) {
		const end = Math.min(input.byteLength, offset + GZIP_INPUT_CHUNK_BYTES);
		stream.push(input.subarray(offset, end), end === input.byteLength);
	}
	if (!complete) throw new Error('The gzip stream is truncated.');
	const output = new Uint8Array(byteLength);
	let outputOffset = 0;
	for (const chunk of chunks) {
		output.set(chunk, outputOffset);
		outputOffset += chunk.byteLength;
	}
	return output;
}

function formatByteLimit(bytes: number): string {
	return bytes === 16 * 1024 * 1024 ? '16 MiB' : `${bytes}-byte`;
}
