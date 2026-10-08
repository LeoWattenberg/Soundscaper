/* SPDX-License-Identifier: AGPL-3.0-only */

/** A report/refusal keeps the controls available; only a completed edit dismisses them. */
export function nyquistDialogAppliedResult(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const result = value as Readonly<{ type?: unknown; frameCount?: unknown; labels?: unknown; results?: unknown }>;
	if (result.type === 'audio') return typeof result.frameCount === 'number' && result.frameCount > 0;
	if (result.type === 'labels') return Array.isArray(result.labels) && result.labels.length > 0;
	return result.type === 'multiple' && Array.isArray(result.results) && result.results.length > 0
		&& result.results.every(nyquistDialogAppliedResult);
}
