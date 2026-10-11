/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionCamera } from './motion-camera.ts';
import type { MotionDepthPlane } from './motion-depth-compositing.ts';
import type { MotionLighting } from './motion-lighting-plan.ts';
import { motionPlaneMatteWeight, sampleMotionPlaneSurface } from './motion-plane-sampling.ts';
import type { MotionVector2 } from './motion-property.ts';

/** Mutates only the current fragment RGB, retaining its source/mask alpha. Scratch is caller-owned. */
export function shadeMotionPlaneFragment(lighting: MotionLighting, camera: MotionCamera, plane: MotionDepthPlane, planes: readonly MotionDepthPlane[], localX: number, localY: number, pixels: Float64Array, slot: number, scratch: Float64Array, lens: MotionVector2): void {
	const material = plane.layer.state.material; if (!material.acceptsLights || !lighting.lights.length) return;
	const m = plane.layer.worldMatrix; const inverse = plane.worldToLocal;
	const x = m[0] * localX + m[4] * localY + m[12]; const y = m[1] * localX + m[5] * localY + m[13]; const z = m[2] * localX + m[6] * localY + m[14];
	let nx = -inverse[2]; let ny = -inverse[6]; let nz = -inverse[10]; const normal = Math.hypot(nx, ny, nz); nx /= normal; ny /= normal; nz /= normal;
	const cx = camera.world[0] * lens[0] + camera.world[4] * lens[1]; const cy = camera.world[1] * lens[0] + camera.world[5] * lens[1]; const cz = camera.world[2] * lens[0] + camera.world[6] * lens[1];
	let vx = camera.projection === 'perspective' ? camera.world[12] + cx - x : -camera.world[8] + cx / camera.focusDistance;
	let vy = camera.projection === 'perspective' ? camera.world[13] + cy - y : -camera.world[9] + cy / camera.focusDistance;
	let vz = camera.projection === 'perspective' ? camera.world[14] + cz - z : -camera.world[10] + cz / camera.focusDistance;
	const view = Math.hypot(vx, vy, vz); vx /= view; vy /= view; vz /= view;
	if (nx * vx + ny * vy + nz * vz < 0) { nx = -nx; ny = -ny; nz = -nz; }
	let r = 0; let g = 0; let b = 0;
	const alpha = pixels[slot + 3]!;
	for (const light of lighting.lights) {
		if (light.kind === 'ambient') { r += pixels[slot]! * material.ambient * light.rgb[0]; g += pixels[slot + 1]! * material.ambient * light.rgb[1]; b += pixels[slot + 2]! * material.ambient * light.rgb[2]; continue; }
		const lx = light.position[0] - x; const ly = light.position[1] - y; const lz = light.position[2] - z; const distance = Math.hypot(lx, ly, lz);
		if (distance <= 1e-12) continue;
		const ux = lx / distance; const uy = ly / distance; const uz = lz / distance;
		let amount = 1;
		if (light.kind === 'spot') {
			const cone = -(ux * light.direction[0] + uy * light.direction[1] + uz * light.direction[2]);
			if (cone < light.outerCone) continue;
			if (light.innerCone > light.outerCone) { const t = Math.max(0, Math.min(1, (cone - light.outerCone) / (light.innerCone - light.outerCone))); amount = t * t * (3 - 2 * t); }
		}
		const diffuse = Math.max(0, nx * ux + ny * uy + nz * uz);
		if (!diffuse) continue;
		if (material.receivesShadows && light.castsShadows) amount *= shadowTransmission(camera, plane, planes, x, y, z, lx, ly, lz, scratch, lens);
		const hx = ux + vx; const hy = uy + vy; const hz = uz + vz; const length = Math.hypot(hx, hy, hz);
		const specular = length ? material.specular * Math.max(0, (nx * hx + ny * hy + nz * hz) / length) ** material.shininess * alpha : 0;
		r += (pixels[slot]! * material.diffuse * diffuse + specular) * light.rgb[0] * amount;
		g += (pixels[slot + 1]! * material.diffuse * diffuse + specular) * light.rgb[1] * amount;
		b += (pixels[slot + 2]! * material.diffuse * diffuse + specular) * light.rgb[2] * amount;
	}
	pixels[slot] = Math.min(alpha, r); pixels[slot + 1] = Math.min(alpha, g); pixels[slot + 2] = Math.min(alpha, b);
}

function shadowTransmission(camera: MotionCamera, receiver: MotionDepthPlane, planes: readonly MotionDepthPlane[], x: number, y: number, z: number, dx: number, dy: number, dz: number, scratch: Float64Array, lens: MotionVector2): number {
	let transmission = 1;
	for (const caster of planes) {
		if (caster === receiver || !caster.layer.state.material.castsShadows) continue;
		const m = caster.worldToLocal;
		const ox = m[0] * x + m[4] * y + m[8] * z + m[12]; const oy = m[1] * x + m[5] * y + m[9] * z + m[13]; const oz = m[2] * x + m[6] * y + m[10] * z + m[14];
		const vx = m[0] * dx + m[4] * dy + m[8] * dz; const vy = m[1] * dx + m[5] * dy + m[9] * dz; const vz = m[2] * dx + m[6] * dy + m[10] * dz;
		if (Math.abs(vz) <= 1e-12 * Math.hypot(vx, vy, vz)) continue;
		const t = -oz / vz; if (t <= 1e-7 || t >= 1 - 1e-7 || !Number.isFinite(t)) continue;
		sampleMotionPlaneSurface(caster.local.surface, ox + vx * t - caster.local.origin[0] - 0.5, oy + vy * t - caster.local.origin[1] - 0.5, scratch);
		let coverage = scratch[3]! * Math.max(0, Math.min(1, caster.opacity ?? caster.layer.state.transform.opacity));
		if (coverage && caster.matte) {
			const view = camera.view; const wx = x + dx * t; const wy = y + dy * t; const wz = z + dz * t;
			const cx = view[0] * wx + view[4] * wy + view[8] * wz + view[12]; const cy = view[1] * wx + view[5] * wy + view[9] * wz + view[13]; const depth = view[2] * wx + view[6] * wy + view[10] * wz + view[14];
			if (caster.matte.surface && depth >= camera.near && depth <= camera.far) {
				const factor = camera.projection === 'perspective' ? camera.zoom / depth : camera.zoom / Math.max(camera.width, camera.height);
				sampleMotionPlaneSurface(caster.matte.surface, camera.width / 2 + (cx - lens[0] * (1 - depth / camera.focusDistance)) * factor - 0.5, camera.height / 2 + (cy - lens[1] * (1 - depth / camera.focusDistance)) * factor - 0.5, scratch);
			} else scratch.fill(0);
			coverage *= motionPlaneMatteWeight(caster.matte, scratch[0]!, scratch[1]!, scratch[2]!, scratch[3]!);
		}
		transmission *= 1 - Math.max(0, Math.min(1, coverage)); if (transmission <= 0) return 0;
	}
	return transmission;
}
