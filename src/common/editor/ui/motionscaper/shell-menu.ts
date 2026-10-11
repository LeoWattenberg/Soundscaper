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
	readonly id: 'file' | 'edit' | 'view' | 'tracks' | 'help';
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
	readonly onDocumentation?: (destination: 'manual' | 'tutorials') => void;
}

export type MotionDocumentCommand = 'new' | 'open' | 'save' | 'copy' | 'library' | 'settings' | 'undo' | 'redo' | 'solid' | 'text' | 'rectangle' | 'ellipse' | 'star' | 'preview' | 'render' | 'import' | 'timeline' | 'properties' | 'paths' | 'operators' | 'tracking' | 'compositing' | 'expressions' | 'appearance' | 'compositions' | 'scene' | 'after-effects' | 'send';
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
			item('motion-compositions', copy.motionscaperCompositions, 'compositions', options.hasProject),
			item('motion-import', copy.motionscaperImportMedia, 'import', options.hasProject),
			item('motion-save', copy.motionscaperSave, 'save', options.hasProject),
			item('motion-copy', copy.motionscaperSaveCopy, 'copy', options.hasProject),
			item('motion-library', copy.motionscaperLibrary, 'library'),
			item('motion-send', copy.motionscaperSendComposition, 'send', options.hasProject),
			item('motion-after-effects', copy.motionscaperAfterEffectsBridge, 'after-effects'),
			item('motion-render', copy.motionscaperRender, 'render', options.hasProject)]),
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
			}), item('motion-settings', copy.motionscaperSettings, 'settings', options.hasProject),
			item('motion-preview', copy.motionscaperPreview, 'preview', options.hasProject),
			item('motion-timeline', copy.motionscaperTimeline, 'timeline', options.hasProject)]),
		}),
		Object.freeze({
			id: 'tracks' as const, label: copy.motionscaperLayerMenu,
			items: Object.freeze([
				item('motion-properties', copy.motionscaperProperties, 'properties', options.hasProject),
				item('motion-paths', copy.motionscaperPaths, 'paths', options.hasProject),
				item('motion-operators', copy.motionscaperOperators, 'operators', options.hasProject),
				item('motion-scene', copy.motionscaperScene, 'scene', options.hasProject),
				item('motion-appearance', copy.motionscaperAppearance, 'appearance', options.hasProject),
				item('motion-expressions', copy.motionscaperExpressions, 'expressions', options.hasProject),
				item('motion-compositing', copy.motionscaperCompositing, 'compositing', options.hasProject),
				item('motion-tracking', copy.motionscaperTracking, 'tracking', options.hasProject),
				item('motion-solid', copy.motionscaperSolid, 'solid', options.hasProject),
				item('motion-text', copy.motionscaperText, 'text', options.hasProject),
				item('motion-rectangle', copy.motionscaperRectangle, 'rectangle', options.hasProject),
				item('motion-ellipse', copy.motionscaperEllipse, 'ellipse', options.hasProject),
				item('motion-star', copy.motionscaperStar, 'star', options.hasProject),
			]),
		}),
		Object.freeze({ id: 'help' as const, label: copy.motionscaperHelpMenu,
			items: Object.freeze((['manual', 'tutorials'] as const).map(destination => Object.freeze({
				id: `motion-help-${destination}`, label: destination === 'manual' ? copy.motionscaperManual : copy.motionscaperFirstProject,
				disabled: !options.onDocumentation, ...(options.onDocumentation ? { onClick: () => options.onDocumentation?.(destination) } : {}),
			}))),
		}),
	]);
}
