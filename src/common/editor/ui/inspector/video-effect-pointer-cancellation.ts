/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native range inputs can keep emitting changes after a canceled drag. */
export function createVideoEffectPointerCancellation() {
	let held = false;
	let canceled = false;
	return {
		begin(): void { held = true; canceled = false; },
		resumeKeyboard(): void { if (!held) canceled = false; },
		cancel(): void { if (held) canceled = true; },
		allowsPreview(): boolean { return !canceled; },
		finish(): boolean {
			const completed = !canceled;
			held = false;
			return completed;
		},
	};
}
