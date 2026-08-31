/* SPDX-License-Identifier: AGPL-3.0-only */

type AutomationGestureCancelOperation = Readonly<{
	readonly type: 'automation-gesture/cancel';
}>;

type SoundscaperProductionDialogClosePerform = (
	name: string,
	operation: () => AutomationGestureCancelOperation,
	onSuccess?: () => void,
	onSettled?: () => void,
	admission?: Readonly<{ readonly allowWhenBlocked?: boolean }>,
) => void;

/** Coordinate dismissal with the workspace-owned automation gesture token. */
export function createSoundscaperProductionDialogClose(input: Readonly<{
	readonly pending: string | null;
	readonly automationGestureActive: boolean;
	readonly perform: SoundscaperProductionDialogClosePerform;
	readonly setAutomationGestureActive: (active: boolean) => void;
	readonly onClose: () => void;
}>): () => void {
	return () => {
		if (input.pending !== null) return;
		if (!input.automationGestureActive) {
			input.onClose();
			return;
		}
		input.perform(
			'automation-gesture-cancel',
			() => ({ type: 'automation-gesture/cancel' }),
			() => {
				input.setAutomationGestureActive(false);
				input.onClose();
			},
			undefined,
			{ allowWhenBlocked: true },
		);
	};
}
