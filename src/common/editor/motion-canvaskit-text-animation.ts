/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Canvas, CanvasKit, GlyphRun, ShapedLine } from 'canvaskit-wasm';
import type { MotionTextDocument } from './motion-composition.ts';
import type { EvaluatedMotionState } from './motion-property-evaluation.ts';
import { motionTextSelectorWeight, type MotionEvaluatedTextAnimator } from './motion-text-animation.ts';
import type { MotionColor } from './motion-property.ts';

interface Group { readonly run: GlyphRun; readonly first: number; readonly last: number; readonly offset: number; readonly line: number; readonly x: number; readonly y: number }
interface Unit { readonly index: number; readonly count: number; readonly x: number; readonly y: number; readonly tracking: number }
type Matrix = readonly [number, number, number, number, number, number];
interface Batch { readonly matrix: Matrix; readonly color: MotionColor; readonly groups: Group[] }

/** Draw original shaped glyphs with their actual fallback typefaces; never reshape individual letters or code units. */
export function drawMotionAnimatedParagraph(kit: CanvasKit, canvas: Canvas, lines: readonly ShapedLine[], document: EvaluatedMotionState<MotionTextDocument>, signal?: AbortSignal): void {
	const groups: Group[] = [];
	for (let line = 0; line < lines.length; line++) for (const run of lines[line]!.runs) {
		for (let first = 0; first < run.glyphs.length;) {
			let last = first + 1; while (last < run.glyphs.length && run.offsets[last] === run.offsets[first]) last++;
			groups.push({ run, first, last, offset: run.offsets[first]!, line, x: run.positions[first * 2]!, y: run.positions[first * 2 + 1]! }); first = last;
		}
	}
	const offsets = [...new Set(groups.map((group) => group.offset))].sort((a, b) => a - b);
	const clusters = new Map(offsets.map((offset, index) => [offset, index]));
	const text = document.runs.map((run) => run.text).join('');
	const byteOffsets = utf8Offsets(text);
	const words = document.animators?.some((item) => item.enabled && item.selector.unit === 'word') ? [...new Intl.Segmenter('und', { granularity: 'word' }).segment(text)].filter((part) => part.isWordLike)
		.map((part) => ({ start: byteOffsets[part.index]!, end: byteOffsets[part.index + part.segment.length]! })) : [];
	const colors: { readonly start: number; readonly end: number; readonly color: MotionColor }[] = [];
	let start = 0;
	for (const run of document.runs) { const end = start + new TextEncoder().encode(run.text).length; colors.push({ start, end, color: run.color }); start = end; }
	const animators = (document.animators ?? []).filter((item) => item.enabled);
	const units = animators.map((animator) => unitsFor(animator, groups, clusters, words, lines.length));
	const batches: Batch[] = [];
	for (let i = 0; i < groups.length; i++) {
		signal?.throwIfAborted(); const group = groups[i]!;
		let color: MotionColor = colors.find((run) => group.offset >= run.start && group.offset < run.end)?.color ?? [0, 0, 0, 0];
		let matrix: Matrix = [1, 0, 0, 1, 0, 0]; let opacity = 1;
		for (let a = 0; a < animators.length; a++) {
			const animator = animators[a]!; const unit = units[a]![i]!; const weight = motionTextSelectorWeight(animator, unit.index, unit.count);
			matrix = multiply(animatorMatrix(animator, unit, weight), matrix);
			opacity *= 1 + (animator.opacity - 1) * weight;
			if (animator.color) color = color.map((v, c) => v + (animator.color![c]! - v) * weight) as unknown as MotionColor;
		}
		color = [color[0], color[1], color[2], color[3] * opacity];
		const previous = batches.at(-1);
		if (previous && matrix.every((v, c) => v === previous.matrix[c]) && color.every((v, c) => v === previous.color[c])) previous.groups.push(group);
		else batches.push({ matrix, color, groups: [group] });
	}
	for (const batch of batches) {
		signal?.throwIfAborted(); const paint = new kit.Paint(); const layerPaint = new kit.Paint();
		// Apply appearance after the white glyph coverage so text contrast and overlap cannot change unit opacity.
		const filter = kit.ColorFilter.MakeBlend(kit.Color4f(...batch.color), kit.BlendMode.SrcIn, kit.ColorSpace.SRGB);
		canvas.save();
		try {
			const [a, b, c, d, x, y] = batch.matrix; canvas.concat([a, c, x, b, d, y, 0, 0, 1]);
			canvas.clipRect(kit.XYWHRect(0, 0, ...document.boxSize), kit.ClipOp.Intersect, true);
			paint.setAntiAlias(true); paint.setColor(kit.WHITE, kit.ColorSpace.SRGB); layerPaint.setColorFilter(filter); canvas.saveLayer(layerPaint);
			try {
				for (let first = 0; first < batch.groups.length;) {
					const group = batch.groups[first]!; let end = first + 1; let last = group.last;
					while (end < batch.groups.length && batch.groups[end]!.run === group.run && batch.groups[end]!.first === last) { last = batch.groups[end]!.last; end++; }
					signal?.throwIfAborted();
					const font = new kit.Font(group.run.typeface, group.run.size, (group.run as GlyphRun & { readonly scaleX?: number }).scaleX ?? 1, 0);
					try {
						font.setHinting(kit.FontHinting.Slight); font.setEdging(kit.FontEdging.AntiAlias); font.setSubpixel(true);
						canvas.drawGlyphs(group.run.glyphs.slice(group.first, last), group.run.positions.slice(group.first * 2, last * 2), 0, 0, font, paint);
					} finally { font.delete(); }
					first = end;
				}
			} finally { canvas.restore(); }
		} finally { canvas.restore(); filter.delete(); layerPaint.delete(); paint.delete(); }
	}
}

function animatorMatrix(animator: MotionEvaluatedTextAnimator, unit: Unit, weight: number): Matrix {
	const sx = 1 + (animator.scale[0] - 1) * weight; const sy = 1 + (animator.scale[1] - 1) * weight;
	const angle = animator.rotation * weight * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle);
	const a = c * sx; const b = s * sx; const d = c * sy; const k = -s * sy;
	const x = unit.x + animator.anchor[0]; const y = unit.y + animator.anchor[1];
	return [a, b, k, d, animator.position[0] * weight + unit.tracking + (1 - a) * x - k * y, animator.position[1] * weight - b * x + (1 - d) * y];
}
function multiply(l: Matrix, r: Matrix): Matrix {
	return [l[0] * r[0] + l[2] * r[1], l[1] * r[0] + l[3] * r[1], l[0] * r[2] + l[2] * r[3], l[1] * r[2] + l[3] * r[3], l[0] * r[4] + l[2] * r[5] + l[4], l[1] * r[4] + l[3] * r[5] + l[5]];
}

function unitsFor(animator: MotionEvaluatedTextAnimator, groups: readonly Group[], clusters: ReadonlyMap<number, number>, words: readonly { readonly start: number; readonly end: number }[], lineCount: number): readonly Unit[] {
	const count = animator.selector.unit === 'cluster' ? clusters.size : animator.selector.unit === 'word' ? words.length : lineCount;
	const indices = groups.map((group) => animator.selector.unit === 'cluster' ? clusters.get(group.offset)! : animator.selector.unit === 'line' ? group.line : wordFor(words, group.offset));
	const anchors = new Map<number, readonly [number, number]>();
	for (let i = 0; i < groups.length; i++) { const index = indices[i]!; if (index < 0) continue; const own = groups[i]!; const old = anchors.get(index); if (!old || own.x < old[0]) anchors.set(index, [own.x, own.y]); }
	const tracking: number[] = []; let advance = 0;
	for (let index = 0; index < count; index++) { tracking.push(advance); advance += animator.tracking * motionTextSelectorWeight(animator, index, count); }
	return groups.map((group, i) => { const index = indices[i]!; const anchor = anchors.get(index) ?? [group.x, group.y]; return { index, count, x: anchor[0], y: anchor[1], tracking: index < 0 ? 0 : tracking[index]! }; });
}

function wordFor(words: readonly { readonly start: number; readonly end: number }[], offset: number): number {
	let first = 0; let last = words.length;
	while (first < last) { const mid = Math.floor((first + last) / 2); if (words[mid]!.start <= offset) first = mid + 1; else last = mid; }
	return first > 0 && offset < words[first - 1]!.end ? first - 1 : -1;
}

function utf8Offsets(text: string): readonly number[] {
	const offsets: number[] = [0]; let bytes = 0; let index = 0;
	for (const character of text) { offsets[index] = bytes; bytes += new TextEncoder().encode(character).length; index += character.length; offsets[index] = bytes; }
	return offsets;
}
