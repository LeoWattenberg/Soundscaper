/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImportSettingsV1 } from '../../photo-library-import-settings-port-v1.ts';

type Rename = NonNullable<PhotoLibraryImportSettingsV1['rename']>;
export interface PhotoNameTemplateFieldsCopyV1 {
	readonly photoImportNameTemplate: string;
	readonly photoImportSequenceStart: string;
	readonly photoImportSequencePadding: string;
}
export interface PhotoNameTemplateFieldsPropsV1 {
	readonly value: Rename;
	readonly onChange: (next: Rename) => void;
	readonly busy: boolean;
	readonly copy: PhotoNameTemplateFieldsCopyV1;
	readonly dataPrefix: 'import' | 'batch-rename';
}

/** Only authored form scalars; template grammar and expansion stay product-owned. */
export default function PhotoNameTemplateFields({ value, onChange, busy, copy, dataPrefix }: PhotoNameTemplateFieldsPropsV1) {
	const update = (next: Rename) => { if (!busy) onChange(Object.freeze({ ...next })); };
	const attribute = (field: string) => ({ [`data-${dataPrefix}-${field}`]: true });
	return <>
		<label>{copy.photoImportNameTemplate}<input {...attribute('template')} value={value.template} required maxLength={256} disabled={busy}
			onChange={event => { update({ ...value, template: event.currentTarget.value }); }} /></label>
		<label>{copy.photoImportSequenceStart}<input {...attribute('sequence-start')} type="number" required min={1} max={Number.MAX_SAFE_INTEGER} step={1}
			value={Number.isFinite(value.sequenceStart) ? value.sequenceStart : ''} disabled={busy}
			onChange={event => { update({ ...value, sequenceStart: event.currentTarget.valueAsNumber }); }} /></label>
		<label>{copy.photoImportSequencePadding}<input {...attribute('sequence-padding')} type="number" required min={1} max={16} step={1}
			value={Number.isFinite(value.sequencePadding) ? value.sequencePadding : ''} disabled={busy}
			onChange={event => { update({ ...value, sequencePadding: event.currentTarget.valueAsNumber }); }} /></label>
	</>;
}
