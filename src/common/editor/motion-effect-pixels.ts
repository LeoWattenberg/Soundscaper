/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionEffectPlan } from './motion-effect-rendering.ts';
import { decodeMotionChannel, type MotionSurface } from './motion-surface.ts';

export const motionLinearLuma = (r: number, g: number, b: number): number => r * 0.2126 + g * 0.7152 + b * 0.0722;
export const clampMotionEffectChannel = (value: number): number => Math.max(0, Math.min(1, value));
export function motionEffectPackedColor(packed: number): readonly [number, number, number] {
	return [decodeMotionChannel((packed >>> 16) / 255, 'srgb'), decodeMotionChannel((packed >>> 8 & 255) / 255, 'srgb'), decodeMotionChannel((packed & 255) / 255, 'srgb')];
}

/** Pointwise color operates on unassociated linear RGB, then reassociates the original alpha. */
export function renderMotionPointwiseEffect(source: MotionSurface, output: MotionSurface, plan: MotionEffectPlan, sharpened?: MotionSurface): void {
	const p = plan.params; const key = plan.type === 'chroma-key' ? motionEffectPackedColor(p.keyColor!) : [0, 0, 0];
	const chroma = (r: number, g: number, b: number): readonly [number, number] => { const y = motionLinearLuma(r, g, b); return [(b - y) / 1.8556, (r - y) / 1.5748]; };
	const keyChroma = chroma(...key as [number, number, number]);
	for (let i = 0; i < source.pixels.length; i += 4) {
		const a = source.pixels[i + 3]!; if (!a) continue;
		let r = source.pixels[i]! / a; let g = source.pixels[i + 1]! / a; let b = source.pixels[i + 2]! / a; let coverage = a;
		if (plan.type === 'color-adjust') {
			const y = motionLinearLuma(r, g, b); const hue = p.hueDegrees! * Math.PI / 180;
			const [cb, cr] = chroma(r, g, b); const c = Math.cos(hue); const s = Math.sin(hue);
			const shiftedCb = (cb * c - cr * s) * p.saturation!; const shiftedCr = (cb * s + cr * c) * p.saturation!;
			r = y + shiftedCr * 1.5748; b = y + shiftedCb * 1.8556; g = (y - r * 0.2126 - b * 0.0722) / 0.7152;
			const adjust = (v: number): number => clampMotionEffectChannel((Math.max(0, (v - 0.5) * p.contrast! + 0.5 + p.brightness!)) ** (1 / p.gamma!));
			r = adjust(r); g = adjust(g); b = adjust(b);
		} else if (plan.type === 'chroma-key') {
			const uv = chroma(r, g, b); const distance = Math.hypot(uv[0] - keyChroma[0], uv[1] - keyChroma[1]) / Math.SQRT2;
			coverage *= p.softness! === 0 ? Number(distance >= p.similarity!) : clampMotionEffectChannel((distance - p.similarity!) / p.softness!);
		} else if (plan.type === 'luma-key') {
			const y = motionLinearLuma(r, g, b); const distance = p.mode === 0 ? y - p.cutoff! : p.cutoff! - y;
			coverage *= p.softness! === 0 ? Number(distance > 0) : clampMotionEffectChannel(distance / p.softness!);
		} else if (plan.type === 'spill-suppression') {
			if (p.screen === 0) g -= Math.max(0, g - Math.min(r, b)) * p.strength!;
			else b -= Math.max(0, b - Math.min(r, g)) * p.strength!;
		} else if (plan.type === 'vignette') {
			const x = (i / 4 % source.width + 0.5) - source.width / 2; const y = (Math.floor(i / 4 / source.width) + 0.5) - source.height / 2;
			const attenuation = Math.cos(p.amount! * (Math.PI / 2 - 0.001) * Math.hypot(x, y) / Math.hypot(source.width / 2, source.height / 2)) ** 4;
			r *= attenuation; g *= attenuation; b *= attenuation;
		} else if (plan.type === 'sharpen' && sharpened) {
			const blurredAlpha = sharpened.pixels[i + 3]!;
			const average = blurredAlpha > 0 ? motionLinearLuma(sharpened.pixels[i]! / blurredAlpha, sharpened.pixels[i + 1]! / blurredAlpha, sharpened.pixels[i + 2]! / blurredAlpha) : 0;
			const detail = p.amount! * (motionLinearLuma(r, g, b) - average); r += detail; g += detail; b += detail;
		} else throw new Error(`Motion pointwise effect ${plan.type} is unavailable.`);
		output.pixels[i] = clampMotionEffectChannel(r) * coverage; output.pixels[i + 1] = clampMotionEffectChannel(g) * coverage;
		output.pixels[i + 2] = clampMotionEffectChannel(b) * coverage; output.pixels[i + 3] = coverage;
	}
}

export function renderMotionPixelate(source: MotionSurface, output: MotionSurface, blockSize: number): void {
	for (let by = 0; by < source.height; by += blockSize) for (let bx = 0; bx < source.width; bx += blockSize) {
		const bottom = Math.min(source.height, by + blockSize); const right = Math.min(source.width, bx + blockSize); const total = (bottom - by) * (right - bx);
		const sum = [0, 0, 0, 0];
		for (let y = by; y < bottom; y++) for (let x = bx; x < right; x++) for (let c = 0; c < 4; c++) sum[c]! += source.pixels[(y * source.width + x) * 4 + c]!;
		for (let y = by; y < bottom; y++) for (let x = bx; x < right; x++) for (let c = 0; c < 4; c++) output.pixels[(y * source.width + x) * 4 + c] = sum[c]! / total;
	}
}

export function renderMotionRgbSplit(source: MotionSurface, output: MotionSurface, plan: MotionEffectPlan): void {
	for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
		const i = (y * output.width + x) * 4;
		for (let c = 0; c < 3; c++) {
			const direction = c === 0 ? 1 : c === 2 ? -1 : 0;
			const sx = x + plan.left - direction * plan.params.offsetX!; const sy = y + plan.top - direction * plan.params.offsetY!;
			if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
			const sourceIndex = (sy * source.width + sx) * 4;
			output.pixels[i + c] = source.pixels[sourceIndex + c]!; output.pixels[i + 3] = Math.max(output.pixels[i + 3]!, source.pixels[sourceIndex + 3]!);
		}
	}
}
