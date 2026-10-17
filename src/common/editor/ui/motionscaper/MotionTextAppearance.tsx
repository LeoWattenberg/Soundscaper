/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionAsset } from '../../motion-asset.ts';
import type { MotionTextDocument, MotionTextRun } from '../../motion-composition.ts';
import { motionColor, motionScalar } from '../../motion-property.ts';
import type { MotionscaperAppearanceEdit } from '../../../../motionscaper/editor-appearance-commands.ts';
import { MotionAppearanceColor, MotionAppearanceNumber, type MotionAppearanceCopy } from './MotionAppearanceFields.tsx';
import { parseMotionNumberInput } from './motion-exact-input.ts';
type Props = Readonly<{ copy: MotionAppearanceCopy; document: MotionTextDocument; fonts: readonly MotionAsset[]; revision: number; disabled: boolean;
	onEdit: (edit: MotionscaperAppearanceEdit) => void; onError: (error: unknown) => void; onImportFont: (file: File, style: string, edit: Extract<MotionscaperAppearanceEdit, { type: 'text-run' }>) => void }>;
export default function MotionTextAppearance(props: Props) {
	const { copy, document, disabled, onEdit } = props; const [selected, setSelected] = useState(0); const index = Math.min(selected, document.runs.length - 1), run = document.runs[index]!;
	return <section>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperTextContent}</legend>
			<label>{copy.motionscaperTextRun}<select value={index} onChange={event => setSelected(Number(event.currentTarget.value))}>{document.runs.map((value, offset) => <option key={offset} value={offset}>{offset + 1}: {value.text.slice(0, 40)}</option>)}</select></label>
			<Button variant="secondary" onClick={() => { onEdit({ type: 'add-text-run', index: index + 1, run: { text: '', fontAssetId: run.fontAssetId, fontSize: motionScalar(run.fontSize.value), color: motionColor(run.color.value), tracking: motionScalar(run.tracking.value) } }); setSelected(index + 1); }}>{copy.motionscaperAddTextRun}</Button>
			<Button variant="secondary" disabled={document.runs.length <= 1} onClick={() => { onEdit({ type: 'remove-text-run', index }); setSelected(Math.max(0, index - 1)); }}>{copy.motionscaperRemoveTextRun}</Button>
			<Button variant="secondary" disabled={index === 0} onClick={() => { onEdit({ type: 'move-text-run', index, toIndex: index - 1 }); setSelected(index - 1); }}>{copy.motionscaperMoveEarlier}</Button>
			<Button variant="secondary" disabled={index === document.runs.length - 1} onClick={() => { onEdit({ type: 'move-text-run', index, toIndex: index + 1 }); setSelected(index + 1); }}>{copy.motionscaperMoveLater}</Button>
		</fieldset>
		<TextRunForm key={`${index}/${props.revision}`} {...props} run={run} index={index} />
		<TextLayoutForm key={`layout/${props.revision}`} {...props} />
	</section>;
}
function TextRunForm({ copy, run, index, fonts, disabled, onEdit, onError, onImportFont }: Props & Readonly<{ run: MotionTextRun; index: number }>) {
	const [text, setText] = useState(run.text); const [font, setFont] = useState(run.fontAssetId); const [size, setSize] = useState(String(run.fontSize.value));
	const [tracking, setTracking] = useState(String(run.tracking.value)); const [color, setColor] = useState(run.color.value); const [style, setStyle] = useState('Regular');
	const draft = (): Extract<MotionscaperAppearanceEdit, { type: 'text-run' }> => ({ type: 'text-run', index, text, fontAssetId: font, fontSize: parseMotionNumberInput(size), tracking: parseMotionNumberInput(tracking), color });
	const submit = () => { try { onEdit(draft()); } catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperTextRun} {index + 1}</legend>
		<label>{copy.motionscaperTextContent}<textarea value={text} maxLength={65536} onChange={event => setText(event.currentTarget.value)} /></label>
		<label>{copy.motionscaperRetainedFont}<select value={font} onChange={event => setFont(event.currentTarget.value)}>{fonts.map(asset => <option key={asset.id} value={asset.id}>{asset.kind === 'font' ? `${asset.family} — ${asset.style}` : asset.name}</option>)}</select></label>
		<MotionAppearanceNumber label={copy.motionscaperFontSize} value={size} min={1} max={4096} onChange={setSize} /><MotionAppearanceNumber label={copy.motionscaperTextTracking} value={tracking} onChange={setTracking} />
		<MotionAppearanceColor copy={copy} value={color} onChange={setColor} />
		<Button variant="secondary" onClick={submit}>{copy.motionscaperApplyText}</Button>
		<label>{copy.motionscaperFontStyleName}<input value={style} maxLength={512} onChange={event => setStyle(event.currentTarget.value)} /></label>
		<label>{copy.motionscaperFontImport}<input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) { try { onImportFont(file, style, draft()); } catch (error) { onError(error); } } }} /></label><p>{copy.motionscaperFontImportHint}</p>
	</fieldset>;
}
function TextLayoutForm({ copy, document, disabled, onEdit, onError }: Props) {
	const [align, setAlign] = useState(document.align); const [lineHeight, setLineHeight] = useState(String(document.lineHeight.value));
	const [width, setWidth] = useState(String(document.boxSize.value[0])), [height, setHeight] = useState(String(document.boxSize.value[1]));
	const submit = () => { try { onEdit({ type: 'text-layout', align, lineHeight: parseMotionNumberInput(lineHeight), boxSize: [parseMotionNumberInput(width), parseMotionNumberInput(height)] }); } catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperTextLayout}</legend>
		<label>{copy.motionscaperTextAlignment}<select value={align} onChange={event => setAlign(event.currentTarget.value as typeof align)}>{(['left', 'center', 'right', 'justify'] as const).map(value => <option key={value} value={value}>{copy[`motionscaperTextAlign_${value}`]}</option>)}</select></label>
		<MotionAppearanceNumber label={copy.motionscaperTextLineHeight} value={lineHeight} onChange={setLineHeight} min={0.01} /><MotionAppearanceNumber label={copy.motionscaperWidth} value={width} onChange={setWidth} min={1} /><MotionAppearanceNumber label={copy.motionscaperHeight} value={height} onChange={setHeight} min={1} />
		<Button variant="secondary" onClick={submit}>{copy.motionscaperApplyTextLayout}</Button>
	</fieldset>;
}
