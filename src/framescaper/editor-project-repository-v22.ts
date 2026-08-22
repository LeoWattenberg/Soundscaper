/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectRepositoryPort } from '../common/editor/storage/project-repository.ts';
import { FramescaperCandidateProjectRepository } from './editor-project-candidate-repository.ts';
import { assertFramescaperProjectV22CandidateProfile } from './editor-project-runtime-profile-v22.ts';
import { cloneFramescaperProjectV22, loadFramescaperProjectV22 } from './editor-project-v22.ts';

export class FramescaperProjectRepositoryV22 extends FramescaperCandidateProjectRepository {
	constructor(profile: unknown, delegate: ProjectRepositoryPort | unknown) {
		assertFramescaperProjectV22CandidateProfile(profile);
		super({
			label: 'V22', profile, authenticate: assertFramescaperProjectV22CandidateProfile,
			cloneExact: cloneFramescaperProjectV22, load: loadFramescaperProjectV22,
		}, delegate);
	}
}
