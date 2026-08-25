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
import {
	type FramescaperProjectHistoryV27,
	validateFramescaperProjectHistoryV27,
} from './editor-project-v27-history.ts';
import {
	FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
	assertFramescaperProjectV27Profile,
} from './editor-project-runtime-profile-v27.ts';
import { framescaperProjectV20FoundationV27 } from './editor-project-v27-runtime.ts';
import type { FramescaperProjectV27 } from './editor-project-v27.ts';
import {
	type FramescaperProjectHistoryV28,
	validateFramescaperProjectHistoryV28,
} from './editor-project-v28-history.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';
import {
	type FramescaperProjectHistoryV31,
	validateFramescaperProjectHistoryV31,
} from './editor-project-v31-history.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import { FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v31.ts';

export interface FramescaperClaimCleanupProjectProfile {
	project(value: unknown): FramescaperProjectV18;
	historyProjects(value: unknown): readonly FramescaperProjectV18[];
}

/** Validate V18 directly and project V19/V20 to the attachment-preserving V18 foundation. */
export function framescaperClaimCleanupProjectProfile(
	profile: EditorProjectRuntimeProfile | unknown,
): FramescaperClaimCleanupProjectProfile {
	if (profile === FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE) {
		const project = (value: unknown) => v20FoundationProject(
			framescaperProjectV20FoundationV27(
				FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
				framescaperProjectV27FoundationShapeV28(
					framescaperProjectV28FoundationShapeV31(value),
				),
			),
		);
		return Object.freeze({
			project,
			historyProjects: (value: unknown) => {
				validateFramescaperProjectHistoryV31(profile, value);
				const history = value as FramescaperProjectHistoryV31;
				return Object.freeze([
					project(history.present),
					...history.undoStack.map(({ project: snapshot }) => project(snapshot)),
					...history.redoStack.map(({ project: snapshot }) => project(snapshot)),
				]);
			},
		});
	}
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
				try { assertFramescaperProjectV27Profile(profile); }
				catch (v27Error) {
					try { assertFramescaperProjectV28Profile(profile); }
					catch (v28Error) {
						throw new AggregateError(
							[v18Error, v19Error, v20Error, v27Error, v28Error],
							'An exact maintained Framescaper capture-cleanup runtime profile is required.',
						);
					}
					const project = (value: unknown) => v20FoundationProject(
						framescaperProjectV20FoundationV27(
							FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
							framescaperProjectV27FoundationShapeV28(value as FramescaperProjectV28),
						),
					);
					return Object.freeze({
						project,
						historyProjects: (value: unknown) => {
							validateFramescaperProjectHistoryV28(profile, value);
							return historyProjectRootsV28(value as FramescaperProjectHistoryV28, project);
						},
					});
				}
				const project = (value: unknown) => v20FoundationProject(
					framescaperProjectV20FoundationV27(profile, value as FramescaperProjectV27),
				);
				return Object.freeze({
					project,
					historyProjects: (value: unknown) => {
						validateFramescaperProjectHistoryV27(profile, value);
						const history = value as FramescaperProjectHistoryV27;
						return historyProjectRoots(history, project);
					},
				});
			}
			const project = (value: unknown) => v20FoundationProject(
				framescaperProjectV19FoundationV20(profile, value),
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

function v20FoundationProject(value: unknown): FramescaperProjectV18 {
	return cloneFramescaperProjectV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV18FoundationV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, value),
	);
}

function historyProjectRoots(
	history: FramescaperProjectHistoryV27,
	project: (value: unknown) => FramescaperProjectV18,
): readonly FramescaperProjectV18[] {
	return Object.freeze([
		project(history.present),
		...history.undoStack.map(({ project: snapshot }) => project(snapshot)),
		...history.redoStack.map(({ project: snapshot }) => project(snapshot)),
	]);
}

function historyProjectRootsV28(
	history: FramescaperProjectHistoryV28,
	project: (value: unknown) => FramescaperProjectV18,
): readonly FramescaperProjectV18[] {
	return Object.freeze([
		project(history.present),
		...history.undoStack.map(({ project: snapshot }) => project(snapshot)),
		...history.redoStack.map(({ project: snapshot }) => project(snapshot)),
	]);
}

function v18HistoryProjects(history: FramescaperProjectHistoryV18): readonly FramescaperProjectV18[] {
	return Object.freeze([
		history.present,
		...history.undoStack.map(({ project }) => project),
		...history.redoStack.map(({ project }) => project),
	]);
}
