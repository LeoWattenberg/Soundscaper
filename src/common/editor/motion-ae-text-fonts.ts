/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionAsset, type MotionAsset } from './motion-asset.ts';
import { freezeMotionValue, motionArray, motionRecord, motionString } from './motion-values.ts';
/** Explicit user association; family/style strings never identify an installed AE face.
 * The caller retains/verifies the font body using this descriptor's existing digest authority.
 */
export interface MotionAeFontBinding {
	readonly postScriptName: string; readonly asset: Extract<MotionAsset, { kind: 'font' }>;
}
export function normalizeMotionAeFontBindings(value: unknown): readonly MotionAeFontBinding[] {
	const names = new Set<string>(), ids = new Set<string>();
	return freezeMotionValue(motionArray(value, 4096, 'AE font bindings').map(input => {
		const record = motionRecord(input, ['postScriptName', 'asset'], 'AE font binding');
		const postScriptName = motionString(record.postScriptName, 'AE PostScript font name', 512), asset = normalizeMotionAsset(record.asset);
		if (asset.kind !== 'font') throw new TypeError('AE font binding requires a retained font asset.');
		if (asset.byteLength > 64 * 1024 * 1024) throw new RangeError('AE font binding exceeds the retained font limit.');
		if (names.has(postScriptName) || ids.has(asset.id)) throw new RangeError('AE font bindings require unique PostScript names and asset IDs.');
		names.add(postScriptName); ids.add(asset.id); return { postScriptName, asset };
	}));
}
