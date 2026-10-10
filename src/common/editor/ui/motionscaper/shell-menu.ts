/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MotionscaperShellMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly disabledReason?: string;
	readonly checked?: boolean;
	readonly onClick?: () => void;
}

export interface MotionscaperShellMenu {
	readonly id: 'file' | 'view';
	readonly label: string;
	readonly items: readonly MotionscaperShellMenuItem[];
}

export interface MotionscaperShellMenuOptions {
	readonly copy: Readonly<Record<string, string>>;
	readonly workspaceOpen: boolean;
	readonly onToggleWorkspace: () => void;
	readonly onNewComposition?: () => void;
}

/** The shell admits only actions its product runtime has actually supplied. */
export function createMotionscaperShellMenus(
	options: MotionscaperShellMenuOptions,
): readonly MotionscaperShellMenu[] {
	const { copy, workspaceOpen, onToggleWorkspace, onNewComposition } = options;
	return Object.freeze([
		Object.freeze({
			id: 'file' as const, label: copy.motionscaperFileMenu,
			items: Object.freeze([Object.freeze({
				id: 'motion-new-composition', label: copy.motionscaperNewComposition,
				disabled: onNewComposition === undefined,
				...(onNewComposition ? { onClick: onNewComposition } : { disabledReason: copy.motionscaperUnavailable }),
			})]),
		}),
		Object.freeze({
			id: 'view' as const, label: copy.motionscaperViewMenu,
			items: Object.freeze([Object.freeze({
				id: 'motion-workspace', label: copy.workspaceMotion,
				checked: workspaceOpen, onClick: onToggleWorkspace,
			})]),
		}),
	]);
}
