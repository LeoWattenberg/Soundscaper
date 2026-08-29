/* SPDX-License-Identifier: AGPL-3.0-only */

export interface DraftBlurCommitGuard {
	cancelNextBlur: boolean;
}

interface DraftFieldTarget {
	blur(): void;
}

interface DraftFieldEscapeEvent<Target extends DraftFieldTarget> {
	readonly currentTarget: Target;
	preventDefault(): void;
	stopPropagation(): void;
}

export function createDraftBlurCommitGuard(): DraftBlurCommitGuard {
	return { cancelNextBlur: false };
}

export function draftBlurShouldCommit(guard: DraftBlurCommitGuard): boolean {
	if (!guard.cancelNextBlur) return true;
	guard.cancelNextBlur = false;
	return false;
}

export function cancelDraftEditOnEscape<Target extends DraftFieldTarget>(
	guard: DraftBlurCommitGuard,
	event: DraftFieldEscapeEvent<Target>,
	restore: () => void,
): void {
	guard.cancelNextBlur = true;
	restore();
	event.preventDefault();
	event.stopPropagation();
	event.currentTarget.blur();
}
