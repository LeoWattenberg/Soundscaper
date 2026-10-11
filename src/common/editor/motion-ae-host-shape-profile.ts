/* SPDX-License-Identifier: AGPL-3.0-only */
import { parseMotionAeHostJson } from './motion-ae-host-json.ts';
import type { MotionAeVectorStyle } from './motion-ae-exchange-types.ts';
export interface MotionAeShapeProfileHost { readonly version: string; readonly buildNumber: number; readonly locale: string }
export interface MotionAeShapeProfile {
	readonly format: 'org.motionscaper.ae-shape-profile'; readonly version: 1; readonly host: MotionAeShapeProfileHost; readonly reviewed: true;
	readonly mapping: Readonly<{ groupNormal: number; fillNormal: number; strokeNormal: number; fillNonzero: number; fillEvenodd: number;
		capButt: number; capRound: number; capSquare: number; joinMiter: number; joinRound: number; joinBevel: number; pathForward: number; pathReversed: number }>;
}
const fields: readonly (keyof MotionAeShapeProfile['mapping'])[] = ['groupNormal', 'fillNormal', 'strokeNormal', 'fillNonzero', 'fillEvenodd',
	'capButt', 'capRound', 'capSquare', 'joinMiter', 'joinRound', 'joinBevel', 'pathForward', 'pathReversed'];
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Object.prototype.toString.call(value) === '[object Array]') throw new Error('Shape profile requires a record.');
	const input = value as Record<string, unknown>; let count = 0;
	for (const key in input) if (Object.prototype.hasOwnProperty.call(input, key)) {
		let admitted = false; for (let index = 0; index < keys.length; index++) if (keys[index] === key) admitted = true;
		if (!admitted) throw new Error('Shape profile contains an unsupported field.'); count++;
	}
	if (count !== keys.length) throw new Error('Shape profile is incomplete.'); return input;
}
function text(value: unknown): string { if (typeof value !== 'string' || !value.length || value.length > 128) throw new Error('Shape profile host identity is invalid.'); for (let index = 0; index < value.length; index++) if (value.charCodeAt(index) < 32) throw new Error('Shape profile host identity contains controls.'); return value; }
function integer(value: unknown): number { if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 1_000_000_000 || Math.floor(value) !== value) throw new Error('Shape profile integer is invalid.'); return value; }
/** User-reviewed calibration is evidence of selected UI labels, not an installed-AE renderer qualification. */
export function parseMotionAeShapeProfile(json: string, expected: MotionAeShapeProfileHost): MotionAeShapeProfile {
	if (json.length > 8192) throw new Error('Shape profile byte budget exceeded.');
	const r = record(parseMotionAeHostJson(json), ['format', 'version', 'host', 'reviewed', 'mapping']);
	if (r.format !== 'org.motionscaper.ae-shape-profile' || r.version !== 1 || r.reviewed !== true) throw new Error('Shape profile format or explicit review is missing.');
	const h = record(r.host, ['version', 'buildNumber', 'locale']), host = { version: text(h.version), buildNumber: integer(h.buildNumber), locale: text(h.locale) };
	if (host.version !== expected.version || host.buildNumber !== expected.buildNumber || host.locale !== expected.locale) throw new Error('Shape profile belongs to a different AE version, build or UI language. Calibrate this installed host or use rendered fallback.');
	const m = record(r.mapping, fields), mapping = {} as Record<keyof MotionAeShapeProfile['mapping'], number>;
	for (let index = 0; index < fields.length; index++) { const key = fields[index]!; mapping[key] = integer(m[key]); }
	const distinct = (keys: readonly (keyof MotionAeShapeProfile['mapping'])[]) => {
		for (let i = 0; i < keys.length; i++) for (let j = 0; j < i; j++) if (mapping[keys[i]!] === mapping[keys[j]!]) throw new Error('Shape profile labels were not set to distinct reviewed choices.');
	};
	distinct(['fillNonzero', 'fillEvenodd']); distinct(['capButt', 'capRound', 'capSquare']); distinct(['joinMiter', 'joinRound', 'joinBevel']); distinct(['pathForward', 'pathReversed']);
	return { format: 'org.motionscaper.ae-shape-profile', version: 1, host, reviewed: true, mapping };
}
/** The caller returns null for absent, animated or expression-driven popup controls. No source mutation. */
export function motionAeShapeStyle(matchName: string, read: (name: string) => number | null, profile: MotionAeShapeProfile | null): MotionAeVectorStyle | undefined {
	if (matchName !== 'ADBE Vector Group' && matchName !== 'ADBE Vector Graphic - Fill' && matchName !== 'ADBE Vector Graphic - Stroke' && matchName !== 'ADBE Vector Shape - Group') return undefined;
	const m = profile?.mapping, rawBlend = read('ADBE Vector Blend Mode');
	const normal = matchName === 'ADBE Vector Group' ? m?.groupNormal : matchName === 'ADBE Vector Graphic - Fill' ? m?.fillNormal : m?.strokeNormal;
	const blendMode = matchName === 'ADBE Vector Shape - Group' || !m || rawBlend === null ? 'unavailable' : rawBlend === normal ? 'normal' : 'unsupported';
	if (matchName === 'ADBE Vector Graphic - Fill') { const value = read('ADBE Vector Fill Rule'); return { blendMode, fillRule: !m || value === null ? 'unavailable' : value === m.fillNonzero ? 'nonzero' : value === m.fillEvenodd ? 'evenodd' : 'unavailable' }; }
	if (matchName === 'ADBE Vector Graphic - Stroke') { const cap = read('ADBE Vector Stroke Line Cap'), join = read('ADBE Vector Stroke Line Join'); return { blendMode,
		lineCap: !m || cap === null ? 'unavailable' : cap === m.capButt ? 'butt' : cap === m.capRound ? 'round' : cap === m.capSquare ? 'square' : 'unavailable',
		lineJoin: !m || join === null ? 'unavailable' : join === m.joinMiter ? 'miter' : join === m.joinRound ? 'round' : join === m.joinBevel ? 'bevel' : 'unavailable' }; }
	if (matchName === 'ADBE Vector Shape - Group') { const value = read('ADBE Vector Shape Direction'); return { blendMode, pathDirection: !m || value === null ? 'unavailable' : value === m.pathForward ? 'forward' : value === m.pathReversed ? 'reversed' : 'unavailable' }; }
	return { blendMode };
}
