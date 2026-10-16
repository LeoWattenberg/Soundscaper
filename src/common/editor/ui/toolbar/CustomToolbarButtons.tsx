/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';
import { ToolbarButtonGroup } from '@soundscaper/design-system/Toolbar';

import { iconNameToChar } from '../../audacity-iconcodes.js';
import type { CustomToolbarButton } from '../../custom-toolbar-buttons.ts';
import type { AudioEditorWorkspaceRunner } from '../workspace/audio-editor-workspace-runner.ts';
import type { CustomToolbarButtonAction } from './custom-toolbar-button-actions.ts';

interface GroupProps {
	readonly buttons: readonly CustomToolbarButton[];
	readonly actions: readonly CustomToolbarButtonAction[];
	readonly copy: Record<string, string>;
	readonly run: AudioEditorWorkspaceRunner;
}

export function CustomToolbarButtonGroup({ buttons, actions, copy, run }: GroupProps) {
	if (buttons.length === 0) return null;
	return <ToolbarButtonGroup className="kw-audio-editor__custom-toolbar-buttons" gap={2}>
		{buttons.map((button) => {
			const action = actions.find((candidate) => candidate.actionId === button.actionId);
			const disabled = !action || action.disabled || !action.onClick;
			return <button
				key={button.id}
				type="button"
				className="tool-button tool-button--default kw-audio-editor__custom-toolbar-button"
				aria-label={button.name}
				title={disabled ? `${button.name}: ${action?.disabledReason || copy.customToolbarButtonUnavailable}` : button.name}
				disabled={disabled}
				onClick={() => { if (!disabled && action.onClick) run(action.onClick); }}
			>
				<span className="musescore-icon" aria-hidden="true">{iconNameToChar(button.icon)}</span>
			</button>;
		})}
	</ToolbarButtonGroup>;
}

interface SettingsProps {
	readonly buttons: readonly CustomToolbarButton[];
	readonly toolbarButtons: Readonly<Record<string, boolean>>;
	readonly copy: Record<string, string>;
	readonly onCustomize: (button: CustomToolbarButton | null) => void;
	readonly onToggle: (id: string, visible: boolean) => void;
}

export function CustomToolbarButtonSettings({ buttons, toolbarButtons, copy, onCustomize, onToggle }: SettingsProps) {
	return <>
		<div role="menu" aria-label={copy.customToolbarButton} className="kw-audio-editor__toolbar-settings-custom-menu">
			<button type="button" role="menuitem" className="kw-audio-editor__toolbar-settings-option" onClick={() => onCustomize(null)}>
				<span className="musescore-icon" aria-hidden="true">{iconNameToChar('PLUS')}</span>
				<span className="kw-audio-editor__toolbar-settings-custom-label">{copy.customToolbarButton}</span>
			</button>
		</div>
		{buttons.map((button) => <div key={button.id} className="kw-audio-editor__toolbar-settings-custom-row">
			<button
				type="button"
				role="checkbox"
				aria-label={button.name}
				aria-checked={toolbarButtons[button.id] !== false}
				className="kw-audio-editor__toolbar-settings-option"
				onClick={() => onToggle(button.id, toolbarButtons[button.id] === false)}
			>
				<span className="musescore-icon" aria-hidden="true">{iconNameToChar(toolbarButtons[button.id] === false ? 'EYE_CLOSED' : 'EYE_OPEN')}</span>
				<span className="kw-audio-editor__toolbar-settings-icon musescore-icon" aria-hidden="true">{iconNameToChar(button.icon)}</span>
				<span>{button.name}</span>
			</button>
			<div role="menu" aria-label={copy.customToolbarButtonEdit.replace('{name}', button.name)}>
			<button
				type="button"
				role="menuitem"
				className="kw-audio-editor__toolbar-settings-custom-edit"
				aria-label={copy.customToolbarButtonEdit.replace('{name}', button.name)}
				title={copy.customToolbarButtonEdit.replace('{name}', button.name)}
				onClick={() => onCustomize(button)}
			>
				<span className="musescore-icon" aria-hidden="true">{iconNameToChar('EDIT')}</span>
			</button>
			</div>
		</div>)}
	</>;
}
