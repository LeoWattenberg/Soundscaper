/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	cloneFramescaperProjectHistoryV18,
	type FramescaperProjectHistoryV18,
} from './editor-project-v18-history.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import { cloneFramescaperProjectV18, type FramescaperProjectV18 } from './editor-project-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';
import { cloneFramescaperProjectHistoryV19 } from './editor-project-v19-history.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v19.ts';
import { framescaperProjectV18FoundationV19 } from './editor-project-v19-validation.ts';
import { cloneFramescaperProjectHistoryV20 } from './editor-project-v20-history.ts';
import { assertFramescaperProjectV20Profile } from './editor-project-v20-profile.ts';
import { framescaperProjectV19FoundationV20 } from './editor-project-v20-validation.ts';

export interface FramescaperClaimCleanupProjectProfile {
	project(value: unknown): FramescaperProjectV18;
	historyProjects(value: unknown): readonly FramescaperProjectV18[];
}

/** Validate V18 directly and project V19/V20 to the attachment-preserving V18 foundation. */
export function framescaperClaimCleanupProjectProfile(
	profile: EditorProjectRuntimeProfile | unknown,
): FramescaperClaimCleanupProjectProfile {
	try {
		assertFramescaperProjectV18Profile(profile);
		return Object.freeze({
			project: (value: unknown) => cloneFramescaperProjectV18(profile, value),
			historyProjects: (value: unknown) => v18HistoryProjects(
				cloneFramescaperProjectHistoryV18(profile, value),
			),
		});
	} catch (v18Error) {
		try { assertFramescaperProjectV19Profile(profile); }
		catch (v19Error) {
			try { assertFramescaperProjectV20Profile(profile); }
			catch (v20Error) {
				throw new AggregateError(
					[v18Error, v19Error, v20Error],
					'An exact maintained Framescaper capture-cleanup runtime profile is required.',
				);
			}
			const project = (value: unknown) => cloneFramescaperProjectV18(
				FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
				framescaperProjectV18FoundationV19(
					FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
					framescaperProjectV19FoundationV20(profile, value),
				),
			);
			return Object.freeze({
				project,
				historyProjects: (value: unknown) => {
					const history = cloneFramescaperProjectHistoryV20(profile, value);
					return Object.freeze([
						project(history.present),
						...history.undoStack.map(({ project: snapshot }) => project(snapshot)),
						...history.redoStack.map(({ project: snapshot }) => project(snapshot)),
					]);
				},
			});
		}
		const project = (value: unknown) => cloneFramescaperProjectV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV18FoundationV19(profile, value),
		);
		return Object.freeze({
			project,
			historyProjects: (value: unknown) => {
				const history = cloneFramescaperProjectHistoryV19(profile, value);
				return Object.freeze([
					project(history.present),
					...history.undoStack.map(({ project: snapshot }) => project(snapshot)),
					...history.redoStack.map(({ project: snapshot }) => project(snapshot)),
				]);
			},
		});
	}
}

function v18HistoryProjects(history: FramescaperProjectHistoryV18): readonly FramescaperProjectV18[] {
	return Object.freeze([
		history.present,
		...history.undoStack.map(({ project }) => project),
		...history.redoStack.map(({ project }) => project),
	]);
}
