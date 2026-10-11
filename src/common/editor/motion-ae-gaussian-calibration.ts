/* SPDX-License-Identifier: AGPL-3.0-only */
import { stringifyMotionAeHostJson } from './motion-ae-host-json.ts';
import { captureMotionAeGaussianControls, type MotionAeGaussianHostControl } from './motion-ae-gaussian-host-controls.ts';
import { normalizeMotionAeGaussianProfile, motionAeGaussianControl, type MotionAeGaussianProfile } from './motion-ae-gaussian-profile.ts';
import type { MotionAeShapeProfileHost } from './motion-ae-host-shape-profile.ts';
export interface MotionAeGaussianSampleGroup {
	readonly numProperties: number; property(index: number): MotionAeGaussianHostControl | null;
	canAddProperty(matchName: string): boolean; addProperty(matchName: string): unknown;
}
export interface MotionAeGaussianSampleLayer {
	name: string; enabled: boolean; effectsActive: boolean;
	property(name: string): MotionAeGaussianSampleGroup | null;
}
export interface MotionAeGaussianSample {
	comment: string; readonly numLayers: number; readonly layers: { addShape(): MotionAeGaussianSampleLayer };
	layer(index: number): MotionAeGaussianSampleLayer; openInViewer(): unknown; remove(): void;
}
export interface MotionAeGaussianCalibrationHost {
	readonly identity: MotionAeShapeProfileHost;
	begin(): void; end(): void; create(): MotionAeGaussianSample;
	kind(property: MotionAeGaussianHostControl): 'group' | 'scalar' | 'unsupported';
	/** SDK adapter must scope both selected paths to the only effect on this sample's only layer. */
	selection(sample: MotionAeGaussianSample): readonly (readonly string[])[];
}
const layerName = 'Review Gaussian controls; select Blurriness and Effect Opacity';
export const MOTION_AE_GAUSSIAN_REVIEW = 'In the NEW Motionscaper Gaussian Review composition only: keep its one empty shape layer and Gaussian Blur effect. Set Blurriness to 0, Blur Dimensions to Horizontal and Vertical (Both), Repeat Edge Pixels off, and Compositing Options > Effect Opacity to 100%. Do not add masks, effect mask references, keys, expressions or other effects. Select only the Blurriness and Effect Opacity properties in the Timeline. Capture the profile after personally reviewing these UI labels. Enter your own positive blurriness-per-Motion-sigma scale; no default or kernel equivalence is inferred. Installed AE color, alpha, kernel and bounds parity remain unqualified. Complete rendered fallback is available.';
function marker(identity: MotionAeShapeProfileHost): string { return 'org.motionscaper.ae-gaussian-calibration/1\n' + stringifyMotionAeHostJson(identity); }
function group(layer: MotionAeGaussianSampleLayer, name: string): MotionAeGaussianSampleGroup { const value = layer.property(name); if (!value) throw new Error('Gaussian sample control group is unavailable: ' + name); return value; }
/** Creates only its own empty shape sample and effect. Failure removes only that composition. */
export function prepareMotionAeGaussianCalibration(host: MotionAeGaussianCalibrationHost): MotionAeGaussianSample {
	host.begin(); let sample: MotionAeGaussianSample | null = null, ended = false;
	try {
		sample = host.create(); sample.comment = marker(host.identity);
		const layer = sample.layers.addShape(); layer.name = layerName; layer.enabled = true; layer.effectsActive = true;
		const effects = group(layer, 'ADBE Effect Parade');
		if (effects.numProperties !== 0 || group(layer, 'ADBE Mask Parade').numProperties !== 0 || !effects.canAddProperty('ADBE Gaussian Blur 2')) throw new Error('A fresh empty sample with the documented Gaussian Blur effect is unavailable. Use complete rendered fallback.');
		effects.addProperty('ADBE Gaussian Blur 2'); const effect = effects.property(1);
		if (!effect || Number(effects.numProperties) !== 1 || effect.matchName !== 'ADBE Gaussian Blur 2' || !effect.canSetEnabled) throw new Error('Gaussian sample effect or enable capability is unavailable.');
		effect.enabled = true; if (!effect.enabled || !layer.effectsActive) throw new Error('Gaussian sample enable state changed.');
		sample.openInViewer(); host.end(); ended = true; return sample;
	} catch (error) {
		const failures: string[] = [];
		if (sample) try { sample.remove(); } catch (cleanup) { failures.push(String(cleanup)); }
		if (!ended) try { host.end(); } catch (cleanup) { failures.push(String(cleanup)); }
		if (failures.length) { const failure = new Error('Gaussian sample preparation failed: ' + String(error) + '; owned cleanup failed: ' + failures.join('; '), { cause: error }); failure.cause = error; throw failure; } throw error;
	}
}
/** Read-only capture requires the exact owned marker and two explicitly selected source controls. */
export function captureMotionAeGaussianCalibration(sample: MotionAeGaussianSample, host: MotionAeGaussianCalibrationHost, reviewed: boolean, blurrinessPerSigma: number): MotionAeGaussianProfile {
	if (reviewed !== true || sample.comment !== marker(host.identity) || sample.numLayers !== 1) throw new Error('Choose the newly owned Gaussian sample for this exact host and explicitly review its labels.');
	const layer = sample.layer(1), effects = group(layer, 'ADBE Effect Parade'), effect = effects.property(1);
	if (layer.name !== layerName || !layer.enabled || !layer.effectsActive || group(layer, 'ADBE Mask Parade').numProperties !== 0 || effects.numProperties !== 1 || !effect || !effect.canSetEnabled || !effect.enabled) throw new Error('Gaussian sample layer, masks or effect inventory changed.');
	const controls = captureMotionAeGaussianControls(effect, host.kind), selected = host.selection(sample);
	if (controls.kind !== 'group' || selected.length !== 2) throw new Error('Select only Blurriness and Effect Opacity in the owned Gaussian sample.');
	let blurrinessPath: readonly string[] | null = null, effectOpacityPath: readonly string[] | null = null;
	for (let index = 0; index < selected.length; index++) {
		const path = selected[index]!, value = motionAeGaussianControl(controls, path);
		if (value.value === 0 && !blurrinessPath) blurrinessPath = path;
		else if (value.value === 100 && !effectOpacityPath) effectOpacityPath = path;
		else throw new Error('Selected Gaussian controls must be Blurriness 0 and Effect Opacity 100.');
	}
	if (!blurrinessPath || !effectOpacityPath) throw new Error('Both reviewed Gaussian controls must be selected.');
	return normalizeMotionAeGaussianProfile({ format: 'org.motionscaper.ae-gaussian-profile', version: 1, qualification: 'unqualified', reviewed: true, host: host.identity,
		review: { dimensions: 'both', repeatEdgePixels: false, effectOpacity: 100, effectMasks: 'none' }, blurrinessPerSigma, blurrinessPath, effectOpacityPath, controls }, host.identity);
}
