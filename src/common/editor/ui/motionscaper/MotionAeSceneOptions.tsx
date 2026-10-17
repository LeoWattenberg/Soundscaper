/* SPDX-License-Identifier: AGPL-3.0-only */
export interface MotionAeSceneSelection { readonly enabled: boolean; readonly colorSpace: 'linear-rec709-d65' | 'srgb' }
export default function MotionAeSceneOptions({ copy, disabled, value, onChange, mode }: Readonly<{
	copy: Readonly<Record<string, string>>; disabled: boolean; value: MotionAeSceneSelection; onChange: (value: MotionAeSceneSelection) => void; mode: 'import' | 'export';
}>) {
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperAeSceneReview}</legend>
		<p>{copy.motionscaperAeSceneHint}</p>
		<label><input type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.currentTarget.checked })} />{mode === 'import' ? copy.motionscaperAeSceneImport : copy.motionscaperAeSceneExport}</label>
		<label>{mode === 'import' ? copy.motionscaperAeSceneImportColor : copy.motionscaperAeSceneExportColor}<select disabled={!value.enabled} value={value.colorSpace} onChange={event => {
			const colorSpace = event.currentTarget.value; if (colorSpace === 'srgb' || colorSpace === 'linear-rec709-d65') onChange({ ...value, colorSpace });
		}}><option value="srgb">{copy.motionscaperAeTextSrgb}</option><option value="linear-rec709-d65">{copy.motionscaperAeTextLinear}</option></select></label>
	</fieldset>;
}
