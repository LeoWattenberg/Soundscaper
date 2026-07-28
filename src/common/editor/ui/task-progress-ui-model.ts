/* SPDX-License-Identifier: AGPL-3.0-only */

export interface TaskProgressViewModel {
	readonly id: string;
	readonly kind: string;
	readonly label: string;
	readonly value: number | null;
}

export interface TaskProgressBusySnapshot {
	readonly importing?: unknown;
	readonly exporting?: unknown;
	readonly processingEffect?: unknown;
	readonly analysisProcessing?: unknown;
	readonly playbackOptions?: Readonly<{ preparing?: unknown }> | null;
	readonly sampleEdit?: Readonly<{ processing?: unknown }> | null;
}

export function selectFallbackTaskProgress(
	snapshot: TaskProgressBusySnapshot,
	label: string,
): TaskProgressViewModel | null {
	const kind = snapshot.importing
		? 'import'
		: snapshot.exporting
			? 'export'
			: snapshot.processingEffect
				? 'effect'
				: snapshot.analysisProcessing
					? 'analysis'
					: snapshot.sampleEdit?.processing
						? 'sample-edit'
						: snapshot.playbackOptions?.preparing ? 'render' : null;
	return kind ? Object.freeze({ id: `busy-${kind}`, kind, label, value: null }) : null;
}
