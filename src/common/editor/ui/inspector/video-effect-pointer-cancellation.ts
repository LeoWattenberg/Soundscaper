/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native range inputs can keep emitting changes after a canceled drag. */
export function createVideoEffectPointerCancellation() {
	let held = false;
	let canceled = false;
	let owner: number | null = null;
	return {
		begin(pointerId: number): boolean {
			if (held) return false;
			held = true; canceled = false; owner = pointerId;
			return true;
		},
		resumeKeyboard(): void { if (!held) canceled = false; },
		cancel(): void { if (held) canceled = true; },
		allowsPreview(): boolean { return !canceled; },
		finish(pointerId: number): boolean {
			if (!held || pointerId !== owner) return false;
			const completed = !canceled;
			held = false; owner = null;
			return completed;
		},
	};
}
