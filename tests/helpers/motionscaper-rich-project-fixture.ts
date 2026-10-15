/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionLayer, createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { normalizeMotionscaperProject } from '../../src/motionscaper/editor-project-validation.ts';
import { digestScapeBytes } from '../../src/common/editor/scape-archive-media.ts';
import { motionColor, motionScalar, motionVector, type MotionPathProperty } from '../../src/common/editor/motion-property.ts';
import type { MotionAsset } from '../../src/common/editor/motion-asset.ts';
import type { MotionLayerContent } from '../../src/common/editor/motion-composition.ts';

export const rational = (num: number, den = 1) => ({ num, den });
export const linear = (first: number, last: number) => ({
	anchors: [{ position: rational(0), value: first }, { position: rational(30), value: last }],
	segments: [{ kind: 'linear' as const }],
});
export const scalar = (first: number, last: number) => ({ ...motionScalar(first), curve: linear(first, last) });
const rectangle = (x: number) => ({ closed: true, vertices: [[x, 0], [x + 8, 0], [x + 8, 8], [x, 8]].map(point => ({
	point: [point[0]!, point[1]!] as const, inTangent: [0, 0] as const, outTangent: [0, 0] as const,
})) });
const path: MotionPathProperty = { kind: 'path', value: rectangle(0), expression: null,
	keyframes: [{ position: rational(0), value: rectangle(0) }, { position: rational(30), value: rectangle(4) }], segments: ['linear'] };

/** Storage/archive authority treats original media bodies as opaque authenticated bytes.
 * These deliberately distinct bodies test retention, not codec or font decoding. */
export function richMotionProjectFixture() {
	const bodies = new Map<string, Uint8Array>();
	const asset = (kind: 'footage' | 'image' | 'audio' | 'font'): MotionAsset => {
		const bytes = new TextEncoder().encode(`retained-${kind}-original\u0000\u00ff`); bodies.set(kind, bytes);
		const sha256 = digestScapeBytes(bytes);
		const common = { id: kind, name: kind, sha256, byteLength: bytes.length, storageKey: `motion-sha256:${sha256}` };
		if (kind === 'font') return { ...common, kind, family: 'Retained', style: 'Regular', mimeType: 'font/otf' };
		if (kind === 'audio') return { ...common, kind, mimeType: 'audio/wav', duration: rational(20), channels: 2, sampleRate: 48000 };
		if (kind === 'image') return { ...common, kind, mimeType: 'image/png', width: 16, height: 16, hasAlpha: true };
		return { ...common, kind, mimeType: 'video/mp4', width: 16, height: 16, hasAlpha: false,
			frameRate: rational(24), duration: rational(20), hasAudio: true };
	};
	const project = createMotionscaperProject({ id: 'all-kinds', title: 'All saved authority', compositionId: 'main' });
	const color = { ...motionColor([0, 0.25, 1, 0.75]), curves: [linear(0, 1), null, linear(1, 0), null] as const };
	const contents: MotionLayerContent[] = [
		{ kind: 'footage', assetId: 'footage', audioEnabled: true, audioGain: scalar(0.25, 0.75) },
		{ kind: 'image', assetId: 'image' },
		{ kind: 'text', document: { runs: [{ text: 'Retained text', fontAssetId: 'font', fontSize: scalar(16, 24),
			color, tracking: scalar(0, 2) }], align: 'center', lineHeight: scalar(1, 1.5),
			boxSize: { ...motionVector([100, 80]), curves: [linear(100, 200), null] } } },
		{ kind: 'shapes', shapes: [{ id: 'morph', path, fill: color,
			stroke: { color, width: scalar(1, 3), lineCap: 'round', lineJoin: 'bevel' } }] },
		{ kind: 'solid', color, size: { ...motionVector([16, 16]), curves: [linear(16, 32), null] } },
		{ kind: 'null' },
		{ kind: 'adjustment', targetLayerIds: ['footage'] },
		{ kind: 'precomp', compositionId: 'child' },
		{ kind: 'camera', projection: 'perspective', zoom: scalar(800, 1200), near: 0.1, far: 10000,
			focusDistance: scalar(100, 200), aperture: scalar(0, 2) },
		{ kind: 'light', lightType: 'spot', color, intensity: scalar(1, 3), coneAngle: scalar(30, 60),
			coneFeather: scalar(0.25, 0.75), castsShadows: true },
	];
	const layers = contents.map(content => {
		const layer = createMotionLayer({ id: content.kind, name: content.kind, durationFrames: 300, content });
		if (content.kind === 'null') return { ...layer, transform: { ...layer.transform,
			position: { ...motionVector([0, 4, 0]), curves: [linear(0, 30), null, null] as const } } };
		if (content.kind === 'image') return { ...layer, parentId: 'null' };
		if (content.kind === 'precomp') return { ...layer, sourceStart: rational(1), timeScale: rational(-1, 2), timeRemap: scalar(2, 3) };
		return layer;
	});
	const child = { ...project.compositions[0]!, id: 'child', name: '24 fps child', frameRate: rational(24), layers: [] };
	return { bodies, project: normalizeMotionscaperProject({ ...project, assets: ['footage', 'image', 'audio', 'font'].map(kind => asset(kind as Parameters<typeof asset>[0])),
		compositions: [{ ...project.compositions[0]!, layers, audio: [{ id: 'audio-placement', assetId: 'audio', startFrame: rational(0),
			inFrame: rational(0), outFrame: rational(300), sourceStart: rational(1, 4), timeScale: rational(1), enabled: true, gain: scalar(0.5, 1) }] }, child] }) };
}
