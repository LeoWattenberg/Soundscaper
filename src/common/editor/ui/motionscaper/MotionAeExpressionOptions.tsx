/* SPDX-License-Identifier: AGPL-3.0-only */
export default function MotionAeExpressionOptions({ copy, disabled, enabled, onChange, mode }: Readonly<{
	copy: Readonly<Record<string, string>>; disabled: boolean; enabled: boolean; onChange: (value: boolean) => void; mode: 'import' | 'export';
}>) {
	return <><p>{copy.motionscaperAeExpressionHint}</p>
		<label><input type="checkbox" disabled={disabled} checked={enabled} onChange={event => onChange(event.currentTarget.checked)} />{mode === 'import' ? copy.motionscaperAeExpressionImport : copy.motionscaperAeExpressionExport}</label>
	</>;
}
