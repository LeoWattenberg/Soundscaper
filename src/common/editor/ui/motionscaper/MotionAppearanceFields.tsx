/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionColor } from '../../motion-property.ts';
import { decodeMotionChannel, encodeMotionChannel } from '../../motion-surface.ts';
export type MotionAppearanceCopy = Readonly<Record<string, string>>;
export function MotionAppearanceNumber({ label, value, onChange, min, max }: Readonly<{ label: string | undefined; value: string; onChange: (value: string) => void; min?: number; max?: number }>) {
	return <label>{label}<input type="number" step="any" value={value} min={min} max={max} onChange={event => onChange(event.currentTarget.value)} /></label>;
}
export function MotionAppearanceColor({ copy, value, onChange }: Readonly<{ copy: MotionAppearanceCopy; value: MotionColor; onChange: (value: MotionColor) => void }>) {
	const hex = `#${value.slice(0, 3).map(number => Math.round(255 * encodeMotionChannel(number, 'srgb')).toString(16).padStart(2, '0')).join('')}`;
	return <>
		<label>{copy.motionscaperColor}<input type="color" value={hex} onChange={event => { const next = event.currentTarget.value; const channel = (offset: number) => decodeMotionChannel(Number.parseInt(next.slice(offset, offset + 2), 16) / 255, 'srgb'); onChange([channel(1), channel(3), channel(5), value[3]]); }} /></label>
		<label>{copy.motionscaperColorAlpha}<input type="number" min={0} max={1} step="0.01" value={value[3]} onChange={event => onChange([value[0], value[1], value[2], Number(event.currentTarget.value)])} /></label>
	</>;
}
