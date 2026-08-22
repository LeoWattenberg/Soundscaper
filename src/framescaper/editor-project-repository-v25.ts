/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectRepositoryPort } from '../common/editor/storage/project-repository.ts';
import { FramescaperCandidateProjectRepository } from './editor-project-candidate-repository.ts';
import { assertFramescaperProjectV25CandidateProfile } from './editor-project-runtime-profile-v25.ts';
import { cloneFramescaperProjectV25, loadFramescaperProjectV25 } from './editor-project-v25.ts';

export class FramescaperProjectRepositoryV25 extends FramescaperCandidateProjectRepository {
	constructor(profile: unknown, delegate: ProjectRepositoryPort | unknown) {
		assertFramescaperProjectV25CandidateProfile(profile);
		super({
			label: 'V25', profile, authenticate: assertFramescaperProjectV25CandidateProfile,
			cloneExact: cloneFramescaperProjectV25, load: loadFramescaperProjectV25,
		}, delegate);
	}
}
