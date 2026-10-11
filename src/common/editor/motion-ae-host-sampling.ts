/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeProperty, MotionAeReportEntry } from './motion-ae-exchange-types.ts';
import type { MotionAeHostPropertyBudget } from './motion-ae-host-property.ts';

/** User-selected installed-AE operation. A native valueAtTime call cannot be preempted by this loop. */
export function sampleMotionAeNumericProperty(
	property: Extract<MotionAeProperty, { kind: 'numeric' }>,
	source: { valueAtTime(time: number, preExpression: boolean): unknown },
	clock: Readonly<{ frameRate: number; duration: number }>, checkCancelled: () => void,
	layerId: string, path: string, report: MotionAeReportEntry[], budget: MotionAeHostPropertyBudget,
): Extract<MotionAeProperty, { kind: 'numeric' }> {
	if (!isFinite(clock.frameRate) || clock.frameRate <= 0 || clock.frameRate > 1000 || !isFinite(clock.duration) || clock.duration <= 0) throw new Error('AE sampling clock is invalid.');
	const count = Math.ceil(clock.duration * clock.frameRate) + 1;
	if (count > 4096 || budget.keys + count > 262_144) throw new Error('AE sampling key budget exceeded. Shorten the composition or render it in AE.');
	budget.keys += count;
	const values: number[][] = [];
	for (let frame = 0; frame < count; frame++) {
		checkCancelled(); const raw = source.valueAtTime(frame / clock.frameRate, false);
		const value = typeof raw === 'number' ? [raw] : raw as readonly number[];
		if (Object.prototype.toString.call(value) !== '[object Array]' || value.length !== property.value.length) throw new Error('AE sampled dimension changed.');
		const copy: number[] = [];
		for (let axis = 0; axis < value.length; axis++) {
			const channel = value[axis]!;
			if (typeof channel !== 'number' || !isFinite(channel) || Math.abs(channel) > 1e12) throw new Error('AE sampled value must be finite and within the exchange range.');
			copy.push(channel);
		}
		values.push(copy);
	}
	checkCancelled();
	const expression = property.expression === null ? null : { source: property.expression.source, enabled: property.expression.enabled,
		disposition: property.expression.enabled ? 'sampled' as const : property.expression.disposition };
	if (expression?.enabled) {
		for (let index = report.length - 1; index >= 0; index--) {
			const entry = report[index]!;
			if (entry.scopeId === layerId && entry.propertyPath === path && entry.code === 'expression') report.splice(index, 1);
		}
	}
	report.push({ scopeId: layerId, propertyPath: path, status: 'sampled', code: expression?.enabled ? 'expression' : 'frame-sampling',
		message: 'Evaluated explicitly in AE at ' + String(clock.frameRate) + ' frames per second, including the terminal grid point. Authored keys and expression text remain retained. Subframe motion and motion blur are not preserved by these samples.' });
	return { kind: property.kind, name: property.name, matchName: property.matchName, value: property.value, spatial: property.spatial,
		keys: property.keys, expression, samples: { frameRate: clock.frameRate, firstFrame: 0, values } };
}
