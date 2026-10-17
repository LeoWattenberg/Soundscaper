/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Canvas, CanvasKit, Path } from 'canvaskit-wasm';
import type { MotionLayer, MotionShape } from './motion-composition.ts';
import type { EvaluatedMotionState } from './motion-property-evaluation.ts';
import { motionCanvasKitPath } from './motion-canvaskit-path.ts';
import { withMotionCanvasKitPaint } from './motion-canvaskit-paint.ts';
import { MOTION_SHAPE_IDENTITY, inverseMotionShapeMatrix, motionRepeaterMatrix, multiplyMotionShapeMatrices, planMotionShapeOperators, type MotionShapeMatrix, type MotionEvaluatedShapeOperator } from './motion-shape-operator-plan.ts';

interface Record { readonly path: Path; readonly style: EvaluatedMotionState<MotionShape>; readonly matrix: MotionShapeMatrix; readonly opacity: number }

/** Ordered local geometry. Boolean appearance belongs to the first current shape, including its gradient coordinates. */
export function drawMotionCanvasKitShapes(kit: CanvasKit, canvas: Canvas, state: EvaluatedMotionState<Extract<MotionLayer, { kind: 'shapes' }>>, signal?: AbortSignal): void {
	planMotionShapeOperators(state);
	const owned = new Set<Path>();
	const own = (path: Path): Path => { owned.add(path); return path; };
	const drop = (path: Path): void => { if (owned.delete(path)) path.delete(); };
	try {
		let records = state.shapes.map((style): Record => ({ path: own(motionCanvasKitPath(kit, style.path)), style, matrix: MOTION_SHAPE_IDENTITY, opacity: 1 }));
		for (const operator of state.operators ?? []) {
			if (!operator.enabled) continue; signal?.throwIfAborted();
			if (operator.kind === 'repeater') {
				const next: Record[] = [];
				for (let index = 0; index < Math.ceil(operator.copies); index++) {
					const matrix = motionRepeaterMatrix(operator, index); const progress = operator.copies <= 1 ? 0 : Math.min(1, index / (operator.copies - 1));
					const opacity = (operator.startOpacity + (operator.endOpacity - operator.startOpacity) * progress) * Math.min(1, operator.copies - index);
					for (const record of records) next.push({ ...record, path: own(record.path.copy()), matrix: multiplyMotionShapeMatrices(matrix, record.matrix), opacity: record.opacity * opacity });
				}
				for (const record of records) drop(record.path); records = next;
			} else if (operator.kind === 'trim-paths') {
				const paths = records.map((record) => own(transformed(kit, record.path, record.matrix)));
				const lengths = paths.map((path) => length(kit, path)); const total = lengths.reduce((sum, v) => sum + v, 0); let start = 0;
				records = records.map((record, index) => {
					const result = own(trim(kit, paths[index]!, operator, operator.mode === 'simultaneous' ? start / total : 0, operator.mode === 'simultaneous' ? lengths[index]! / total : 1));
					start += lengths[index]!; const path = own(transformed(kit, result, inverseMotionShapeMatrix(record.matrix))); drop(result); drop(record.path); drop(paths[index]!); return { ...record, path };
				});
			} else if (records.length > 1) {
				if (records.reduce((sum, record) => sum + record.path.countPoints(), 0) > 512) throw new RangeError('Motion boolean input exceeds its 512-point intersection budget; simplify the shapes.');
				let combined = own(transformed(kit, records[0]!.path, records[0]!.matrix));
				for (const record of records.slice(1)) {
					const other = own(transformed(kit, record.path, record.matrix));
					const next = kit.Path.MakeFromOp(combined, other, { union: kit.PathOp.Union, subtract: kit.PathOp.Difference, intersect: kit.PathOp.Intersect, xor: kit.PathOp.XOR }[operator.mode]);
					if (!next) throw new Error('Motion boolean geometry could not be combined; simplify the paths.'); own(next); drop(combined); drop(other); combined = next;
					if (combined.countPoints() > 32768) throw new RangeError('Motion boolean output exceeds its point budget; simplify the shapes.');
				}
				const first = records[0]!; const path = own(transformed(kit, combined, inverseMotionShapeMatrix(first.matrix))); drop(combined);
				for (const record of records) drop(record.path); records = [{ ...first, path }];
			}
		}
		for (const record of records) {
			signal?.throwIfAborted(); if (!record.opacity) continue; canvas.save();
			const opacityPaint = record.opacity === 1 ? null : new kit.Paint(); let isolated = false;
			try {
				const [a, b, c, d, x, y] = record.matrix; canvas.concat([a, c, x, b, d, y, 0, 0, 1]);
				if (opacityPaint) { opacityPaint.setAlphaf(record.opacity); canvas.saveLayer(opacityPaint); isolated = true; }
				if (record.style.fill) withMotionCanvasKitPaint(kit, record.style.fill, (paint) => canvas.drawPath(record.path, paint));
				const stroke = record.style.stroke;
				if (stroke && stroke.width > 0) withMotionCanvasKitPaint(kit, stroke.color, (paint) => {
					paint.setStyle(kit.PaintStyle.Stroke); paint.setStrokeWidth(stroke.width); paint.setStrokeMiter(4);
					paint.setStrokeCap({ butt: kit.StrokeCap.Butt, round: kit.StrokeCap.Round, square: kit.StrokeCap.Square }[stroke.lineCap]);
					paint.setStrokeJoin({ miter: kit.StrokeJoin.Miter, round: kit.StrokeJoin.Round, bevel: kit.StrokeJoin.Bevel }[stroke.lineJoin]); canvas.drawPath(record.path, paint);
				});
			} finally { if (isolated) canvas.restore(); opacityPaint?.delete(); canvas.restore(); }
		}
	} finally { for (const path of owned) path.delete(); }
}
function transformed(kit: CanvasKit, path: Path, m: MotionShapeMatrix): Path {
	const builder = new kit.PathBuilder(); const [a, b, c, d, x, y] = m;
	try { if (!builder.addPath(path, [a, c, x, b, d, y, 0, 0, 1])) throw new Error('Motion shape transform failed.'); return builder.detach(); } finally { builder.delete(); }
}
function length(kit: CanvasKit, path: Path): number {
	const iterator = new kit.ContourMeasureIter(path, false, 1); let total = 0;
	try { for (let contour = iterator.next(); contour; contour = iterator.next()) { try { total += contour.length(); } finally { contour.delete(); } } return total; } finally { iterator.delete(); }
}
function trim(kit: CanvasKit, path: Path, operator: Extract<MotionEvaluatedShapeOperator, { kind: 'trim-paths' }>, start: number, span: number): Path {
	const lo = Math.min(operator.start, operator.end); const extent = Math.abs(operator.end - operator.start);
	if (extent === 1) return path.copy(); const beginning = ((lo + operator.offset) % 1 + 1) % 1;
	const windows = beginning + extent <= 1 ? [[beginning, beginning + extent]] : [[beginning, 1], [0, beginning + extent - 1]];
	const builder = new kit.PathBuilder();
	try {
		for (const [from, to] of windows) {
			const first = Math.max(0, (from! - start) / span); const last = Math.min(1, (to! - start) / span);
			if (!Number.isFinite(first) || !Number.isFinite(last) || first >= last) continue;
			const segment = first === 0 && last === 1 ? path.copy() : path.makeTrimmed(first, last, false); if (!segment) throw new Error(`Motion cubic path trimming failed (${first}, ${last}).`);
			try { builder.addPath(segment); } finally { segment.delete(); }
		}
		return builder.detach();
	} finally { builder.delete(); }
}
