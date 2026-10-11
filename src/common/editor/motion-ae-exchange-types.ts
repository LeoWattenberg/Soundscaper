/* SPDX-License-Identifier: AGPL-3.0-only */
/** Data custody is distinct from renderer compatibility. Expressions here are inert text. */
export interface MotionAeExpression {
	readonly source: string; readonly enabled: boolean; readonly disposition: 'translated' | 'sampled' | 'unsupported';
}
export interface MotionAeEase { readonly speed: number; readonly influence: number }
/** Explicit frame-grid evaluation, separate from the untouched authored keys. No subframe fidelity is implied. */
export interface MotionAeNumericSamples {
	readonly frameRate: number; readonly firstFrame: number; readonly values: readonly (readonly number[])[];
}
export interface MotionAeKey<Value> {
	readonly time: number; readonly value: Value; readonly inInterpolation: 'hold' | 'linear' | 'bezier'; readonly outInterpolation: 'hold' | 'linear' | 'bezier';
	readonly inEase: readonly MotionAeEase[]; readonly outEase: readonly MotionAeEase[];
	readonly inSpatialTangent: readonly number[] | null; readonly outSpatialTangent: readonly number[] | null; readonly roving: boolean;
}
export interface MotionAeShape {
	readonly closed: boolean; readonly vertices: readonly (readonly [number, number])[];
	readonly inTangents: readonly (readonly [number, number])[]; readonly outTangents: readonly (readonly [number, number])[];
	readonly feather?: { readonly segmentLocations: readonly number[]; readonly relativeLocations: readonly number[]; readonly radii: readonly number[];
		readonly interpolations: readonly number[]; readonly tensions: readonly number[]; readonly types: readonly number[]; readonly cornerAngles: readonly number[] };
}
export type MotionAeTextOrientation = 'horizontal' | 'vertical-right-to-left' | 'vertical-left-to-right';
export type MotionAeTextLayout =
	| { readonly kind: 'point'; readonly orientation: MotionAeTextOrientation }
	| { readonly kind: 'box'; readonly orientation: MotionAeTextOrientation; readonly size: readonly [number, number]; readonly position: readonly [number, number] };
export interface MotionAeText {
	readonly text: string; readonly font: string; readonly fontSize: number; readonly fillColor: readonly [number, number, number];
	readonly applyFill: boolean; readonly applyStroke: boolean; readonly strokeColor: readonly [number, number, number]; readonly strokeWidth: number;
	readonly tracking: number; readonly leading: number; readonly autoLeading: boolean; readonly justification: 'left' | 'center' | 'right';
	/** Full-range style capture, never inferred from the first character. Absent legacy metadata is unavailable. */
	readonly styleScope?: 'uniform' | 'mixed' | 'unavailable';
	/** Basic requires neutral unmapped controls: no faux/caps/baseline alterations, custom kerning,
	 * character scaling, paragraph indents/spacing, box inset/auto-fit/alignment, CJK or forced-direction overrides.
	 * Hosts unable to inspect those controls must say unavailable. This does not promise matching shaping.
	 */
	readonly styleSupport?: 'basic' | 'unsupported' | 'unavailable';
	readonly layout?: MotionAeTextLayout;
}
interface MotionAePropertyBase { readonly matchName: string; readonly name: string }
export interface MotionAeMaskMetadata {
	readonly mode: 'none' | 'add' | 'subtract' | 'intersect' | 'lighten' | 'darken' | 'difference';
	readonly inverted: boolean; readonly rotoBezier: boolean; readonly featherFalloff: 'linear' | 'smooth';
	readonly motionBlur: 'same-as-layer' | 'on' | 'off';
}
export interface MotionAeVectorStyle {
	readonly blendMode: 'normal' | 'unsupported' | 'unavailable';
	readonly fillRule?: 'nonzero' | 'evenodd' | 'unavailable';
	readonly lineCap?: 'butt' | 'round' | 'square' | 'unavailable';
	readonly lineJoin?: 'miter' | 'round' | 'bevel' | 'unavailable';
	readonly pathDirection?: 'forward' | 'reversed' | 'unavailable';
}
export type MotionAeProperty =
	| (MotionAePropertyBase & { readonly kind: 'group'; readonly children: readonly MotionAeProperty[]; readonly mask?: MotionAeMaskMetadata; readonly enabled?: boolean; readonly vectorStyle?: MotionAeVectorStyle })
	| (MotionAePropertyBase & { readonly kind: 'numeric'; readonly value: readonly number[]; readonly spatial: boolean;
		readonly keys: readonly MotionAeKey<readonly number[]>[]; readonly expression: MotionAeExpression | null; readonly samples?: MotionAeNumericSamples })
	| (MotionAePropertyBase & { readonly kind: 'shape'; readonly value: MotionAeShape;
		readonly keys: readonly MotionAeKey<MotionAeShape>[]; readonly expression: MotionAeExpression | null })
	| (MotionAePropertyBase & { readonly kind: 'text'; readonly value: MotionAeText;
		readonly keys: readonly MotionAeKey<MotionAeText>[]; readonly expression: MotionAeExpression | null })
	| (MotionAePropertyBase & { readonly kind: 'unsupported'; readonly reason: string });
export interface MotionAeFootage {
	readonly id: string; readonly name: string; readonly path: string | null; readonly byteLength: number | null; readonly sha256: string | null;
	readonly width: number; readonly height: number; readonly pixelAspect: number; readonly frameRate: number; readonly duration: number;
	readonly hasVideo: boolean; readonly hasAudio: boolean; readonly still: boolean;
}
export interface MotionAeLayer {
	readonly id: string; readonly name: string; readonly kind: 'footage' | 'composition' | 'null' | 'solid' | 'text' | 'shape' | 'camera' | 'light';
	readonly sourceId: string | null; readonly parentId: string | null;
	readonly matte: { readonly layerId: string; readonly type: 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted' } | null;
	readonly startTime: number; readonly inPoint: number; readonly outPoint: number; readonly stretch: number;
	readonly enabled: boolean; readonly threeD: boolean; readonly adjustment: boolean; readonly blendMode: string;
	readonly properties: readonly MotionAeProperty[];
}
export interface MotionAeComposition {
	readonly id: string; readonly name: string; readonly width: number; readonly height: number; readonly pixelAspect: number;
	readonly frameRate: number; readonly duration: number; readonly displayStartTime: number; readonly background: readonly [number, number, number];
	/** Topmost layer first, matching the AE collection. IDs stay stable within one transfer. */
	readonly layers: readonly MotionAeLayer[];
}
export interface MotionAeReportEntry {
	readonly scopeId: string; readonly propertyPath: string; readonly status: 'editable' | 'sampled' | 'rendered' | 'unsupported';
	readonly code: string; readonly message: string; readonly mediaId?: string;
}
export interface MotionAeExchange {
	readonly format: 'org.motionscaper.ae-exchange'; readonly version: 1; readonly transferId: string;
	readonly producer: { readonly application: 'after-effects' | 'motionscaper'; readonly version: string; readonly bridgeVersion: string };
	readonly source: { readonly name: string; readonly revisionDigest: string | null };
	readonly color: { readonly workingSpace: string; readonly linearBlending: boolean; readonly bitsPerChannel: 8 | 16 | 32 };
	readonly footage: readonly MotionAeFootage[]; readonly compositions: readonly MotionAeComposition[]; readonly report: readonly MotionAeReportEntry[];
}
export const MOTION_AE_EXCHANGE_LIMITS = Object.freeze({ jsonBytes: 16_777_216, compositions: 256, footage: 4096, layers: 4096,
	properties: 65_536, propertyDepth: 16, keysPerProperty: 4096, keys: 262_144, shapeVertices: 4096, reportEntries: 65_536,
	mediaBytes: 274_877_906_944 });
