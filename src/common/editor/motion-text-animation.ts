/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionTextAnimator } from './motion-authoring-operators.ts';
import type { MotionTextDocument } from './motion-composition.ts';
import type { EvaluatedMotionState } from './motion-property-evaluation.ts';
import { motionSurfaceLength } from './motion-surface.ts';
import type { MotionLocalSourceBounds } from './motion-local-raster.ts';

export type MotionEvaluatedTextAnimator = EvaluatedMotionState<MotionTextAnimator>;

export function assertMotionTextAnimatorParameters(animator: MotionEvaluatedTextAnimator): void {
	const s = animator.selector;
	for (const [name, value] of Object.entries({ start: s.start, end: s.end, amount: s.amount, opacity: animator.opacity })) {
		if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`Motion text animator ${animator.id}.${name} must be in the unit range.`);
	}
	if (!Number.isFinite(s.offset) || Math.abs(s.offset) > 32768 || !Number.isFinite(animator.tracking) || Math.abs(animator.tracking) > 32768
		|| !Number.isFinite(animator.rotation) || Math.abs(animator.rotation) > 1e6 || [...animator.anchor, ...animator.position, ...animator.scale].some((v) => !Number.isFinite(v) || Math.abs(v) > 32768)) {
		throw new RangeError(`Motion text animator ${animator.id} transform exceeds the rendering range.`);
	}
	if (animator.color?.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new RangeError(`Motion text animator ${animator.id} color exceeds the unit range.`);
}

/** Selector samples the center of each shaped unit; offset wraps the range, keeping complete ranges complete. */
export function motionTextSelectorWeight(animator: MotionEvaluatedTextAnimator, index: number, count: number): number {
	if (!count || index < 0) return 0;
	const { start, end, offset, amount, shape } = animator.selector;
	const lo = Math.min(start, end); const hi = Math.max(start, end); const span = hi - lo;
	if (!span) return 0;
	const position = ((index + 0.5) / count - offset - lo) % 1;
	const wrapped = position < 0 ? position + 1 : position;
	if (wrapped >= span) return 0;
	const t = wrapped / span;
	const weight = shape === 'ramp-up' ? t : shape === 'ramp-down' ? 1 - t : shape === 'triangle' ? 1 - Math.abs(2 * t - 1)
		: shape === 'round' ? Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) : shape === 'smooth' ? Math.sin(Math.PI * t) ** 2 : 1;
	return weight * amount;
}

/** Conservative bounds admit animation before font/WASM allocation, including units moved outside the layout box. */
export function motionTextAnimationBounds(document: EvaluatedMotionState<MotionTextDocument>): MotionLocalSourceBounds {
	const [width, height] = document.boxSize;
	let left = 0; let top = 0; let right = width; let bottom = height;
	const count = document.runs.reduce((sum, run) => sum + run.text.length, 0);
	const animators = (document.animators ?? []).filter((item) => item.enabled);
	if (animators.length && (count > 16384 || count * animators.length > 1_000_000)) throw new RangeError('Motion text animation exceeds its 16,384-character shaping-work budget.');
	for (const animator of animators) {
		assertMotionTextAnimatorParameters(animator);
		if (animator.rotation !== 0 || animator.scale.some((v) => v !== 1)) {
			const scale = Math.max(1, ...animator.scale.map(Math.abs));
			const radius = scale * Math.hypot(Math.max(Math.abs(left), Math.abs(right)) + width + Math.abs(animator.anchor[0]), Math.max(Math.abs(top), Math.abs(bottom)) + height + Math.abs(animator.anchor[1]));
			left = Math.min(left, -Math.abs(animator.anchor[0]) - radius); right = Math.max(right, width + Math.abs(animator.anchor[0]) + radius);
			top = Math.min(top, -Math.abs(animator.anchor[1]) - radius); bottom = Math.max(bottom, height + Math.abs(animator.anchor[1]) + radius);
		}
		const dx = Math.abs(animator.position[0]) + count * Math.abs(animator.tracking); const dy = Math.abs(animator.position[1]);
		left -= dx; right += dx; top -= dy; bottom += dy;
	}
	const x = Math.floor(left); const y = Math.floor(top); const w = Math.max(1, Math.ceil(right) - x); const h = Math.max(1, Math.ceil(bottom) - y);
	motionSurfaceLength(w, h);
	return { width: w, height: h, origin: [x, y], empty: false };
}
