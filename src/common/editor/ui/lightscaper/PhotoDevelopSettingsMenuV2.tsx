/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopSettingsCopy } from '../../../i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopCopy } from '../../../i18n/lightscaper-develop-copy.ts';
import type { PhotoDevelopResolutionV1 } from '../../photo-library-develop-full-resolution-port-v1.ts';
import type { PhotoLibraryDevelopSettingsWorkflowV2, PhotoDevelopSettingsSourceV2, PhotoDevelopSettingsWorkflowSnapshotV2 } from '../../controller/shared/photo-library-develop-settings-workflow-v2.ts';
import type { ImageDevelopSelectionV1 } from '../../imaging/image-develop-settings-contract-v1.ts';
import PhotoDevelopSettingsPickerV2 from './PhotoDevelopSettingsPickerV2.tsx';
import PhotoDevelopQuickSettings from './PhotoDevelopQuickSettings.tsx';
import { photoDevelopLocalAdjustmentsCopy } from '../../../i18n/lightscaper-develop-local-adjustments-copy.ts';
import { photoDevelopBrushMaskCopy } from '../../../i18n/lightscaper-develop-brush-mask-copy.ts';
import { photoDevelopMaskManagementCopy } from '../../../i18n/lightscaper-develop-mask-management-copy.ts';

export interface PhotoDevelopSettingsMenuPropsV2 {
	readonly locale: string; readonly owner: PhotoLibraryDevelopSettingsWorkflowV2; readonly snapshot: PhotoDevelopSettingsWorkflowSnapshotV2;
	readonly source: PhotoDevelopSettingsSourceV2; readonly selectedIds: readonly string[]; readonly disabled: boolean; readonly dirty: boolean;
	readonly isCurrent: () => boolean; readonly onChanged: () => Promise<unknown>;
	readonly resolution?: Readonly<{ value: PhotoDevelopResolutionV1; fullAvailable: boolean; onChange: (value: PhotoDevelopResolutionV1) => void }>;
	readonly localAdjustments?: Readonly<{ onOpen: (kind: 'linear-gradient' | 'radial-gradient' | 'luminance-range' | 'color-range' | 'brush' | 'masks') => void }>;
}
type Mode = 'copy' | 'sync' | 'auto' | 'quick' | 'presets';

export default function PhotoDevelopSettingsMenuV2(props: PhotoDevelopSettingsMenuPropsV2) {
	const { owner, snapshot, source } = props, messages = photoDevelopSettingsCopy(props.locale);
	const previewMessages = photoDevelopCopy(props.locale);
	const [entry, setEntry] = useState<Readonly<{ mode: Mode }> | null>(null);
	const [selection, setSelection] = useState<ImageDevelopSelectionV1>({ effectTypes: 'all', geometry: true, localAdjustments: true });
	const [presetName, setPresetName] = useState(''), [presetId, setPresetId] = useState('');
	const active = useRef(entry), live = useRef(true), owned = useRef(owner); owned.current = owner;
	useEffect(() => { live.current = true; return () => { live.current = false; active.current = null; }; }, [owner]);
	const current = () => live.current && owned.current === owner && props.isCurrent();
	const dialogCurrent = () => current() && entry !== null && active.current === entry;
	const interactive = () => dialogCurrent() && owner.snapshot() === snapshot;
	const busy = props.disabled || snapshot.busy;
	const run = (action: () => Promise<unknown>, refresh = false) => {
		if (!current() || owner.snapshot() !== snapshot || busy) return;
		void action().then(async result => { if (result && refresh && current()) await props.onChanged(); }).catch(() => undefined);
	};
	const open = (mode: Mode) => {
		if (!current() || busy || active.current) return; const next = Object.freeze({ mode }); active.current = next; setEntry(next);
		if (mode === 'presets') run(() => owner.listPresets(source.catalogId));
	};
	const close = () => { if (!dialogCurrent()) return; active.current = null; setEntry(null); };
	const menu = snapshot.presets?.catalogId === source.catalogId ? snapshot.presets : null;
	const selected = menu?.presets.find(preset => preset.id === presetId);
	const modes = { copy: messages.copy, sync: messages.sync, auto: messages.auto, quick: messages.quick, presets: messages.presets };
	return <>
		<details className="lightscaper-develop-settings-menu"><summary>{messages.menu}</summary>
			{props.resolution && <>
				<button type="button" disabled={busy} aria-pressed={props.resolution.value === 'proxy'}
					onClick={() => { if (current() && !busy) props.resolution?.onChange('proxy'); }}>{previewMessages.fitResolution}</button>
				<button type="button" disabled={busy || !props.resolution.fullAvailable} aria-pressed={props.resolution.value === 'full'}
					onClick={() => { if (current() && !busy && props.resolution?.fullAvailable) props.resolution.onChange('full'); }}>{previewMessages.fullResolution}</button>
			</>}
			{props.localAdjustments && (['linear-gradient', 'radial-gradient', 'luminance-range', 'color-range'] as const).map(kind => <button key={kind} type="button" disabled={busy} onClick={() => {
				if (current() && !busy && !active.current) props.localAdjustments?.onOpen(kind);
			}}>{photoDevelopLocalAdjustmentsCopy(props.locale, kind).menu}</button>)}
			{props.localAdjustments && <button type="button" disabled={busy} onClick={() => {
				if (current() && !busy && !active.current) props.localAdjustments?.onOpen('brush');
			}}>{photoDevelopBrushMaskCopy(props.locale).menu}</button>}
			{props.localAdjustments && <button type="button" disabled={busy} onClick={() => {
				if (current() && !busy && !active.current) props.localAdjustments?.onOpen('masks');
			}}>{photoDevelopMaskManagementCopy(props.locale).menu}</button>}
			<button type="button" disabled={busy} onClick={() => { open('copy'); }}>{messages.copy}</button>
			<button type="button" disabled={busy || props.dirty || !snapshot.clipboard} onClick={() => { run(() => owner.paste(source, messages.pasteLabel), true); }}>{messages.paste}</button>
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
			{entry.mode !== 'quick' && <PhotoDevelopSettingsPickerV2 value={selection} disabled={busy} messages={messages}
				isCurrent={interactive} onChange={setSelection} />}
			{entry.mode === 'copy' && <button type="button" disabled={busy} onClick={() => {
				if (!dialogCurrent()) return; run(async () => { await owner.copy(source, selection); close(); });
			}}>{messages.confirmCopy}</button>}
			{entry.mode === 'sync' && <button type="button" disabled={busy || props.dirty} onClick={() => {
				if (dialogCurrent()) run(() => owner.sync(source, props.selectedIds, selection, messages.syncLabel), true);
			}}>{messages.confirmSync}</button>}
			{entry.mode === 'auto' && <><p>{messages.autoPolicy}</p><button type="button" disabled={busy || props.dirty} onClick={() => {
				if (!dialogCurrent()) return; run(async () => { await owner.armAutoSync(source, props.selectedIds, selection); close(); });
			}}>{messages.confirmAuto}</button></>}
			{entry.mode === 'quick' && <PhotoDevelopQuickSettings messages={messages} disabled={busy || props.dirty} isCurrent={dialogCurrent}
				onApply={(type, changes) => { if (dialogCurrent()) run(() => owner.relative(source.catalogId, props.selectedIds, type, changes, messages.quickLabel), true); }} />}
			{entry.mode === 'presets' && <>
				<label>{messages.choosePreset}<select aria-label={messages.choosePreset} value={presetId} disabled={busy} onChange={event => { if (interactive()) setPresetId(event.currentTarget.value); }}>
					<option value="">{messages.noPreset}</option>{menu?.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name} ({preset.scope === 'full' ? messages.full : messages.partial})</option>)}</select></label>
				<label>{messages.presetName}<input aria-label={messages.presetName} value={presetName} maxLength={256} disabled={busy}
					onChange={event => { if (interactive()) setPresetName(event.currentTarget.value); }} /></label>
				<button type="button" disabled={busy || !menu || !presetName.trim() || menu.presets.length >= 16} onClick={() => {
					if (dialogCurrent()) run(() => owner.savePreset(source, selection, presetName));
				}}>{messages.savePreset}</button>
				<button type="button" disabled={busy || props.dirty || !selected} onClick={() => {
					if (dialogCurrent() && selected && menu) run(() => owner.applyPreset(source, selected.id, menu.revision, messages.presetLabel), true);
				}}>{messages.applyPreset}</button>
				<button type="button" disabled={busy || !selected || !presetName.trim()} onClick={() => {
					if (dialogCurrent() && selected && menu) run(() => owner.renamePreset(source.catalogId, selected.id, menu.revision, presetName));
				}}>{messages.renamePreset}</button>
				<button type="button" disabled={busy || !selected} onClick={() => {
					if (dialogCurrent() && selected && menu) run(() => owner.deletePreset(source.catalogId, selected.id, menu.revision));
				}}>{messages.deletePreset}</button>
				<button type="button" disabled={busy} onClick={() => { if (dialogCurrent()) run(() => owner.listPresets(source.catalogId)); }}>{messages.reloadPresets}</button>
			</>}
		<button type="button" disabled={!snapshot.busy} onClick={() => { if (dialogCurrent() && owner.snapshot() === snapshot) void owner.cancel(); }}>{messages.cancel}</button>
			<button type="button" onClick={close}>{messages.close}</button>
		</AudioEditorDialogShell>}
	</>;
}
