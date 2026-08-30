/* SPDX-License-Identifier: AGPL-3.0-only */

export function useFramescaperVideoProxyPreviewPressure(_options: unknown): void {}

export function publishEvaluatedVideoPreviewFrame(_request: unknown): boolean {
	return false;
}

export async function bindFramescaperPreviewFreezeCapture(
	_input: unknown,
): Promise<() => void> {
	return () => undefined;
}
