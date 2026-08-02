/* SPDX-License-Identifier: AGPL-3.0-only */

import { Readable } from 'node:stream';

const MAXIMUM_READ_BYTES = 64 * 1024;

/** Streams one bounded FileHandle range without ever taking ownership of the handle. */
export function createReadCapabilityRangeStream(handle, { start, end }) {
	if (!handle || typeof handle.read !== 'function'
		|| !Number.isSafeInteger(start) || start < 0
		|| !Number.isSafeInteger(end) || end < start) {
		throw new TypeError('A valid non-owning file-handle range is required');
	}
	let position = start;
	let reading = false;
	let ended = false;
	let pendingRead = null;
	return new Readable({
		read(requestedBytes) {
			if (reading || ended || this.destroyed) return;
			if (position > end) {
				ended = true;
				this.push(null);
				return;
			}
			reading = true;
			const length = Math.min(
				Math.max(1, Math.min(Number(requestedBytes) || MAXIMUM_READ_BYTES, MAXIMUM_READ_BYTES)),
				end - position + 1,
			);
			const buffer = Buffer.allocUnsafe(length);
			const operation = Promise.resolve(handle.read(buffer, 0, length, position));
			pendingRead = operation;
			void operation.then((result) => {
				if (pendingRead === operation) pendingRead = null;
				reading = false;
				if (this.destroyed) return;
				if (!Number.isSafeInteger(result?.bytesRead) || result.bytesRead < 1
					|| result.bytesRead > length) {
					this.destroy(new Error('Desktop read capability ended before its admitted range'));
					return;
				}
				position += result.bytesRead;
				this.push(buffer.subarray(0, result.bytesRead));
			}, (error) => {
				if (pendingRead === operation) pendingRead = null;
				reading = false;
				if (!this.destroyed) this.destroy(error);
			});
		},
		destroy(error, callback) {
			ended = true;
			const terminalError = error instanceof Error ? error : null;
			if (!pendingRead) {
				callback(terminalError);
				return;
			}
			void pendingRead.then(
				() => callback(terminalError),
				(readError) => callback(terminalError ?? (readError instanceof Error ? readError : null)),
			);
		},
	});
}
