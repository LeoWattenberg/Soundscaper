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
	readonly id: 'file' | 'edit' | 'view';
	readonly label: string;
	readonly items: readonly MotionscaperShellMenuItem[];
}

export interface MotionscaperShellMenuOptions {
	readonly copy: Readonly<Record<string, string>>;
	readonly workspaceOpen: boolean;
	readonly onToggleWorkspace: () => void;
	readonly onNewComposition?: () => void;
	readonly onCommand?: (command: MotionDocumentCommand) => void;
	readonly hasProject?: boolean; readonly busy?: boolean;
	readonly canUndo?: boolean; readonly canRedo?: boolean;
}

export type MotionDocumentCommand = 'new' | 'open' | 'save' | 'copy' | 'library' | 'settings' | 'undo' | 'redo';
export interface MotionDocumentRequest { readonly id: number; readonly command: MotionDocumentCommand }

/** The shell admits only actions its product runtime has actually supplied. */
export function createMotionscaperShellMenus(
	options: MotionscaperShellMenuOptions,
): readonly MotionscaperShellMenu[] {
	const { copy, workspaceOpen, onToggleWorkspace, onCommand } = options;
	const onNewComposition = options.onNewComposition ?? (onCommand ? () => onCommand('new') : undefined);
	const item = (id: string, label: string, command: MotionDocumentCommand, enabled = true): MotionscaperShellMenuItem => Object.freeze({
		id, label, disabled: !onCommand || !enabled || Boolean(options.busy),
		...(onCommand && enabled && !options.busy ? { onClick: () => onCommand(command) } : {}),
	});
	return Object.freeze([
		Object.freeze({
			id: 'file' as const, label: copy.motionscaperFileMenu,
			items: Object.freeze([Object.freeze({
				id: 'motion-new-composition', label: copy.motionscaperNewComposition,
				disabled: onNewComposition === undefined || Boolean(options.busy),
				...(onNewComposition ? { onClick: onNewComposition } : { disabledReason: copy.motionscaperUnavailable }),
			}), item('motion-open', copy.motionscaperOpen, 'open'),
			item('motion-save', copy.motionscaperSave, 'save', options.hasProject),
			item('motion-copy', copy.motionscaperSaveCopy, 'copy', options.hasProject),
			item('motion-library', copy.motionscaperLibrary, 'library')]),
		}),
		Object.freeze({
			id: 'edit' as const, label: copy.motionscaperEditMenu,
			items: Object.freeze([item('motion-undo', copy.motionscaperUndo, 'undo', options.canUndo ?? false),
				item('motion-redo', copy.motionscaperRedo, 'redo', options.canRedo ?? false)]),
		}),
		Object.freeze({
			id: 'view' as const, label: copy.motionscaperViewMenu,
			items: Object.freeze([Object.freeze({
				id: 'motion-workspace', label: copy.workspaceMotion,
				checked: workspaceOpen, onClick: onToggleWorkspace,
			}), item('motion-settings', copy.motionscaperSettings, 'settings', options.hasProject)]),
		}),
	]);
}
