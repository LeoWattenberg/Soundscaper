/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import { SOUNDSCAPER_V21_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v21.ts';
import { SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v23.ts';
import { soundscaperProjectStoreAuthorityV21 } from './editor-project-store-v21.ts';
import { soundscaperProjectStoreAuthorityV23 } from './editor-project-store-v23.ts';

/**
 * Authenticate a process-local Soundscaper production runtime authority.
 *
 * The desktop library is shared by every production revision — its schema, scope
 * and database version are the same for V21 and V23 — so its handshake accepts
 * any authentic Soundscaper production profile rather than one exact revision.
 * Pinning it to a single revision would mean the desktop bridge silently refuses
 * the next one, which is the same trap the render gates had.
 */
export function assertSoundscaperProductionProfile(
	profile: unknown,
): asserts profile is EditorProjectRuntimeProfile {
	if (profile !== SOUNDSCAPER_V21_PROJECT_RUNTIME_PROFILE
		&& profile !== SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('An exact Soundscaper production runtime profile is required.');
	}
	editorProjectRuntimeProfileDefinition(profile);
}

/**
 * Resolve the backend identities of a production store, whichever revision made
 * it.
 *
 * Each revision's store module holds its own brand, and that isolation is
 * deliberate — a V21 store must never be accepted by a V23 controller. The
 * dispatch is on the profile rather than on the store, so the brand check still
 * happens inside the owning revision and a mismatched pair is refused there.
 */
export function soundscaperProductionStoreAuthority(profile: unknown, store: unknown): unknown {
	assertSoundscaperProductionProfile(profile);
	return profile === SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE
		? soundscaperProjectStoreAuthorityV23(profile, store)
		: soundscaperProjectStoreAuthorityV21(profile, store);
}
