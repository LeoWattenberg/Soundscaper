/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	cancelDraftEditOnEscape,
	type DraftBlurCommitGuard,
} from '../draft-blur-commit.ts';

interface SequenceFieldKeyEvent {
	readonly key: string;
	readonly defaultPrevented?: boolean;
	readonly nativeEvent?: Readonly<{ isComposing?: boolean }>;
	readonly currentTarget: { value: string; blur(): void };
	preventDefault(): void;
	stopPropagation(): void;
}

/** Both sequence fields save on blur; keyboard completion must use that same owner. */
export function handleSequenceFieldKeyDown(
	event: SequenceFieldKeyEvent,
	guard: DraftBlurCommitGuard,
	savedValue: string,
	restore: () => void,
): void {
	if (event.defaultPrevented || event.nativeEvent?.isComposing) return;
	if (event.key === 'Enter') {
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.blur();
	} else if (event.key === 'Escape' && event.currentTarget.value !== savedValue) {
		cancelDraftEditOnEscape(guard, event, () => {
			event.currentTarget.value = savedValue;
			restore();
		});
	}
}
