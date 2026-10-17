/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeTextLayout } from './motion-ae-exchange-types.ts';
import { motionArray, motionEnum, motionNumber, motionRecord } from './motion-values.ts';
/** Layer-local box origin remains separate from layer transforms. */
export function normalizeMotionAeTextLayout(value: unknown): MotionAeTextLayout {
	const candidate = motionRecord(value, ['kind', 'orientation', 'size', 'position'], 'AE text layout', ['kind']);
	const kind = motionEnum(candidate.kind, ['point', 'box'], 'AE text layout kind');
	const record = motionRecord(value, kind === 'box' ? ['kind', 'orientation', 'size', 'position'] : ['kind', 'orientation'], 'AE text layout');
	const orientation = motionEnum(record.orientation, ['horizontal', 'vertical-right-to-left', 'vertical-left-to-right'], 'AE text orientation');
	if (kind === 'point') return { kind, orientation };
	const pair = (input: unknown, label: string, minimum: number): readonly [number, number] => {
		const values = motionArray(input, 2, label, 2); return [motionNumber(values[0], label, minimum, 1e6), motionNumber(values[1], label, minimum, 1e6)];
	};
	return { kind, orientation, size: pair(record.size, 'AE text box size', 1), position: pair(record.position, 'AE text box position', -1e6) };
}
