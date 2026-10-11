/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionAsset } from '../common/editor/motion-asset.ts';
import { motionScalar, motionVector } from '../common/editor/motion-property.ts';
import { compareRationals, multiplyRationals } from '../common/editor/timeline-time.ts';
import { createMotionLayer } from './editor-project.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import type { MotionscaperProjectCommand } from './editor-project-commands.ts';

/** Place media at composition time zero; trim to its exact source duration without changing the frame grid. */
export function createMotionscaperMediaCommands(project: MotionscaperProject, asset: MotionAsset, placementId: string, compositionId = project.primaryCompositionId): readonly MotionscaperProjectCommand[] {
	if (asset.kind === 'font') throw new TypeError('A font is not a media placement.');
	const composition = project.compositions.find((entry) => entry.id === compositionId);
	if (!composition) throw new ReferenceError('The target media composition is missing.');
	const retained = project.assets.find((entry) => entry.kind === asset.kind && entry.sha256 === asset.sha256);
	const assetId = retained?.id ?? asset.id;
	const commands: MotionscaperProjectCommand[] = retained ? [] : [{ type: 'asset/add', asset }];
	const end = { num: composition.durationFrames, den: 1 };
	const sourceEnd = asset.kind === 'image' ? end : multiplyRationals(asset.duration, composition.frameRate);
	const outFrame = compareRationals(sourceEnd, end) < 0 ? sourceEnd : end;
	if (asset.kind === 'audio') {
		commands.push({ type: 'composition/replace', composition: { ...composition, audio: [...composition.audio, {
			id: placementId, assetId, startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame,
			sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, enabled: true, gain: motionScalar(1),
		}] } });
	} else {
		const layer = createMotionLayer({ id: placementId, name: asset.name, durationFrames: composition.durationFrames,
			content: asset.kind === 'image' ? { kind: 'image', assetId } : { kind: 'footage', assetId, audioEnabled: asset.hasAudio, audioGain: motionScalar(1) } });
		commands.push({ type: 'layer/add', compositionId: composition.id, index: 0, layer: { ...layer, outFrame,
			transform: { ...layer.transform, position: motionVector([(composition.width - asset.width) / 2, (composition.height - asset.height) / 2, 0]) } } });
	}
	return commands;
}
