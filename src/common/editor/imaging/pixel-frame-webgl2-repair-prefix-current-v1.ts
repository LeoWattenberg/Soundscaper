/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainRecord as record, readClosedDomainField as field, readClosedDomainArray as array } from '../closed-domain-value.ts';
import type { ImageDevelopRepairSpotPlanV1 } from './image-develop-repair-plan-v1.ts';
import { readPixelFrameWebGl2RepairCurrentV1 } from './pixel-frame-webgl2-repair-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { withMaskNativeCurrentV1, type MaskTextureCurrentV1 } from './pixel-frame-webgl2-mask-context-native-current-v1.ts';
import type { PixelFrameWebGl2MaskImageCurrentV1 } from './pixel-frame-webgl2-mask-context-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_REPAIR_CLONE_CURRENT_V1 as CLONE, PIXEL_FRAME_WEBGL2_REPAIR_HEAL_BLEND_CURRENT_V1 as BLEND } from './pixel-frame-webgl2-repair-glsl-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_HEAL_DONOR_CURRENT_V1 as DONOR, PIXEL_FRAME_WEBGL2_HEAL_MEMBER_CURRENT_V1 as MEMBER,
	PIXEL_FRAME_WEBGL2_HEAL_BOUNDARY_CURRENT_V1 as BOUNDARY, PIXEL_FRAME_WEBGL2_HEAL_REDUCE_CURRENT_V1 as REDUCE,
	PIXEL_FRAME_WEBGL2_HEAL_DELTA_CURRENT_V1 as DELTA, PIXEL_FRAME_WEBGL2_HEAL_INITIAL_CURRENT_V1 as INITIAL,
	PIXEL_FRAME_WEBGL2_HEAL_RHS_CURRENT_V1 as RHS, PIXEL_FRAME_WEBGL2_HEAL_JACOBI_CURRENT_V1 as JACOBI } from './pixel-frame-webgl2-heal-glsl-current-v1.ts';
export interface PixelFrameWebGl2RepairDrawsCurrentV1 {
	clone: number; donor: number; membership: number; boundary: number; reduction: number; delta: number; initial: number; rhs: number; jacobi: number; healBlend: number;
}
/** Borrow three real caller-owned same-aperture images: O0 immutable, A1/B2
 * ordered destinations. No source capture/upload/final readback/CPU patch is
 * performed. Only programs and per-spot halo pools are owned here, and those
 * finish/retire before the returned index can enter any authored stage. */
export async function executePixelFrameWebGl2RepairPrefixCurrentV1(gl: WebGL2RenderingContext, value: unknown,
	images: readonly [Readonly<PixelFrameWebGl2MaskImageCurrentV1>, Readonly<PixelFrameWebGl2MaskImageCurrentV1>, Readonly<PixelFrameWebGl2MaskImageCurrentV1>],
	checkValue: () => void, unavailable: (reason: string) => never, signalValue?: AbortSignal) {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	if (typeof checkValue !== 'function' || typeof unavailable !== 'function') throw new TypeError('Repair prefix needs captured native currentness/unavailable methods.');
	const plan = readPixelFrameWebGl2RepairCurrentV1(value), captured = array(images, 'repair image banks', 3, 3).map(raw => {
		const input = record(raw, 'repair image bank', ['texture', 'width', 'height']);
		if (field(input, 'width', 'repair image bank') !== plan.descriptor.width || field(input, 'height', 'repair image bank') !== plan.descriptor.height) throw new RangeError('Repair image bank differs from its source aperture.');
		const texture = field(input, 'texture', 'repair image bank') as WebGLTexture;
		return Object.freeze({ texture, width: plan.descriptor.width, height: plan.descriptor.height, format: 'float' as const, allocated: true });
	});
	if (new Set(captured.map(image => image.texture)).size !== 3) throw new TypeError('Repair O/A/B must be distinct native image banks.');
	if (plan.frameBytes * 3 + plan.gpuHaloBytes + 4096 > 768 * 1024 * 1024) throw new RangeError('Standalone repair image/halo component exceeds its fixed native bound.');
	const check = () => { checkRepairSignalV1(signal); if (Reflect.apply(checkValue, undefined, []) !== undefined) throw new TypeError('Repair currentness must complete synchronously.'); };
	check(); if (!plan.supported) unavailable('numeric-range');
	for (const image of captured) if (!gl.isTexture(image.texture)) throw new TypeError('Repair image bank is not live in this native context.');
	const draws: PixelFrameWebGl2RepairDrawsCurrentV1 = { clone: 0, donor: 0, membership: 0, boundary: 0, reduction: 0, delta: 0, initial: 0, rhs: 0, jacobi: 0, healBlend: 0 };
	if (!plan.hasActive) return Object.freeze({ index: 0 as 0 | 1 | 2, draws: Object.freeze(draws) });
	return withMaskNativeCurrentV1(gl, check, unavailable, async native => {
		const original = captured[0]!, banks = [captured[1]!, captured[2]!] as const, clone = native.program(CLONE), blend = native.program(BLEND);
		let current = original, index: 0 | 1 | 2 = 0;
		for (const spot of plan.spots) {
			check(); if (!spot.spot.enabled || spot.spot.opacity === 0 || !spot.rectangle.width || !spot.rectangle.height) continue;
			const next = current === banks[0] ? banks[1] : banks[0], nextIndex = next === banks[0] ? 1 : 2;
			if (spot.spot.mode === 'clone') {
				native.draw(clone, next, () => { sample(gl, clone, 'uOriginal', 0, original); sample(gl, clone, 'uCurrent', 1, current); controls(gl, clone, spot, original.width, original.height); });
				draws.clone++; await native.wait(); current = next; index = nextIndex;
			} else if (await heal(gl, original, current, next, spot, blend, draws, check, unavailable)) { current = next; index = nextIndex; }
		} check(); return Object.freeze({ index, draws: Object.freeze({ ...draws }) });
	});
}
function sample(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, unit: number, texture: MaskTextureCurrentV1): void {
	gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture.texture); gl.uniform1i(gl.getUniformLocation(program, name), unit);
}
function controls(gl: WebGL2RenderingContext, program: WebGLProgram, spot: ImageDevelopRepairSpotPlanV1, width: number, height: number): void {
	gl.uniform2i(gl.getUniformLocation(program, 'uExtent'), width, height); gl.uniform2f(gl.getUniformLocation(program, 'uTarget'), spot.target.x, spot.target.y);
	gl.uniform2f(gl.getUniformLocation(program, 'uDelta'), spot.sourceDelta.x, spot.sourceDelta.y); gl.uniform1f(gl.getUniformLocation(program, 'uRadius'), spot.radius);
	gl.uniform1f(gl.getUniformLocation(program, 'uFeather'), spot.spot.feather); gl.uniform1f(gl.getUniformLocation(program, 'uOpacity'), spot.spot.opacity);
	if (spot.halo) { gl.uniform2i(gl.getUniformLocation(program, 'uHaloOrigin'), spot.halo.x, spot.halo.y); gl.uniform2i(gl.getUniformLocation(program, 'uHaloExtent'), spot.halo.width, spot.halo.height); }
}
async function heal(gl: WebGL2RenderingContext, original: MaskTextureCurrentV1, incoming: MaskTextureCurrentV1, destination: MaskTextureCurrentV1,
	spot: ImageDevelopRepairSpotPlanV1, blend: WebGLProgram, draws: PixelFrameWebGl2RepairDrawsCurrentV1, check: () => void, unavailable: (reason: string) => never): Promise<boolean> {
	const halo = spot.halo; if (!halo) return false;
	return withMaskNativeCurrentV1(gl, check, unavailable, async native => {
		const donor = native.texture('float', halo.width, halo.height), member = native.texture('byte', halo.width, halo.height);
		const rhs = native.texture('float', halo.width, halo.height), a = native.texture('float', halo.width, halo.height), b = native.texture('float', halo.width, halo.height);
		const target = [native.texture('float', halo.width, halo.height), native.texture('float', halo.width, halo.height)] as const;
		const guidance = [native.texture('float', halo.width, halo.height), native.texture('float', halo.width, halo.height)] as const;
		const program = { donor: native.program(DONOR), member: native.program(MEMBER), boundary: native.program(BOUNDARY), reduce: native.program(REDUCE),
			delta: native.program(DELTA), initial: native.program(INITIAL), rhs: native.program(RHS), jacobi: native.program(JACOBI) };
		const extent = (value: WebGLProgram) => controls(gl, value, spot, original.width, original.height);
		native.draw(program.donor, donor, () => { sample(gl, program.donor, 'uOriginal', 0, original); extent(program.donor); }); draws.donor++;
		native.draw(program.member, member, () => { sample(gl, program.member, 'uOriginal', 0, original); sample(gl, program.member, 'uDonor', 1, donor); extent(program.member); }); draws.membership++;
		for (const [mode, bank] of [[0, target[0]], [1, guidance[0]]] as const) {
			native.draw(program.boundary, bank, () => { sample(gl, program.boundary, 'uOriginal', 0, original); sample(gl, program.boundary, 'uDonor', 1, donor);
				sample(gl, program.boundary, 'uMember', 2, member); extent(program.boundary); gl.uniform1i(gl.getUniformLocation(program.boundary, 'uBoundaryMode'), mode); }); draws.boundary++;
		}
		const reduce = async (banks: readonly [MaskTextureCurrentV1, MaskTextureCurrentV1]): Promise<MaskTextureCurrentV1> => {
			let current = banks[0], width = halo.width, height = halo.height;
			while (width > 1 || height > 1) {
				check(); const next = current === banks[0] ? banks[1] : banks[0], w = Math.ceil(width / 2), h = Math.ceil(height / 2);
				native.draw(program.reduce, next, () => { sample(gl, program.reduce, 'uReduction', 0, current);
					gl.uniform2i(gl.getUniformLocation(program.reduce, 'uReductionExtent'), width, height); gl.viewport(0, 0, w, h); });
				draws.reduction++; await native.wait(); current = next; width = w; height = h;
			} return current;
		};
		const totals = await reduce(target), guides = await reduce(guidance);
		native.draw(program.delta, b, () => { sample(gl, program.delta, 'uBoundaryTarget', 0, totals); sample(gl, program.delta, 'uBoundaryDonor', 1, guides); gl.viewport(0, 0, 1, 1); }); draws.delta++;
		await native.wait(); native.attach(b); const status = native.floats(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, status); native.check();
		// A rounded GPU status cannot establish CPU semantic invalidity. The
		// broker retires this attempt before unchanged CPU evaluation distinguishes
		// a genuine no-boundary RangeError from lost paired boundary weight.
		if (![...status].every(Number.isFinite) || status[3]! < 0) unavailable('numeric-range');
		if (status[3] === 0) return false;
		native.draw(program.initial, a, () => { sample(gl, program.initial, 'uDonor', 0, donor); sample(gl, program.initial, 'uMember', 1, member); sample(gl, program.initial, 'uDeltaImage', 2, b); }); draws.initial++;
		native.draw(program.rhs, rhs, () => { sample(gl, program.rhs, 'uOriginal', 0, original); sample(gl, program.rhs, 'uDonor', 1, donor);
			sample(gl, program.rhs, 'uMember', 2, member); sample(gl, program.rhs, 'uDeltaImage', 3, b); extent(program.rhs); }); draws.rhs++;
		let previous = a, next = b;
		for (let iteration = 0; iteration < 64; iteration++) {
			check(); native.draw(program.jacobi, next, () => { sample(gl, program.jacobi, 'uMember', 0, member); sample(gl, program.jacobi, 'uRhs', 1, rhs);
				sample(gl, program.jacobi, 'uPrevious', 2, previous); extent(program.jacobi); }); draws.jacobi++;
			await native.wait(); const completed = previous; previous = next; next = completed;
		}
		native.draw(blend, destination, () => { sample(gl, blend, 'uCurrent', 0, incoming); sample(gl, blend, 'uDonor', 1, donor);
			sample(gl, blend, 'uMember', 2, member); sample(gl, blend, 'uSolution', 3, previous); extent(blend); }); draws.healBlend++;
		await native.wait(); return true;
	});
}
