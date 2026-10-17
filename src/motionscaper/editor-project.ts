/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Rational } from '../common/editor/timeline-time.ts';
import type { MotionLayer, MotionLayerContent } from '../common/editor/motion-composition.ts';
import { motionScalar, motionVector } from '../common/editor/motion-property.ts';
import { normalizeMotionLayer } from '../common/editor/motion-layer-validation.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import type { MotionscaperProject } from './editor-project-types.ts';

export type { MotionscaperProject } from './editor-project-types.ts';

export interface CreateMotionscaperProjectOptions {
	readonly id: string; readonly title: string; readonly compositionId: string;
	readonly width?: number; readonly height?: number; readonly frameRate?: Rational;
	readonly durationFrames?: number; readonly sampleRate?: number;
}

export function createMotionscaperProject(options: CreateMotionscaperProjectOptions): MotionscaperProject {
	return normalizeMotionscaperProject({
		schemaFamily: 'motionscaper', schemaVersion: 1, id: options.id, title: options.title, revision: 0,
		sampleRate: options.sampleRate ?? 48000, primaryCompositionId: options.compositionId, assets: [],
		compositions: [{ id: options.compositionId, name: options.title, width: options.width ?? 1920, height: options.height ?? 1080,
			frameRate: options.frameRate ?? { num: 30, den: 1 }, durationFrames: options.durationFrames ?? 300,
			background: [0, 0, 0, 0], color: { workingSpace: 'linear-rec709-d65', outputSpace: 'srgb', alphaMode: 'premultiplied' }, layers: [], audio: [] }],
	});
}

export function createMotionLayer(options: Readonly<{ id: string; name: string; durationFrames: number; content: MotionLayerContent }>): MotionLayer {
	return normalizeMotionLayer({
		id: options.id, name: options.name, enabled: true, parentId: null,
		startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame: { num: options.durationFrames, den: 1 },
		sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, timeRemap: null,
		transform: { anchor: motionVector([0, 0, 0]), position: motionVector([0, 0, 0]), scale: motionVector([1, 1, 1]), rotation: motionVector([0, 0, 0]), opacity: motionScalar(1) },
		is3D: false, material: { acceptsLights: true, castsShadows: false, receivesShadows: true,
			ambient: motionScalar(1), diffuse: motionScalar(1), specular: motionScalar(0), shininess: motionScalar(32) },
		blendMode: 'normal', masks: [], matte: null, effects: [], ...options.content,
	});
}
