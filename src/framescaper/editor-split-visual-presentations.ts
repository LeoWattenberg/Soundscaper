/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoVisualPresentationV1,
	type VideoVisualPresentationV1,
} from '../common/editor/video-visual-presentation-v27.ts';
import type { FramescaperVideoVisualPresentationSetCommandFinishing } from './editor-project-finishing-finishing-command.ts';

/** Track authored presentation changes while preparing one ordered split transaction. */
export function createSplitVisualPresentationPlanner(values: readonly VideoVisualPresentationV1[]): Readonly<{
	observe(command: FramescaperVideoVisualPresentationSetCommandFinishing): void;
	copy(clipId: string, rightClipId: string): readonly FramescaperVideoVisualPresentationSetCommandFinishing[];
}> {
	const presentations = new Map(values.map(value => [value.id, value]));
	return Object.freeze({ observe, copy });

	function observe(command: FramescaperVideoVisualPresentationSetCommandFinishing): void {
		if (command.presentation === null) presentations.delete(command.presentationId);
		else presentations.set(command.presentationId, command.presentation);
	}

	function copy(clipId: string, rightClipId: string): readonly FramescaperVideoVisualPresentationSetCommandFinishing[] {
		const commands: FramescaperVideoVisualPresentationSetCommandFinishing[] = [];
		for (const value of [...presentations.values()]) {
			if (value.owner.kind !== 'clip' || value.owner.id !== clipId) continue;
			const stem = `split-presentation-${rightClipId}`.slice(0, 112);
			let id = stem;
			for (let suffix = 1; presentations.has(id); suffix += 1) id = `${stem}-${String(suffix)}`;
			const presentation = normalizeVideoVisualPresentationV1({ ...value, id,
				owner: { kind: 'clip', id: rightClipId } });
			const command: FramescaperVideoVisualPresentationSetCommandFinishing = {
				type: 'video-visual-presentation/set', presentationId: id, expectedPresentation: null, presentation,
			};
			observe(command);
			commands.push(command);
		}
		return commands;
	}
}
