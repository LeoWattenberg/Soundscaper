/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Rational } from './timeline-time.ts';
import type { MotionColor, MotionColorProperty, MotionPathProperty, MotionProperty, MotionScalarProperty, MotionVector2Property, MotionVector3Property } from './motion-property.ts';
import type { MotionTemporalSettings } from './motion-temporal-settings.ts';
import type { MotionWorkArea } from './motion-composition-work-area.ts';
import type { MotionFill } from './motion-fill.ts';
import type { MotionShapeOperator, MotionTextAnimator } from './motion-authoring-operators.ts';
import type { MotionTrackingResult } from './motion-tracking-contract.ts';
import type { MotionTrackingApplication } from './motion-tracking-application-contract.ts';

export interface MotionTransform {
	readonly anchor: MotionVector3Property; readonly position: MotionVector3Property;
	readonly scale: MotionVector3Property; readonly rotation: MotionVector3Property;
	readonly opacity: MotionScalarProperty;
}
export interface MotionMaterial {
	readonly acceptsLights: boolean; readonly castsShadows: boolean; readonly receivesShadows: boolean;
	readonly ambient: MotionScalarProperty; readonly diffuse: MotionScalarProperty;
	readonly specular: MotionScalarProperty; readonly shininess: MotionScalarProperty;
}
export interface MotionMask {
	readonly id: string; readonly path: MotionPathProperty; readonly opacity: MotionScalarProperty;
	readonly feather: MotionVector2Property; readonly expansion: MotionScalarProperty;
	readonly inverted: boolean; readonly operation: 'add' | 'subtract' | 'intersect' | 'difference';
}
export interface MotionEffect {
	readonly id: string; readonly type: string; readonly enabled: boolean;
	readonly parameters: readonly { readonly id: string; readonly value: MotionProperty }[];
}
export const MOTION_BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'add', 'darken', 'lighten', 'difference', 'exclusion'] as const;
export interface MotionLayerBase {
	readonly id: string; readonly name: string; readonly enabled: boolean; readonly parentId: string | null;
	/** All layer and property positions are frames on the containing composition's grid. */
	readonly startFrame: Rational; readonly inFrame: Rational; readonly outFrame: Rational;
	/** Source seconds advance by this factor; zero holds the source. */
	readonly timeScale: Rational; readonly sourceStart: Rational;
	/** Optional animated source time in seconds, evaluated at layer-local frames. */
	readonly timeRemap: MotionScalarProperty | null;
	readonly transform: MotionTransform; readonly is3D: boolean; readonly material: MotionMaterial;
	readonly blendMode: typeof MOTION_BLEND_MODES[number]; readonly masks: readonly MotionMask[];
	readonly matte: { readonly layerId: string; readonly mode: 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted' } | null;
	readonly effects: readonly MotionEffect[];
}
export interface MotionTextRun {
	readonly text: string; readonly fontAssetId: string; readonly fontSize: MotionScalarProperty;
	readonly color: MotionColorProperty; readonly tracking: MotionScalarProperty;
}
export interface MotionTextDocument {
	readonly runs: readonly MotionTextRun[]; readonly align: 'left' | 'center' | 'right' | 'justify';
	readonly lineHeight: MotionScalarProperty; readonly boxSize: MotionVector2Property;
	readonly animators?: readonly MotionTextAnimator[];
}
export interface MotionShape {
	readonly id: string; readonly path: MotionPathProperty; readonly fill: MotionFill | null;
	readonly stroke: { readonly color: MotionColorProperty; readonly width: MotionScalarProperty; readonly lineCap: 'butt' | 'round' | 'square'; readonly lineJoin: 'miter' | 'round' | 'bevel' } | null;
}
export type MotionLayerContent =
	| { readonly kind: 'footage'; readonly assetId: string; readonly audioEnabled: boolean; readonly audioGain: MotionScalarProperty }
	| { readonly kind: 'image'; readonly assetId: string }
	| { readonly kind: 'text'; readonly document: MotionTextDocument }
	| { readonly kind: 'shapes'; readonly shapes: readonly MotionShape[]; readonly operators?: readonly MotionShapeOperator[] }
	| { readonly kind: 'solid'; readonly color: MotionColorProperty; readonly size: MotionVector2Property }
	| { readonly kind: 'null' }
	| { readonly kind: 'adjustment'; readonly targetLayerIds: readonly string[] }
	| { readonly kind: 'precomp'; readonly compositionId: string }
	| { readonly kind: 'camera'; readonly projection: 'perspective' | 'orthographic'; readonly zoom: MotionScalarProperty; readonly near: number; readonly far: number; readonly focusDistance: MotionScalarProperty; readonly aperture: MotionScalarProperty }
	| { readonly kind: 'light'; readonly lightType: 'ambient' | 'point' | 'spot'; readonly color: MotionColorProperty; readonly intensity: MotionScalarProperty; readonly coneAngle: MotionScalarProperty; readonly coneFeather: MotionScalarProperty; readonly castsShadows: boolean };
export type MotionLayer = MotionLayerBase & MotionLayerContent;
export interface MotionAudioPlacement {
	readonly id: string; readonly assetId: string; readonly startFrame: Rational;
	readonly inFrame: Rational; readonly outFrame: Rational; readonly sourceStart: Rational;
	readonly timeScale: Rational; readonly enabled: boolean; readonly gain: MotionScalarProperty;
}
export interface MotionComposition {
	readonly id: string; readonly name: string; readonly width: number; readonly height: number;
	readonly frameRate: Rational; readonly durationFrames: number; readonly background: MotionColor; readonly workArea?: MotionWorkArea;
	readonly color: { readonly workingSpace: 'linear-rec709-d65'; readonly outputSpace: 'srgb' | 'rec709'; readonly alphaMode: 'premultiplied' };
	/** Topmost layer first; the order is authored and must survive normalization. */
	readonly layers: readonly MotionLayer[];
	readonly audio: readonly MotionAudioPlacement[];
	readonly temporal?: MotionTemporalSettings; readonly depthOfFieldSamples?: number;
	readonly tracking?: readonly MotionTrackingResult[];
	readonly trackingApplications?: readonly MotionTrackingApplication[];
}
