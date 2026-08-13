/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	cloneFramescaperProjectHistoryV18,
	createFramescaperProjectHistoryV18,
	validateFramescaperProjectHistoryV18,
	type FramescaperProjectHistoryV18,
} from './editor-project-v18-history.ts';
import type { FramescaperProjectV18 } from './editor-project-v18.ts';

export interface FramescaperProjectSessionCaptureV18 {
	readonly history: FramescaperProjectHistoryV18;
	readonly token: object;
}

export interface FramescaperProjectSessionV18 {
	readonly capture: () => FramescaperProjectSessionCaptureV18;
	readonly install: (
		token: object,
		history: FramescaperProjectHistoryV18 | unknown,
	) => FramescaperProjectV18;
	readonly snapshot: () => FramescaperProjectHistoryV18;
}

/** Private single-project seam for validating history before one atomic visible install. */
export function createFramescaperProjectSessionV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV18 | unknown,
): FramescaperProjectSessionV18 {
	assertFramescaperProjectV18Profile(profile);
	let history = createFramescaperProjectHistoryV18(profile, project);
	let token = Object.freeze({});

	const capture = (): FramescaperProjectSessionCaptureV18 => Object.freeze({
		history: cloneFramescaperProjectHistoryV18(profile, history),
		token,
	});
	const install = (
		expectedToken: object,
		candidate: FramescaperProjectHistoryV18 | unknown,
	): FramescaperProjectV18 => {
		if (expectedToken !== token) throw new Error('The Framescaper V18 project history changed.');
		validateFramescaperProjectHistoryV18(profile, candidate);
		const valid = candidate as FramescaperProjectHistoryV18;
		if (valid.present.id !== history.present.id) {
			throw new RangeError('A Framescaper V18 session install cannot change project identity.');
		}
		const installed = cloneFramescaperProjectHistoryV18(profile, valid);
		history = installed;
		token = Object.freeze({});
		return cloneFramescaperProjectHistoryV18(profile, history).present;
	};
	const snapshot = (): FramescaperProjectHistoryV18 => cloneFramescaperProjectHistoryV18(profile, history);
	return Object.freeze({ capture, install, snapshot });
}
