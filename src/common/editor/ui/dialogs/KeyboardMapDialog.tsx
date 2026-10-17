/* SPDX-License-Identifier: AGPL-3.0-only */
/* Keyboard layout and visual treatment adapted from Audacity 20ce5547. */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTheme } from '@soundscaper/design-system/ThemeProvider';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
import { KEYBOARD_MAP_COPY_BY_LOCALE } from '../../../i18n/editor-keyboard-map-copy.ts';
import { AUDIO_EDITOR_RESERVED_SHORTCUTS, AUDIO_EDITOR_SEARCH_ACTION_ID } from '../../preferences.js';
import { keyboardMapContextBindings } from './keyboard-map-contexts.ts';
import { KEYBOARD_MAP_ROWS, keyboardMapBindings, keyboardMapState, keyboardMapStateLabel, type KeyboardMapCommand } from './keyboard-map-model.ts';
import './KeyboardMapDialog.css';

interface Props {
	readonly commands: readonly KeyboardMapCommand[];
	readonly shortcuts: Readonly<Record<string, readonly string[]>>;
	readonly copy: Readonly<Record<string, string>>;
	readonly onClose: () => void;
}

export default function KeyboardMapDialog({ commands, shortcuts, copy: editorCopy, onClose }: Props) {
	const copy = useMemo(() => resolveEditorCopyScope('keyboardMap', KEYBOARD_MAP_COPY_BY_LOCALE.en, editorCopy), [editorCopy]);
	const { theme } = useTheme();
	const mac = /Mac|iPhone|iPad/u.test(navigator.platform || navigator.userAgent);
	const bindings = useMemo(() => [
		...keyboardMapBindings(commands, shortcuts, mac),
		...keyboardMapBindings([{ id: AUDIO_EDITOR_SEARCH_ACTION_ID, label: editorCopy.editorSearchLabel, categoryId: 'global', categoryLabel: copy.global }], AUDIO_EDITOR_RESERVED_SHORTCUTS, mac),
		...keyboardMapContextBindings(copy, mac),
	], [commands, shortcuts, mac, copy, editorCopy.editorSearchLabel]);
	const [context, setContext] = useState('all');
	const [picked, setPicked] = useState('plain');
	const [held, setHeld] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const visible = useMemo(() => context === 'all' ? bindings : bindings.filter(binding => binding.context === context), [bindings, context]);
	const contexts = useMemo(() => [...new Map(bindings.map(binding => [binding.context, binding.contextLabel])).entries()], [bindings]);
	const states = useMemo(() => ['plain', ...new Set(bindings.map(binding => binding.state).filter(state => state !== 'plain'))], [bindings]);
	const state = held ?? picked;
	useEffect(() => {
		const read = (event: KeyboardEvent) => {
			const mods = [event.ctrlKey ? 'Ctrl' : '', event.metaKey ? 'Meta' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean);
			setHeld(mods.length ? keyboardMapState(mods) : null);
		};
		const blur = () => setHeld(null);
		document.addEventListener('keydown', read, true);
		document.addEventListener('keyup', read, true);
		window.addEventListener('blur', blur);
		return () => {
			document.removeEventListener('keydown', read, true);
			document.removeEventListener('keyup', read, true);
			window.removeEventListener('blur', blur);
		};
	}, []);
	const layoutKeys = new Set(KEYBOARD_MAP_ROWS.flat());
	const extra = [...new Set(bindings.map(binding => binding.key))].filter(key => !layoutKeys.has(key));
	const rows = extra.length ? [...KEYBOARD_MAP_ROWS, extra] : KEYBOARD_MAP_ROWS;
	const style = {
		'--km-bg': theme.background.menu.background, '--km-cap': theme.background.control.input.idle,
		'--km-cap-edge': theme.border.input.idle, '--km-line': theme.border.default,
		'--km-ink': theme.foreground.text.primary, '--km-ink-2': theme.foreground.text.secondary,
		'--km-accent': theme.background.control.button.primary.idle, '--km-accent-ink': '#ffffff',
		'--km-hover': theme.background.menu.item.hover,
	} as CSSProperties;
	const keyCap = (key: string) => mac ? ({ Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Backspace: '⌫' }[key] ?? key)
		: key === 'Meta' ? 'Win' : key;
	return <AudioEditorDialogShell title={copy.title} onClose={onClose} width={1040} draggable
		className="keyboard-map-window" initialFocus=".keyboard-map__tab" closeOnOutside={false}>
		<div className="keyboard-map" data-keyboard-map style={style}>
			<p className="keyboard-map__sub">{copy.help}</p>
			<div className="keyboard-map__contexts" role="group" aria-label={copy.context}>
				{[['all', copy.all], ...contexts].map(([id, label]) => <button key={id} type="button" className="keyboard-map__tab"
					aria-pressed={context === id} data-context={id} onClick={() => { setContext(id); setSelected(null); }}>{label}</button>)}
			</div>
			<div className="keyboard-map__states" role="group" aria-label={copy.modifiers}>
				{states.map(item => <button key={item} type="button" className="keyboard-map__chip" aria-pressed={state === item}
					data-state={item} onClick={() => { setPicked(item); setHeld(null); }}>{keyboardMapStateLabel(item, mac, copy.plain)}</button>)}
			</div>
			<div className="keyboard-map__board-wrap"><div className="keyboard-map__board" aria-label={copy.keyboard}>
				{rows.map((row, index) => <div key={index} className="keyboard-map__row">{row.map((key, keyIndex) => {
					const here = visible.filter(binding => binding.key === key && binding.state === state);
					const anywhere = visible.some(binding => binding.key === key);
					const modifier = ['Ctrl', 'Meta', 'Alt', 'Shift', 'CapsLock'].includes(key);
					const unit = key === 'Space' ? 5.6 : ['Tab', 'Enter', 'Backspace', 'Shift', 'CapsLock'].includes(key) ? 1.6 : 1;
					return <button key={`${key}:${keyIndex}`} type="button" data-key={key} className={[
						'keyboard-map__key', here.length ? 'keyboard-map__key--bound' : anywhere ? 'keyboard-map__key--other' : '',
						modifier ? 'keyboard-map__key--mod' : '', modifier && state.split('+').includes(key) ? 'keyboard-map__key--active' : '',
						selected === key ? 'keyboard-map__key--selected' : '',
					].join(' ')} style={{ '--u': unit } as CSSProperties} disabled={!anywhere}
						aria-label={`${keyCap(key)}${here.length ? ': ' + here.map(binding => binding.action).join('; ') : ''}`}
						onClick={() => setSelected(key)}>
						<span className="keyboard-map__cap">{keyCap(key)}</span>
						{here.length > 0 && <span className="keyboard-map__what">{here.map(binding => binding.action).join(' · ')}</span>}
					</button>;
				})}</div>)}
			</div></div>
			<div className="keyboard-map__detail" aria-live="polite" data-keyboard-map-detail>
				{selected ? <><h3 className="keyboard-map__detail-title">{keyCap(selected)}</h3>
					{contexts.map(([id, label]) => {
						const entries = visible.filter(binding => binding.key === selected && binding.context === id);
						return entries.length > 0 && <section key={id} className="keyboard-map__ctx-group" data-detail-context={id}>
							<h4 className="keyboard-map__ctx-title">{label}</h4>
							{entries.map(binding => <div key={binding.id} className="keyboard-map__binding"><kbd>{binding.text}</kbd><span>{binding.action}</span></div>)}
						</section>;
					})}</> : <p className="keyboard-map__empty">{copy.empty}</p>}
			</div>
		</div>
	</AudioEditorDialogShell>;
}
