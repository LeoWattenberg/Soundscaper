/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionAeSelectedFont } from '../../motion-ae-font-import.ts';
import type { MotionAsset } from '../../motion-asset.ts';
export interface MotionAeTextReview { readonly enabled: boolean; readonly spacing: number; readonly colorSpace: 'srgb' | 'linear-rec709-d65' }
interface Common { readonly copy: Readonly<Record<string, string>>; readonly disabled: boolean; readonly value: MotionAeTextReview; readonly onChange: (value: MotionAeTextReview) => void }
function Settings({ copy, disabled, value, onChange, mode }: Common & { mode: 'import' | 'export' }) {
	return <><p>{copy.motionscaperAeTextReviewHint}</p>
		<label><input type="checkbox" disabled={disabled} checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.currentTarget.checked })} />{mode === 'import' ? copy.motionscaperAeTextEnableImport : copy.motionscaperAeTextEnableExport}</label>
		<label>{mode === 'import' ? copy.motionscaperAeTextLineHeight : copy.motionscaperAeTextLeading}<input type="number" min="0.01" max={mode === 'import' ? 100 : 1000000} step="0.01" disabled={disabled || !value.enabled} value={value.spacing} onChange={event => onChange({ ...value, spacing: event.currentTarget.valueAsNumber })} /></label>
		<label>{copy.motionscaperAeTextColor}<select disabled={disabled || !value.enabled} value={value.colorSpace} onChange={event => onChange({ ...value, colorSpace: event.currentTarget.value === 'srgb' ? 'srgb' : 'linear-rec709-d65' })}>
			<option value="srgb">{copy.motionscaperAeTextSrgb}</option><option value="linear-rec709-d65">{copy.motionscaperAeTextLinear}</option>
		</select></label>
	</>;
}
export function MotionAeTextImportOptions({ copy, disabled, value, onChange, fonts, onFonts }: Common & { fonts: readonly MotionAeSelectedFont[]; onFonts: (value: readonly MotionAeSelectedFont[]) => void }) {
	const [name, setName] = useState(''), [file, setFile] = useState<File | null>(null);
	return <details><summary>{copy.motionscaperAeTextImportOptions}</summary><fieldset disabled={disabled}>
		<Settings copy={copy} disabled={disabled} value={value} onChange={onChange} mode="import" />
		<p>{copy.motionscaperAeTextFontHint}</p><label>{copy.motionscaperAeTextPostScript}<input value={name} disabled={!value.enabled} onChange={event => setName(event.currentTarget.value)} /></label>
		<label>{copy.motionscaperAeTextFontFile}<input type="file" accept=".ttf,.otf,.woff,.woff2" disabled={!value.enabled} onChange={event => setFile(event.currentTarget.files?.[0] ?? null)} /></label>
		<Button variant="secondary" disabled={!value.enabled || !name || !file} onClick={() => { if (file) { onFonts([...fonts, { postScriptName: name, file, name: file.name, style: 'Selected face' }]); setName(''); setFile(null); } }}>{copy.motionscaperAeTextBindFont}</Button>
		{fonts.map((font, index) => <p key={index}>{font.postScriptName}: {font.name} <Button variant="secondary" onClick={() => onFonts(fonts.filter((_, current) => current !== index))}>{copy.motionscaperAeTextRemoveFont}</Button></p>)}
	</fieldset></details>;
}
export function MotionAeTextExportOptions({ copy, disabled, value, onChange, fonts, names, onName }: Common & {
	fonts: readonly Extract<MotionAsset, { kind: 'font' }>[]; names: Readonly<Record<string, string>>; onName: (id: string, value: string) => void;
}) {
	return <details><summary>{copy.motionscaperAeTextExportOptions}</summary><fieldset disabled={disabled}>
		<Settings copy={copy} disabled={disabled} value={value} onChange={onChange} mode="export" /><p>{copy.motionscaperAeTextHostHint}</p>
		{fonts.map(font => <label key={font.id}>{copy.motionscaperAeTextPostScript} — {font.name}<input disabled={!value.enabled} value={names[font.id] ?? ''} onChange={event => onName(font.id, event.currentTarget.value)} /></label>)}
	</fieldset></details>;
}
