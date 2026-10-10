/* SPDX-License-Identifier: AGPL-3.0-only */
import { useLayoutEffect, useRef, useState } from 'react';
import type { PhotoLibraryExportPresetsPortV1, PhotoLibraryExportPresetsAccessV1, PhotoExportPresetSnapshotV1, PhotoRasterExportPresetV1 } from '../../photo-library-export-presets-port-v1.ts';
import { photoExportPresetsCopy } from '../../../i18n/lightscaper-photo-export-presets-copy.ts';

interface Props {
	readonly locale: string; readonly disabled: boolean; readonly batch?: boolean;
	readonly capture?: () => PhotoLibraryExportPresetsPortV1['open'];
	readonly captureCurrent: (id: string, name: string) => PhotoRasterExportPresetV1;
	readonly onApply: (preset: PhotoRasterExportPresetV1, signal: AbortSignal) => void | Promise<void>;
	readonly registerDestination: (join: () => Promise<void>) => () => void;
}
interface Scope {
	readonly stop: AbortController; readonly pending: Set<Promise<unknown>>; live: boolean; acting: boolean;
	port: Readonly<PhotoLibraryExportPresetsAccessV1> | null; retirement: Promise<void> | null;
}
/** Menu-opened presentation borrows only selected scalar CAS methods. Its
 * reads/writes join on retirement; applying never obtains a save destination. */
export default function PhotoRasterExportPresets(props: Props) {
	const latest = useRef(props); latest.current = props;
	const scope = useRef<Scope | null>(null), previous = useRef<Promise<void> | null>(null);
	const [snapshot, setSnapshot] = useState<{ scope: Scope; value: PhotoExportPresetSnapshotV1 } | null>(null);
	const [selected, setSelected] = useState(''), [name, setName] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
	const newIdentity = useRef<{ name: string; id: string } | null>(null), copy = photoExportPresetsCopy(props.locale);
	const watch = <Result,>(current: Scope, work: Promise<Result>) => {
		current.pending.add(work); const done = () => { current.pending.delete(work); }; void work.then(done, done); return work;
	};
	const retire = (current: Scope): Promise<void> => {
		if (current.retirement) return current.retirement;
		current.stop.abort(); current.retirement = Promise.allSettled([...current.pending]).then(() => undefined); return current.retirement;
	};
	const { capture, registerDestination } = props;
	useLayoutEffect(() => {
		const old = previous.current, current: Scope = { stop: new AbortController(), live: true, acting: false, port: null, pending: new Set(), retirement: null }; scope.current = current;
		const unregister = registerDestination(() => retire(current));
		setSelected(''); setName(''); setMessage(''); setBusy(false); newIdentity.current = null;
		if (capture) {
			const work = (async () => {
				const open = capture();
				await old; current.stop.signal.throwIfAborted(); const port = await open({ signal: current.stop.signal }); current.stop.signal.throwIfAborted();
				current.port = port; const value = await port.list({ schemaVersion: 1 }, { signal: current.stop.signal });
				if (current.live && !current.stop.signal.aborted) setSnapshot({ scope: current, value });
			})();
			void watch(current, work).catch(() => { if (current.live && !current.stop.signal.aborted) setMessage(photoExportPresetsCopy(latest.current.locale).failed); });
		}
		return () => { current.live = false; previous.current = retire(current); unregister(); };
	}, [capture, registerDestination]);
	const ready = snapshot?.scope === scope.current && !!scope.current?.port && !scope.current.stop.signal.aborted;
	const run = (action: 'save' | 'apply' | 'delete' | 'reload') => {
		const current = scope.current, value = snapshot?.scope === current ? snapshot.value : null, input = latest.current;
		if (!current?.live || current.stop.signal.aborted || current.acting || input.disabled || !input.capture) return;
		if (action !== 'reload' && (!current.port || !value)) return;
		const port = current.port, chosen = selected, label = name, signal = current.stop.signal;
		current.acting = true; setBusy(true); setMessage('');
		const work = (async () => {
			if (action === 'reload') {
				const access = port ?? await watch(current, input.capture!()({ signal })); signal.throwIfAborted(); current.port = access;
				const result = await watch(current, access.list({ schemaVersion: 1 }, { signal })); signal.throwIfAborted();
				if (current.live) { setSnapshot({ scope: current, value: result }); setSelected(''); setName(''); newIdentity.current = null; } return;
			}
			if (!port || !value) return;
			if (action === 'apply') {
				const result = await watch(current, port.read({ schemaVersion: 1, presetId: chosen, expectedRevision: value.revision }, { signal })); signal.throwIfAborted();
				if (current.live) await input.onApply(result.preset, signal); return;
			}
			let command;
			if (action === 'delete') command = { type: 'delete' as const, expectedRevision: value.revision, presetId: chosen };
			else {
				if (!chosen && newIdentity.current?.name !== label) newIdentity.current = { name: label, id: crypto.randomUUID() };
				const preset = input.captureCurrent(chosen || newIdentity.current!.id, label);
				command = { type: 'save' as const, expectedRevision: value.revision, preset };
			}
			const result = await watch(current, port.write({ schemaVersion: 1, command }, { signal }));
			if (current.live && !signal.aborted) {
				setSnapshot({ scope: current, value: result.snapshot }); setMessage(action === 'delete' ? copy.removed : copy.saved);
				if (action === 'delete') { setSelected(''); setName(''); } else { setSelected(command.type === 'save' ? command.preset.id : ''); newIdentity.current = null; }
			}
		})();
		void watch(current, work.catch(() => { if (current.live && !signal.aborted) setMessage(copy.failed); }).finally(() => { current.acting = false; if (current.live) setBusy(false); }));
	};
	return <details data-photo-export-presets><summary>{copy.title}</summary>
		{!capture ? <p>{copy.unavailable}</p> : <>
			{!ready && !message && <p role="status">{copy.preparing}</p>}
			<fieldset data-photo-export-preset-fields disabled={props.disabled || busy || !!scope.current?.stop.signal.aborted}>
				<label>{copy.choose}<select data-photo-export-preset-select disabled={!ready} value={selected} onChange={event => {
					const id = event.currentTarget.value; setSelected(id); setName(snapshot?.value.presets.find(preset => preset.id === id)?.name ?? ''); newIdentity.current = null;
				}}><option value="">{copy.fresh}</option>{snapshot?.scope === scope.current && snapshot.value.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
				<label>{copy.name}<input data-photo-export-preset-name disabled={!ready} value={name} maxLength={256} onChange={event => { setName(event.currentTarget.value); }} /></label>
				<button type="button" data-photo-export-preset-save disabled={!ready || !name.trim()} onClick={() => { run('save'); }}>{copy.save}</button>
				<button type="button" data-photo-export-preset-apply disabled={!ready || !selected} onClick={() => { run('apply'); }}>{copy.apply}</button>
				<button type="button" data-photo-export-preset-delete disabled={!ready || !selected} onClick={() => { run('delete'); }}>{copy.remove}</button>
				<button type="button" data-photo-export-preset-reload disabled={!ready && !message} onClick={() => { run('reload'); }}>{copy.reload}</button>
			</fieldset><p>{copy.graphic}</p>
		</>}
		{message && <p role="status" data-photo-export-preset-message>{message}</p>}
	</details>;
}
