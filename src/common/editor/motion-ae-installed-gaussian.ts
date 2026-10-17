/* SPDX-License-Identifier: AGPL-3.0-only */
import { applyMotionAeGaussianHostEffect, type MotionAeGaussianHostControl } from './motion-ae-gaussian-host-controls.ts';
import { motionAeInstalledGaussianKind } from './motion-ae-installed-gaussian-profile.ts';
import type { MotionAeGaussianProfile } from './motion-ae-gaussian-profile.ts';
import type { MotionAeImportGaussian } from './motion-ae-host-import-gaussian.ts';
interface Effects { readonly numProperties: number; canAddProperty(name: string): boolean; addProperty(name: string): unknown; property(index: number): MotionAeGaussianHostControl | null }
declare const KeyframeInterpolationType: { HOLD: unknown; LINEAR: unknown };
/** Only a freshly owned layer is passed here; the surrounding importer retains rollback authority. */
export function applyMotionAeInstalledGaussian(layer: { property(name: string): unknown; effectsActive: boolean; threeDLayer: boolean; adjustmentLayer: boolean; preserveTransparency: boolean; collapseTransformation: boolean }, effects: readonly MotionAeImportGaussian[], profile: MotionAeGaussianProfile): void {
	if (layer.threeDLayer !== false || layer.adjustmentLayer !== false || layer.preserveTransparency !== false || layer.collapseTransformation !== false) throw new Error('Fresh Gaussian target must have verified neutral 2D compositing switches.');
	if (effects.length > 32) throw new Error('Gaussian effect budget exceeded.');
	const group = layer.property('ADBE Effect Parade') as Effects | null;
	if (!group || group.numProperties !== 0 || !group.canAddProperty('ADBE Gaussian Blur 2')) throw new Error('The fresh AE layer cannot accept the reviewed Gaussian effect.');
	for (let index = 0; index < effects.length; index++) {
		group.addProperty('ADBE Gaussian Blur 2');
		// Adding an indexed property invalidates earlier references; reacquire only the new effect.
		const target = group.property(index + 1); if (!target || Number(group.numProperties) !== index + 1) throw new Error('Gaussian effect creation changed the expected inventory.');
		applyMotionAeGaussianHostEffect(target, profile, effects[index]!.blur, effects[index]!.enabled, { kind: motionAeInstalledGaussianKind, hold: KeyframeInterpolationType.HOLD, linear: KeyframeInterpolationType.LINEAR });
	}
	layer.effectsActive = true; if (layer.effectsActive !== true) throw new Error('AE did not enable the reviewed effect stack.');
}
