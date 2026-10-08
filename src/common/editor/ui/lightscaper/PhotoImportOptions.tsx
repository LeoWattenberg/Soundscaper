/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState, type ReactNode } from 'react';
import type { PhotoLibraryImportSettingsV1 } from '../../photo-library-import-settings-port-v1.ts';
import './photo-import-options.css';

const DEFAULT_RENAME = Object.freeze({ template: '{stem}-{sequence}.{extension}', sequenceStart: 1, sequencePadding: 3 });

export interface PhotoImportOptionsCopyV1 {
	readonly photoImportOptions: string;
	readonly photoImportRename: string;
	readonly photoImportNameTemplate: string;
	readonly photoImportSequenceStart: string;
	readonly photoImportSequencePadding: string;
	readonly photoImportMetadataHelp: string;
	readonly photoImportOverride: string;
	readonly photoMetadataTitle: string;
	readonly photoCaption: string;
	readonly photoCreator: string;
	readonly photoCopyright: string;
	readonly photoLocation: string;
}

export interface PhotoImportOptionsPropsV1 {
	readonly value: PhotoLibraryImportSettingsV1;
	readonly onChange: (next: PhotoLibraryImportSettingsV1) => void;
	readonly busy: boolean;
	readonly copy: PhotoImportOptionsCopyV1;
	readonly children?: ReactNode;
}

/** Controlled authored choices; no source metadata, original body or resource owner lives here. */
export default function PhotoImportOptions({ value, onChange, busy, copy, children }: PhotoImportOptionsPropsV1) {
	const [open, setOpen] = useState(false);
	const update = (next: PhotoLibraryImportSettingsV1) => {
		if (busy) return;
		onChange(Object.freeze({ rename: next.rename === null ? null : Object.freeze({ ...next.rename }),
			metadata: Object.freeze({ ...next.metadata }), keywordIds: Object.freeze([...next.keywordIds]) }));
	};
	const fields = [['title', copy.photoMetadataTitle], ['caption', copy.photoCaption], ['creator', copy.photoCreator],
		['copyright', copy.photoCopyright], ['location', copy.photoLocation]] as const;
	return <details className="lightscaper-import-options" data-photo-import-options open={open}
		onToggle={event => { setOpen(event.currentTarget.open); }}>
		<summary>{copy.photoImportOptions}</summary>
		{open && <fieldset disabled={busy}>
			<label className="lightscaper-import-option-toggle"><input type="checkbox" data-import-rename checked={value.rename !== null}
				onChange={event => { update({ ...value, rename: event.currentTarget.checked ? DEFAULT_RENAME : null }); }} />{copy.photoImportRename}</label>
			{value.rename !== null && <>
				<label>{copy.photoImportNameTemplate}<input data-import-template value={value.rename.template} required maxLength={256}
					onChange={event => { update({ ...value, rename: { ...value.rename!, template: event.currentTarget.value } }); }} /></label>
				<label>{copy.photoImportSequenceStart}<input type="number" data-import-sequence-start required min={1} max={Number.MAX_SAFE_INTEGER} step={1}
					value={Number.isFinite(value.rename.sequenceStart) ? value.rename.sequenceStart : ''}
					onChange={event => { update({ ...value, rename: { ...value.rename!, sequenceStart: event.currentTarget.valueAsNumber } }); }} /></label>
				<label>{copy.photoImportSequencePadding}<input type="number" data-import-sequence-padding required min={1} max={16} step={1}
					value={Number.isFinite(value.rename.sequencePadding) ? value.rename.sequencePadding : ''}
					onChange={event => { update({ ...value, rename: { ...value.rename!, sequencePadding: event.currentTarget.valueAsNumber } }); }} /></label>
			</>}
			<p>{copy.photoImportMetadataHelp}</p>
			{fields.map(([key, label]) => {
				const enabled = Object.hasOwn(value.metadata, key);
				const change = (text: string) => { if (enabled) update({ ...value, metadata: { ...value.metadata, [key]: text } }); };
				return <div key={key}>
					<label className="lightscaper-import-option-toggle"><input type="checkbox" data-import-override={key} checked={enabled}
						onChange={event => {
							const metadata = { ...value.metadata };
							if (event.currentTarget.checked) metadata[key] = '';
							else delete metadata[key];
							update({ ...value, metadata });
						}} />{copy.photoImportOverride.replace('{field}', label)}</label>
					<label>{label}{key === 'caption' || key === 'copyright'
						? <textarea data-import-metadata={key} disabled={!enabled} maxLength={16_384} value={value.metadata[key] ?? ''} onChange={event => { change(event.currentTarget.value); }} />
						: <input data-import-metadata={key} disabled={!enabled} maxLength={16_384} value={value.metadata[key] ?? ''} onChange={event => { change(event.currentTarget.value); }} />}</label>
				</div>;
			})}
			{children}
		</fieldset>}
	</details>;
}
