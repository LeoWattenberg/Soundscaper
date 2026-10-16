/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Button } from '@soundscaper/design-system/Button';

import { mouseShortcutBinding, mouseShortcutKey } from '../../mouse-shortcut.ts';
import { recognizedShortcutKey } from '../shortcut-key-validation.ts';
import { isReservedVideoNavigationShortcut } from './shortcut-editor-reservations.ts';
import type { DraftConflict } from './shortcut-draft-conflict-index.ts';
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
	readonly productId?: string;
	readonly shortcuts: ShortcutMap;
	readonly preferenceId: string;
	readonly bindings: readonly string[];
	readonly disabled?: boolean;
	readonly conflictFor?: (id: string, bindings: readonly string[]) => DraftConflict | null;
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
	readonly productId?: string;
	readonly command: ShortcutEditorCommand;
	readonly preferences: { readonly shortcuts: ShortcutMap };
	readonly controller: { actions: { preferences: { setShortcut: (id: string, bindings: string[]) => unknown } } };
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly conflictFor?: ShortcutEditorDraftInput['conflictFor'];
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
	productId = 'soundscaper',
	shortcuts,
	preferenceId,
	bindings,
	disabled = false,
	conflictFor,
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
			if (!recognizedShortcutKey(binding)) return { bindings: [], conflict: null, invalid: true };
			const value = normalizeAudioEditorShortcut(binding);
			if (isReservedVideoNavigationShortcut(productId, value)) {
				return { bindings: [], conflict: { binding: value, actionIds: [preferenceId, 'video-navigation'] }, invalid: false };
			}
			const key = audioEditorShortcutConflictKey(value);
			if (seen.has(key)) continue;
			seen.add(key);
			normalized.push(value);
		} catch {
			return { bindings: [], conflict: null, invalid: true };
		}
	}
	const conflict = conflictFor ? conflictFor(preferenceId, normalized) : conflictsFor({ ...shortcuts, [preferenceId]: normalized }).find((entry) => entry.actionIds.includes(preferenceId)) || null;
	return { bindings: normalized, conflict: conflict ? { binding: conflict.binding, actionIds: [...conflict.actionIds] } : null, invalid: false };
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

const SHORTCUT_ADD_CONTROL = '[data-shortcut-add="true"]';

/**
 * Name the control that should take focus once a binding is removed.
 *
 * The fields are rebuilt from the shortened list, so the button that was pressed
 * is gone: focus follows the position instead, landing on the binding that took
 * the removed one's place, or on the new last binding when the trailing one was
 * removed. A lone binding carries no remove control, so the add button catches
 * focus there.
 */
export function shortcutFocusTargetAfterRemove(index: number, remaining: number): string {
	if (remaining < 2) return SHORTCUT_ADD_CONTROL;
	return `[data-shortcut-remove="${Math.min(index, remaining - 1)}"]`;
}

export function ShortcutEditorRow({ productId = 'soundscaper', command, preferences, controller, copy, run, conflictFor }: ShortcutEditorRowProps) {
	const preferenceId = command.id;
	// A normalized binding never contains a space, so the joined list doubles as
	// a stable change signature and as the value the fields reset to.
	const persistedKey = persistedShortcutBindings(preferences.shortcuts, command).join(' ');
	const persisted = useMemo(() => (persistedKey ? persistedKey.split(' ') : []), [persistedKey]);
	const [entries, setEntries] = useState<string[]>(() => editableEntries(persisted));
	// A pending save may roll back after the user starts the next binding draft.
	const unassignedDraft = useRef(false);
	useLayoutEffect(() => {
		if (!unassignedDraft.current) setEntries(editableEntries(persisted));
	}, [persisted]);
	const errorId = useId();
	const bindingsRef = useRef<HTMLDivElement | null>(null);
	// Adding or removing a binding replaces the pressed control. Hand focus to
	// the new field or the surviving control once React has rebuilt the row.
	const [focusAfterChange, setFocusAfterChange] = useState<{ readonly selector: string } | null>(null);
	useEffect(() => {
		if (!focusAfterChange) return;
		const bindings = bindingsRef.current;
		const target = bindings?.querySelector<HTMLElement>(focusAfterChange.selector)
			|| bindings?.querySelector<HTMLElement>(SHORTCUT_ADD_CONTROL);
		target?.focus();
	}, [focusAfterChange]);
	const draft = shortcutEditorDraft({
		productId,
		shortcuts: preferences.shortcuts,
		preferenceId,
		bindings: entries,
		disabled: command.disabled,
		conflictFor,
	});
	const conflictAction = draft.conflict?.actionIds.find((id) => id !== preferenceId);
	const error = draft.invalid || (draft.conflict && !conflictAction)
		? copy.shortcutInvalid
		: draft.conflict
			? copy.shortcutConflict
				.replace('{binding}', draft.conflict.binding)
				.replace('{action}', conflictAction === 'video-navigation' ? copy.videoNavigation || 'Video navigation' : conflictAction || '')
			: '';
	const unchanged = draft.bindings.length === persisted.length
		&& draft.bindings.every((binding, index) => binding === persisted[index]);
	const updateDraft = (next: string[]) => {
		const saved = editableEntries(persisted);
		unassignedDraft.current = next.length !== saved.length || next.some((entry, index) => entry !== saved[index]);
		setEntries(next);
	};
	const setEntry = (index: number, value: string) => updateDraft(entries.map((entry, position) => position === index ? value : entry));
	const removeEntry = (index: number) => {
		const remaining = editableEntries(entries.filter((entry, position) => position !== index));
		updateDraft(remaining);
		setFocusAfterChange({ selector: shortcutFocusTargetAfterRemove(index, remaining.length) });
	};
	const addEntry = () => {
		updateDraft([...entries, '']);
		setFocusAfterChange({ selector: `[data-shortcut-binding="${entries.length}"]` });
	};
	return (
		<div
			className="kw-audio-editor-preferences__shortcut-row"
			data-shortcut-action={command.id}
			data-disabled-reason={command.disabledReason || undefined}
			aria-disabled={command.disabled ? 'true' : undefined}
		>
			<span className="kw-audio-editor-preferences__shortcut-command">{command.label}</span>
			<div className="kw-audio-editor-preferences__shortcut-bindings" role="group" aria-label={command.label} ref={bindingsRef}>
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
								aria-describedby={error ? errorId : undefined}
								onChange={(event) => setEntry(index, event.currentTarget.value)}
								onPointerDown={(event) => {
									if (mouseShortcutKey(event.button)) event.stopPropagation();
								}}
								onMouseDown={(event) => {
									const binding = mouseShortcutBinding(event);
									if (!binding || command.disabled) return;
									event.preventDefault();
									event.stopPropagation();
									event.currentTarget.focus();
									setEntry(index, binding);
								}}
								onMouseUp={suppressExtraMouseButton}
								onAuxClick={suppressExtraMouseButton}
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
							aria-label={`${copy.shortcutAddBinding}: ${command.label}`}
							onClick={addEntry}
						>{'+'}</button>}
					</div>
				))}
			</div>
			<Button
				variant="secondary"
				disabled={command.disabled || Boolean(error) || unchanged}
				onClick={() => {
					unassignedDraft.current = false;
					return run(() => controller.actions.preferences.setShortcut(preferenceId, draft.bindings));
				}}
			>{copy.shortcutAssign}</Button>
			{error && <small id={errorId} role="alert">{error}</small>}
			{command.disabledReason && <small data-shortcut-disabled-reason>{command.disabledReason}</small>}
		</div>
	);
}

function suppressExtraMouseButton(event: MouseEvent<HTMLInputElement>): void {
	if (!mouseShortcutKey(event.button)) return;
	event.preventDefault();
	event.stopPropagation();
}

/** Keep one empty field so an unbound command still has somewhere to type. */
function editableEntries(bindings: readonly string[]): string[] {
	return bindings.length ? [...bindings] : [''];
}
