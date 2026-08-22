/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectRepositoryPort } from '../common/editor/storage/project-repository.ts';
import { FramescaperCandidateProjectRepository } from './editor-project-candidate-repository.ts';
import { assertFramescaperProjectV24CandidateProfile } from './editor-project-runtime-profile-v24.ts';
import { cloneFramescaperProjectV24, loadFramescaperProjectV24 } from './editor-project-v24.ts';

export class FramescaperProjectRepositoryV24 extends FramescaperCandidateProjectRepository {
	constructor(profile: unknown, delegate: ProjectRepositoryPort | unknown) {
		assertFramescaperProjectV24CandidateProfile(profile);
		super({
			label: 'V24', profile, authenticate: assertFramescaperProjectV24CandidateProfile,
			cloneExact: cloneFramescaperProjectV24, load: loadFramescaperProjectV24,
		}, delegate);
	}
}
