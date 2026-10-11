/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionscaperProject, createMotionLayer } from '../../src/motionscaper/editor-project.ts';
import { applyMotionscaperCommands } from '../../src/motionscaper/editor-project-commands.ts';
import { motionScalar } from '../../src/common/editor/motion-property.ts';
export function trackingProject() {
	return applyMotionscaperCommands(createMotionscaperProject({ id: 'tracking-project', title: 'Tracking', compositionId: 'comp', width: 64, height: 64, frameRate: { num: 24, den: 1 }, durationFrames: 24 }), [
		{ type: 'asset/add', asset: { id: 'video', name: 'Retained video', kind: 'footage', sha256: 'a'.repeat(64), byteLength: 10, storageKey: `motion-sha256:${'a'.repeat(64)}`, mimeType: 'video/mp4', width: 64, height: 64, frameRate: { num: 24, den: 1 }, duration: { num: 1, den: 1 }, hasAlpha: false, hasAudio: false } },
		{ type: 'layer/add', compositionId: 'comp', index: 0, layer: createMotionLayer({ id: 'source', name: 'Source', durationFrames: 24, content: { kind: 'footage', assetId: 'video', audioEnabled: false, audioGain: motionScalar(1) } }) },
		{ type: 'layer/add', compositionId: 'comp', index: 0, layer: createMotionLayer({ id: 'overlay', name: 'Overlay', durationFrames: 24, content: { kind: 'null' } }) },
	]);
}
