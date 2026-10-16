/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopSettingsCopy } from '../../../i18n/lightscaper-develop-settings-copy.ts';
import type { ImageDevelopSelectionV1 } from '../../imaging/image-develop-settings-contract-v1.ts';
import PhotoDevelopSettingsPickerV2 from './PhotoDevelopSettingsPickerV2.tsx';
import PhotoDevelopQuickSettings from './PhotoDevelopQuickSettings.tsx';
import PhotoDevelopLocalAdjustmentsMenuV1 from './PhotoDevelopLocalAdjustmentsMenuV1.tsx';

import type { PhotoDevelopSettingsMenuPropsV2 } from './PhotoDevelopSettingsMenuV2.tsx';
import type { PhotoDevelopSettingsMenuPropsCurrentV1 } from './PhotoDevelopSettingsMenuCurrentV1.tsx';
import type { ImageDevelopSelectionV4 } from '../../imaging/image-develop-settings-contract-v4.ts';
import PhotoDevelopSettingsPickerCurrentV1 from './PhotoDevelopSettingsPickerCurrentV1.tsx';
import { photoDevelopRawDevelopmentCopy } from '../../../i18n/lightscaper-raw-development-copy.ts';
import { photoDevelopSoftProofCopy } from '../../../i18n/lightscaper-develop-soft-proof-copy.ts';
import { photoDevelopPreviewRendererCopy } from '../../../i18n/lightscaper-develop-preview-renderer-copy.ts';

type Props = (PhotoDevelopSettingsMenuPropsV2 & Readonly<{ profile: 'legacy2' }>)
	| (PhotoDevelopSettingsMenuPropsCurrentV1 & Readonly<{ profile: 'current3' }>);
type Mode = 'copy' | 'sync' | 'auto' | 'quick' | 'presets';

export default function PhotoDevelopSettingsMenuKernelV1(props: Props) {
	if (props.profile !== 'legacy2' && props.profile !== 'current3') throw new TypeError('Unknown fixed Develop settings menu profile.');
	const { owner, snapshot, source } = props, messages = photoDevelopSettingsCopy(props.locale, props.profile);
	const [entry, setEntry] = useState<Readonly<{ mode: Mode }> | null>(null);
	const [selection, setSelection] = useState<ImageDevelopSelectionV1 | ImageDevelopSelectionV4>(() => ({ effectTypes: 'all', geometry: true, localAdjustments: true, ...(props.profile === 'current3' ? { repairs: true, rawDevelopment: true } : {}) }));
	const [presetName, setPresetName] = useState(''), [presetId, setPresetId] = useState('');
	const [writePending, setWritePending] = useState(false);
	const active = useRef(entry), live = useRef(true), owned = useRef(owner), writing = useRef<object | null>(null); owned.current = owner;
	useEffect(() => { live.current = true; active.current = null; setEntry(null); return () => { live.current = false; active.current = null; }; }, [owner]);
	const latest = useRef(props); latest.current = props;
	const current = () => live.current && owned.current === owner && props.isCurrent();
	const invoke = (method: 'copy' | 'paste' | 'sync' | 'relative' | 'armAutoSync' | 'listPresets' | 'savePreset' | 'applyPreset' | 'renamePreset' | 'deletePreset', ...args: unknown[]) => Reflect.apply(owner[method], owner, args) as Promise<unknown>;
	const dialogCurrent = () => current() && entry !== null && active.current === entry;
	const interactive = () => latest.current === props && dialogCurrent() && owner.snapshot() === snapshot;
	const busy = props.disabled || snapshot.busy || writePending;
	const run = (action: () => Promise<unknown>, refresh = false) => {
		if (latest.current !== props || !current() || owner.snapshot() !== snapshot || busy || writing.current) return;
		if (props.profile === 'current3' && refresh) {
			const token = {}, selectedEntry = active.current; writing.current = token; setWritePending(true);
			const admitted = () => current() && writing.current === token && active.current === selectedEntry;
			void Promise.resolve().then(() => Reflect.apply(props.withWritePreviewRetirement, props, [action, admitted]) as Promise<unknown>)
				.catch(() => undefined).finally(() => { if (writing.current === token) { writing.current = null; setWritePending(false); } });
		} else void action().then(async result => { if (result && refresh && current()) await props.onChanged(); }).catch(() => undefined);
	};
	const open = (mode: Mode) => {
		if (latest.current !== props || !current() || owner.snapshot() !== snapshot || busy || writing.current || active.current) return; const next = Object.freeze({ mode }); active.current = next; setEntry(next);
		if (mode === 'presets') run(() => invoke('listPresets', source.catalogId));
	};
	const close = () => { if (!dialogCurrent()) return; active.current = null; setEntry(null); };
	const menu = snapshot.presets?.catalogId === source.catalogId ? snapshot.presets : null;
	const selected = menu?.presets.find(preset => preset.id === presetId);
	const modes = { copy: messages.copy, sync: messages.sync, auto: messages.auto, quick: messages.quick, presets: messages.presets };
	return <>
		<details className="lightscaper-develop-settings-menu"><summary>{messages.menu}</summary>
			{props.profile === 'current3' && props.previewRenderer && <button type="button" disabled={busy} onClick={() => {
				if (current() && !active.current) props.previewRenderer?.onOpen();
			}}>{photoDevelopPreviewRendererCopy(props.locale).menu}</button>}
			{props.profile === 'current3' && props.softProof && <button type="button" disabled={busy} onClick={() => {
				if (current() && !active.current) props.softProof?.onOpen();
			}}>{photoDevelopSoftProofCopy(props.locale).menu}</button>}
			{props.profile === 'current3' && props.rawDevelopment && <button type="button" disabled={busy} onClick={() => {
				if (current() && !active.current) props.rawDevelopment?.onOpen();
			}}>{photoDevelopRawDevelopmentCopy(props.locale).menu}</button>}
			<PhotoDevelopLocalAdjustmentsMenuV1 locale={props.locale} disabled={busy} isCurrent={() => current() && !active.current}
				resolution={props.resolution} localAdjustments={props.localAdjustments} repairs={props.repairs} />
			<button type="button" disabled={busy} onClick={() => { open('copy'); }}>{messages.copy}</button>
			<button type="button" disabled={busy || props.dirty || !snapshot.clipboard} onClick={() => { run(() => invoke('paste', source, messages.pasteLabel), true); }}>{messages.paste}</button>
			<button type="button" disabled={busy || props.dirty || props.selectedIds.filter(id => id !== source.photoId).length === 0} onClick={() => { open('sync'); }}>{messages.sync}</button>
			<button type="button" disabled={busy || props.dirty || props.selectedIds.filter(id => id !== source.photoId).length === 0} onClick={() => { open('auto'); }}>{messages.auto}</button>
			{snapshot.autoSync && <button type="button" disabled={busy} onClick={() => { if (current()) owner.clearAutoSync(); }}>{messages.stopAuto}</button>}
			<button type="button" disabled={busy || props.dirty || props.selectedIds.length === 0} onClick={() => { open('quick'); }}>{messages.quick}</button>
			<button type="button" disabled={busy} onClick={() => { open('presets'); }}>{messages.presets}</button>
		</details>
		{snapshot.autoSync && <p role="status">{messages.autoActive} {snapshot.autoSyncTargetCount}</p>}
		{snapshot.clipboard && <p role="status">{messages.copied}</p>}
		{snapshot.error && <p role="alert">{messages.actionFailed}</p>}
		{snapshot.batch && <section aria-label={messages.batch}><h3>{messages.batch}</h3><p role="status">{messages[snapshot.batch.completion]}</p>
			<ul>{snapshot.batch.outcomes.map(outcome => <li key={outcome.photoId}>{outcome.photoId}: {outcome.status === 'not-attempted' ? messages.notAttempted : messages[outcome.status]}</li>)}</ul>
			{snapshot.batch.notices.includes('cleanup-failed') && <p role="status">{messages.cleanup}</p>}
			{snapshot.notice && <p role="status">{messages.refresh}</p>}
		</section>}
		{snapshot.presetReceipt && <p role="status">{messages.presetSaved}{snapshot.presetReceipt.notices.includes('cleanup-failed') && ` ${messages.cleanup}`}</p>}
		{entry && <AudioEditorDialogShell title={modes[entry.mode]} onClose={close} className="lightscaper-dialog lightscaper-develop-settings-dialog"
			overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
			{snapshot.busy && <p role="status">{messages.working}</p>}
			<p>{messages.selected}: {props.selectedIds.length}</p><p>{messages.targetPolicy}</p>
			{entry.mode !== 'quick' && (props.profile === 'current3'
				? <PhotoDevelopSettingsPickerCurrentV1 value={selection as ImageDevelopSelectionV4} disabled={busy} messages={messages} isCurrent={interactive} onChange={setSelection} />
				: <PhotoDevelopSettingsPickerV2 value={selection} disabled={busy} messages={messages} isCurrent={interactive} onChange={setSelection} />)}
			{entry.mode === 'copy' && <button type="button" disabled={busy} onClick={() => {
				if (!dialogCurrent()) return; run(async () => { await invoke('copy', source, selection); close(); });
			}}>{messages.confirmCopy}</button>}
			{entry.mode === 'sync' && <button type="button" disabled={busy || props.dirty} onClick={() => {
				if (dialogCurrent()) run(() => invoke('sync', source, props.selectedIds, selection, messages.syncLabel), true);
			}}>{messages.confirmSync}</button>}
			{entry.mode === 'auto' && <><p>{messages.autoPolicy}</p><button type="button" disabled={busy || props.dirty} onClick={() => {
				if (!dialogCurrent()) return; run(async () => { await invoke('armAutoSync', source, props.selectedIds, selection); close(); });
			}}>{messages.confirmAuto}</button></>}
			{entry.mode === 'quick' && <PhotoDevelopQuickSettings messages={messages} disabled={busy || props.dirty} isCurrent={dialogCurrent}
				onApply={(type, changes) => { if (dialogCurrent()) run(() => invoke('relative', source.catalogId, props.selectedIds, type, changes, messages.quickLabel), true); }} />}
			{entry.mode === 'presets' && <>
				<label>{messages.choosePreset}<select aria-label={messages.choosePreset} value={presetId} disabled={busy} onChange={event => { if (interactive()) setPresetId(event.currentTarget.value); }}>
					<option value="">{messages.noPreset}</option>{menu?.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name} ({preset.scope === 'full' ? messages.full : messages.partial})</option>)}</select></label>
				<label>{messages.presetName}<input aria-label={messages.presetName} value={presetName} maxLength={256} disabled={busy}
					onChange={event => { if (interactive()) setPresetName(event.currentTarget.value); }} /></label>
				<button type="button" disabled={busy || !menu || !presetName.trim() || menu.presets.length >= 16} onClick={() => {
					if (dialogCurrent()) run(() => invoke('savePreset', source, selection, presetName));
				}}>{messages.savePreset}</button>
				<button type="button" disabled={busy || props.dirty || !selected} onClick={() => {
					if (dialogCurrent() && selected && menu) run(() => invoke('applyPreset', source, selected.id, menu.revision, messages.presetLabel), true);
				}}>{messages.applyPreset}</button>
				<button type="button" disabled={busy || !selected || !presetName.trim()} onClick={() => {
					if (dialogCurrent() && selected && menu) run(() => invoke('renamePreset', source.catalogId, selected.id, menu.revision, presetName));
				}}>{messages.renamePreset}</button>
				<button type="button" disabled={busy || !selected} onClick={() => {
					if (dialogCurrent() && selected && menu) run(() => invoke('deletePreset', source.catalogId, selected.id, menu.revision));
				}}>{messages.deletePreset}</button>
				<button type="button" disabled={busy} onClick={() => { if (dialogCurrent()) run(() => invoke('listPresets', source.catalogId)); }}>{messages.reloadPresets}</button>
			</>}
		<button type="button" disabled={!snapshot.busy} onClick={() => { if (dialogCurrent() && owner.snapshot() === snapshot) void owner.cancel(); }}>{messages.cancel}</button>
			<button type="button" onClick={close}>{messages.close}</button>
		</AudioEditorDialogShell>}
	</>;
}
