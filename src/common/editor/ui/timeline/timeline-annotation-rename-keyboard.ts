/* SPDX-License-Identifier: AGPL-3.0-only */

export interface TimelineAnnotationRenameKeyInput {
	readonly key: string;
	readonly nativeEvent?: Readonly<{ isComposing?: boolean }>;
	stopPropagation(): void;
	preventDefault(): void;
}

export type TimelineAnnotationRenameCompletionIntent = Readonly<{
	readonly save: boolean;
	readonly restoreFocus: true;
}>;

export function consumeTimelineAnnotationRenameKey(
	event: TimelineAnnotationRenameKeyInput,
): TimelineAnnotationRenameCompletionIntent | null {
	if (event.nativeEvent?.isComposing) return null;
	event.stopPropagation();
	if (event.key !== 'Enter' && event.key !== 'Escape') return null;
	event.preventDefault();
	return Object.freeze({ save: event.key === 'Enter', restoreFocus: true });
}
