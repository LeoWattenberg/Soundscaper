/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Read a bounded response while keeping the verified bytes independent of its stream. */
export async function readBoundedResponse(response: Response, options: Readonly<{
	readonly expectedBytes?: number;
	readonly expectedSha256?: string;
	readonly label: string;
	readonly maximumBytes: number;
	readonly signal?: AbortSignal;
}>): Promise<Uint8Array> {
	try {
		const declaredLength = response.headers.get('content-length');
		if (declaredLength !== null && !hasEncodedWireRepresentation(response)) {
			if (!/^\d+$/u.test(declaredLength)) throw new Error(`${options.label} has an invalid Content-Length.`);
			const parsed = Number(declaredLength);
			if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > options.maximumBytes) {
				throw new Error(`${options.label} Content-Length is outside its byte limit.`);
			}
			if (options.expectedBytes !== undefined && parsed !== options.expectedBytes) {
				throw new Error(`${options.label} Content-Length does not match its verified byte length.`);
			}
		}
		if (!response.body) throw new Error(`${options.label} response has no readable body.`);
	} catch (error) {
		await response.body?.cancel(error).catch(() => undefined);
		throw error;
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	const digest = options.expectedSha256 ? sha256.create() : null;
	let byteLength = 0;
	try {
		while (true) {
			throwIfAborted(options.signal);
			const { done, value } = await reader.read();
			throwIfAborted(options.signal);
			if (done) break;
			if (!(value instanceof Uint8Array) || value.byteLength === 0) {
				throw new Error(`${options.label} returned an invalid response chunk.`);
			}
			byteLength += value.byteLength;
			if (!Number.isSafeInteger(byteLength) || byteLength > options.maximumBytes) {
				throw new Error(`${options.label} exceeds its byte limit.`);
			}
			const owned = value.slice();
			digest?.update(owned);
			chunks.push(owned);
		}
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
	if (byteLength < 1) throw new Error(`${options.label} is empty.`);
	if (options.expectedBytes !== undefined && byteLength !== options.expectedBytes) {
		throw new Error(`${options.label} byte length is ${byteLength}; expected ${options.expectedBytes}.`);
	}
	if (options.expectedSha256 && bytesToHex(digest!.digest()) !== options.expectedSha256) {
		throw new Error(`${options.label} SHA-256 does not match its verified descriptor.`);
	}
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export function hasEncodedWireRepresentation(response: Response): boolean {
	// Fetch exposes decoded body bytes while retaining the encoded wire length.
	const contentEncoding = response.headers.get('content-encoding');
	if (contentEncoding === null) return false;
	return contentEncoding.split(',').some((coding) => coding.trim().toLowerCase() !== 'identity');
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Runtime installation was cancelled.', 'AbortError');
}
