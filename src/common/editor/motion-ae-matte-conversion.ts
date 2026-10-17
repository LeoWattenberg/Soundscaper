/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeLayer, MotionAeReportEntry } from './motion-ae-exchange-types.ts';
import type { MotionLayer } from './motion-composition.ts';
import { compareRationals, type Rational } from './timeline-time.ts';
const maximum = (a: Rational, b: Rational) => compareRationals(a, b) >= 0 ? a : b;
const minimum = (a: Rational, b: Rational) => compareRationals(a, b) <= 0 ? a : b;

/** AE source visibility is independent of matte evaluation. Retain the original and create bounded per-consumer editable copies. */
export function convertMotionAeMattes(source: readonly MotionAeLayer[], mapped: readonly MotionLayer[], allocateId: () => string, report: MotionAeReportEntry[]): readonly MotionLayer[] {
	const indexById = new Map(source.map((layer, index) => [layer.id, index])), copies: MotionLayer[] = [];
	function bind(index: number, consumer: MotionLayer, depth: number): MotionLayer {
		const matte = source[index]!.matte; if (!matte) return { ...consumer, matte: null };
		if (depth > 32 || mapped.length + copies.length >= 256) throw new RangeError('AE matte copies exceed the Motion layer/depth budget. Render the complete composition in AE before importing.');
		const sourceIndex = indexById.get(matte.layerId)!; const original = mapped[sourceIndex]!;
		const inFrame = maximum(original.inFrame, consumer.inFrame), outFrame = minimum(original.outFrame, consumer.outFrame), overlaps = compareRationals(inFrame, outFrame) < 0;
		const copy: MotionLayer = { ...original, id: allocateId(), name: `${original.name.slice(0, 460)} (AE matte copy)`, enabled: consumer.enabled && overlaps,
			inFrame: overlaps ? inFrame : original.inFrame, outFrame: overlaps ? outFrame : original.outFrame, matte: null };
		// Reserve the copy before descending so a branching graph remains bounded.
		const slot = copies.length; copies.push(copy); copies[slot] = bind(sourceIndex, copy, depth + 1);
		return { ...consumer, matte: { layerId: copy.id, mode: matte.type } };
	}
	const layers = mapped.map((layer, index) => {
		const result = bind(index, layer, 0);
		if (source[index]!.matte) report.push({ scopeId: source[index]!.id, propertyPath: 'matte', code: 'matte-mapping', status: 'editable',
			message: 'The original source visibility is retained. An independent editable matte copy is clipped to this consumer’s imported active span; review both when changing timing or visibility. AE compositing/reference qualification remains pending.' });
		return result;
	});
	return [...layers, ...copies];
}
/** An AE track-matte source is hidden globally. Admit that only when Motion already hides it throughout its active span. */
export function exportMotionAeMattes(source: readonly MotionLayer[], mapped: readonly MotionAeLayer[], report: MotionAeReportEntry[]): readonly MotionAeLayer[] {
	const indexById = new Map(source.map((layer, index) => [layer.id, index])), hidden = new Set<number>(), refused = new Set<number>();
	for (let index = 0; index < source.length; index++) {
		const layer = source[index]!; if (!source.some(consumer => consumer.matte?.layerId === layer.id)) continue;
		const intervals = source.filter((consumer, i) => consumer.matte?.layerId === layer.id && consumer.enabled && mapped[i]!.enabled).map(consumer => ({ begin: consumer.inFrame, end: consumer.outFrame }))
			.sort((a, b) => compareRationals(a.begin, b.begin));
		let covered = layer.inFrame;
		for (const interval of intervals) { if (compareRationals(interval.begin, covered) > 0) break; covered = maximum(covered, interval.end); }
		if (!layer.enabled || !mapped[index]!.enabled || compareRationals(covered, layer.outFrame) < 0) refused.add(index); else hidden.add(index);
	}
	return mapped.map((layer, index) => {
		const matte = source[index]!.matte; let mappedMatte: MotionAeLayer['matte'] = null;
		if (matte) {
			const sourceIndex = indexById.get(matte.layerId)!;
			if (refused.has(sourceIndex)) report.push({ scopeId: layer.id, propertyPath: 'matte', code: 'matte-mapping', status: 'unsupported',
				message: 'The Motion matte source is disabled, unmapped, or also visible outside its consumer spans. An always-hidden AE source would change that visibility; render this composition or align its matte spans explicitly. Original intent remains in original.mscape.' });
			else {
				mappedMatte = { layerId: mapped[sourceIndex]!.id, type: matte.mode };
				report.push({ scopeId: layer.id, propertyPath: 'matte', code: 'matte-mapping', status: 'editable', message: 'Matte source identity and mode are mapped using AE 23+ setTrackMatte without rearranging layers. Source visibility is explicitly hidden; installed-host/reference qualification remains pending.' });
			}
		}
		return { ...layer, matte: mappedMatte, enabled: hidden.has(index) ? false : layer.enabled };
	});
}
