/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectRepositoryPort } from '../common/editor/storage/project-repository.ts';
import { FramescaperCandidateProjectRepository } from './editor-project-candidate-repository.ts';
import { assertFramescaperProjectV26CandidateProfile } from './editor-project-runtime-profile-v26.ts';
import { cloneFramescaperProjectV26, loadFramescaperProjectV26 } from './editor-project-v26.ts';

export class FramescaperProjectRepositoryV26 extends FramescaperCandidateProjectRepository {
	constructor(profile: unknown, delegate: ProjectRepositoryPort | unknown) {
		assertFramescaperProjectV26CandidateProfile(profile);
		super({
			label: 'V26', profile, authenticate: assertFramescaperProjectV26CandidateProfile,
			cloneExact: cloneFramescaperProjectV26, load: loadFramescaperProjectV26,
		}, delegate);
	}
}
