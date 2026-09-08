/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded liveness for requests made to the native delivery filesystem peer. */

const CONTROL_REQUEST_TIMEOUT_MS = 30_000;
export const FILESYSTEM_REQUEST_TIMEOUT_MS = 120_000;

export function optionalDeliveryFilesystemRequestTimeout(value: number | undefined): number | null {
	if (value === undefined) return null;
	if (!Number.isSafeInteger(value) || value < 1 || value > FILESYSTEM_REQUEST_TIMEOUT_MS) {
		throw new RangeError('Soundscaper delivery filesystem request timeout is invalid.');
	}
	return value;
}

export function deliveryFilesystemRequestTimeout(
	slowFilesystemOperation: boolean,
	override: number | null,
): number {
	return override ?? (slowFilesystemOperation
		? FILESYSTEM_REQUEST_TIMEOUT_MS : CONTROL_REQUEST_TIMEOUT_MS);
}

export async function awaitDeliveryFilesystemRequest<T>(
	operation: Promise<T>,
	timeoutMs: number,
	onTimeout: (error: Error) => void,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const deadline = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			const error = new Error(
				`Soundscaper delivery filesystem helper request timed out after ${timeoutMs} ms.`,
			);
			onTimeout(error);
			reject(error);
		}, timeoutMs);
		timer.unref?.();
	});
	try { return await Promise.race([operation, deadline]); }
	finally { if (timer !== null) clearTimeout(timer); }
}
