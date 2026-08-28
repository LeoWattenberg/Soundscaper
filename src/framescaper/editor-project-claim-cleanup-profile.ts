/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { framescaperProjectNativeMediaFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { framescaperProjectSequenceFoundationComposition } from './editor-project-composition-validation.ts';
import { framescaperProjectRetimeFoundationFinishing } from './editor-project-finishing-runtime.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import {
	validateFramescaperProjectHistory,
	type FramescaperProjectHistory,
} from './editor-project-history.ts';
import { framescaperProjectCompositionFoundationRetime } from './editor-project-retime-validation.ts';
import { cloneFramescaperProjectSequence, type FramescaperProjectSequence } from
	'./editor-project-sequence.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';
import { validateFramescaperProject } from './editor-project.ts';

export interface FramescaperClaimCleanupProjectProfile {
	project(value: unknown): FramescaperProjectSequence;
	historyProjects(value: unknown): readonly FramescaperProjectSequence[];
}

/**
 * Project the one admitted Framescaper domain to the stable proxy-attachment
 * cleanup shape. Product schema admission is the family/version tuple; the
 * narrower shapes below express capabilities, never historical routing.
 */
export function framescaperClaimCleanupProjectProfile(
	profile: EditorProjectRuntimeProfile | unknown,
): FramescaperClaimCleanupProjectProfile {
	assertFramescaperProjectRuntimeProfile(profile);
	const project = (value: unknown): FramescaperProjectSequence => {
		validateFramescaperProject(profile, value);
		const nativeMedia = framescaperProjectNativeMediaFoundationShapeAssistance(value);
		const finishing = framescaperProjectFinishingFoundationShapeNativeMedia(nativeMedia);
		const retime = framescaperProjectRetimeFoundationFinishing(profile, finishing);
		const composition = framescaperProjectCompositionFoundationRetime(profile, retime);
		const sequence = framescaperProjectSequenceFoundationComposition(profile, composition);
		return cloneFramescaperProjectSequence(profile, sequence);
	};
	return Object.freeze({
		project,
		historyProjects(value: unknown) {
			validateFramescaperProjectHistory(profile, value);
			const history = value as FramescaperProjectHistory;
			return Object.freeze([
				project(history.present),
				...history.undoStack.map(({ project: snapshot }) => project(snapshot)),
				...history.redoStack.map(({ project: snapshot }) => project(snapshot)),
			]);
		},
	});
}
