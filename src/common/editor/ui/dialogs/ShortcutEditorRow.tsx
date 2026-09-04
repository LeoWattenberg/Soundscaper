/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useMemo, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';

import {
	audioEditorShortcutConflictKey,
	findAudioEditorShortcutConflicts,
	normalizeAudioEditorShortcut,
} from '../../preferences.js';

type ShortcutMap = Readonly<Record<string, readonly string[]>>;

interface ShortcutConflict {
	readonly binding: string;
	readonly actionIds: readonly string[];
}

export interface ShortcutEditorDraftInput {
	readonly shortcuts: ShortcutMap;
	readonly preferenceId: string;
	readonly bindings: readonly string[];
	readonly disabled?: boolean;
}

export interface ShortcutEditorDraft {
	readonly bindings: string[];
	readonly conflict: ShortcutConflict | null;
	readonly invalid: boolean;
}

export interface ShortcutEditorCommand {
	readonly id: string;
	readonly preferenceId?: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly disabledReason?: string | null;
}

export interface ShortcutEditorRowProps {
	readonly command: ShortcutEditorCommand;
	readonly preferences: { readonly shortcuts: ShortcutMap };
	readonly controller: { actions: { preferences: { setShortcut: (id: string, bindings: string[]) => unknown } } };
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
}

const conflictsFor = findAudioEditorShortcutConflicts as (shortcuts: ShortcutMap) => ShortcutConflict[];

/**
 * Normalize one row's edited bindings and report what would go wrong.
 *
 * Every binding a command holds is editable, so the draft is the whole list
 * rather than a primary with preserved alternatives: blanks drop out, repeats
 * collapse, and the conflict search runs over the candidate list.
 */
export function shortcutEditorDraft({
	shortcuts,
	preferenceId,
	bindings,
	disabled = false,
}: ShortcutEditorDraftInput): ShortcutEditorDraft {
	if (disabled) return { bindings: [], conflict: null, invalid: false };
	const normalized: string[] = [];
	// Two fields can spell the same chord differently — `Ctrl+Backspace` and
	// `ctrl+backspace` normalize apart but bind the same key — so the second one
	// collapses into the first rather than being stored as a rival binding.
	const seen = new Set<string>();
	for (const binding of bindings) {
		try {
			if (!String(binding).trim()) continue;
			const value = normalizeAudioEditorShortcut(binding);
			const key = audioEditorShortcutConflictKey(value);
			if (seen.has(key)) continue;
			seen.add(key);
			normalized.push(value);
		} catch {
			return { bindings: [], conflict: null, invalid: true };
		}
	}
	const candidate = { ...shortcuts, [preferenceId]: normalized };
	const conflict = conflictsFor(candidate).find((entry) => entry.actionIds.includes(preferenceId)) || null;
	return { bindings: normalized, conflict, invalid: false };
}

/** Read the bindings a command currently holds, under either of its identifiers. */
export function persistedShortcutBindings(
	shortcuts: ShortcutMap,
	command: ShortcutEditorCommand,
): readonly string[] {
	return shortcuts[command.id]
		|| (command.preferenceId ? shortcuts[command.preferenceId] : null)
		|| [];
}

export function ShortcutEditorRow({ command, preferences, controller, copy, run }: ShortcutEditorRowProps) {
	const preferenceId = command.id;
	// A normalized binding never contains a space, so the joined list doubles as
	// a stable change signature and as the value the fields reset to.
	const persistedKey = persistedShortcutBindings(preferences.shortcuts, command).join(' ');
	const persisted = useMemo(() => (persistedKey ? persistedKey.split(' ') : []), [persistedKey]);
	const [entries, setEntries] = useState<string[]>(() => editableEntries(persisted));
	useLayoutEffect(() => setEntries(editableEntries(persisted)), [persisted]);
	const draft = shortcutEditorDraft({
		shortcuts: preferences.shortcuts,
		preferenceId,
		bindings: entries,
		disabled: command.disabled,
	});
	const conflictAction = draft.conflict?.actionIds.find((id) => id !== preferenceId);
	const error = draft.invalid || (draft.conflict && !conflictAction)
		? copy.shortcutInvalid
		: draft.conflict
			? copy.shortcutConflict
				.replace('{binding}', draft.conflict.binding)
				.replace('{action}', conflictAction || '')
			: '';
	const unchanged = draft.bindings.length === persisted.length
		&& draft.bindings.every((binding, index) => binding === persisted[index]);
	const setEntry = (index: number, value: string) => setEntries((current) => (
		current.map((entry, position) => position === index ? value : entry)
	));
	const removeEntry = (index: number) => setEntries((current) => (
		editableEntries(current.filter((entry, position) => position !== index))
	));
	return (
		<div
			className="kw-audio-editor-preferences__shortcut-row"
			data-shortcut-action={command.id}
			data-disabled-reason={command.disabledReason || undefined}
			aria-disabled={command.disabled ? 'true' : undefined}
			title={command.disabledReason || undefined}
		>
			<span className="kw-audio-editor-preferences__shortcut-command">{command.label}</span>
			<div className="kw-audio-editor-preferences__shortcut-bindings" role="group" aria-label={command.label}>
				{entries.map((entry, index) => (
					<div className="kw-audio-editor-preferences__shortcut-binding" key={`binding-${index}`}>
						<label>
							<span className="kw-audio-editor-sr-only">
								{`${command.label}: ${copy.shortcutColumn} ${index + 1}`}
							</span>
							<input
								data-shortcut-binding={index}
								disabled={command.disabled}
								value={entry}
								aria-invalid={error ? 'true' : 'false'}
								onChange={(event) => setEntry(index, event.currentTarget.value)}
							/>
						</label>
						{entries.length > 1 && <button
							type="button"
							className="kw-audio-editor-preferences__shortcut-remove"
							data-shortcut-remove={index}
							disabled={command.disabled}
							aria-label={`${copy.shortcutRemoveBinding}: ${command.label} ${index + 1}`}
							onClick={() => removeEntry(index)}
						>{'\u00d7'}</button>}
						{index === entries.length - 1 && <button
							type="button"
							className="kw-audio-editor-preferences__shortcut-add"
							data-shortcut-add="true"
							disabled={command.disabled}
							title={copy.shortcutAddBinding}
							aria-label={`${copy.shortcutAddBinding}: ${command.label}`}
							onClick={() => setEntries((current) => [...current, ''])}
						>{'+'}</button>}
					</div>
				))}
			</div>
			<Button
				variant="secondary"
				disabled={command.disabled || Boolean(error) || unchanged}
				onClick={() => run(() => controller.actions.preferences.setShortcut(preferenceId, draft.bindings))}
			>{copy.shortcutAssign}</Button>
			{error && <small role="alert">{error}</small>}
			{command.disabledReason && <small data-shortcut-disabled-reason>{command.disabledReason}</small>}
		</div>
	);
}

/** Keep one empty field so an unbound command still has somewhere to type. */
function editableEntries(bindings: readonly string[]): string[] {
	return bindings.length ? [...bindings] : [''];
}
