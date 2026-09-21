/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	dispatchLinkedAudioChoice,
	prepareLinkedAudioChoice,
} from './linked-audio-choice-handoff.ts';

type MaybePromise<Value> = PromiseLike<Value> | Value;

interface LinkedVideoLocator {
	readonly locatorId: string;
	readonly locatorRevision: string;
}

interface LinkedVideoChoice extends LinkedVideoLocator {
	readonly file: Blob;
}

interface LinkedVideoRelinkController {
	readonly actions: Readonly<{ readonly projectBin: Readonly<{
		classifyLinkedVideoRelink(clipId: string, file: Blob): MaybePromise<'exact-content' | 'changed-content'>;
		relinkLinkedVideo(
			clipId: string,
			file: Blob,
			locator: LinkedVideoLocator,
			options?: Readonly<{ readonly allowChangedContent?: boolean }>,
		): MaybePromise<string>;
	}> }>;
}

interface LinkedVideoRelinkFileService {
	chooseLinkedVideoOriginal(): MaybePromise<LinkedVideoChoice | null>;
	releaseLinkedVideoOriginal(locator: LinkedVideoLocator): MaybePromise<boolean>;
}

export interface RetainedLinkedVideoRelinkChoice {
	readonly file: Blob;
	readonly locator: LinkedVideoLocator;
	apply(): Promise<string>;
}

/** Keeps a chosen locator UI-owned until classification or controller dispatch settles ownership. */
export async function handoffLinkedVideoRelinkChoice<Scope extends object>(
	controller: LinkedVideoRelinkController,
	fileService: LinkedVideoRelinkFileService,
	clipId: string,
	scope: Scope,
	isCurrent: (scope: Scope) => boolean,
	retain: (choice: Readonly<RetainedLinkedVideoRelinkChoice>) => void,
): Promise<void> {
	const release = (locator: LinkedVideoLocator) => fileService.releaseLinkedVideoOriginal(locator);
	const prepared = await prepareLinkedAudioChoice({
		choose: () => fileService.chooseLinkedVideoOriginal(),
		isCurrent,
		release,
		classify: (file) => controller.actions.projectBin.classifyLinkedVideoRelink(clipId, file),
	}, scope);
	if (!prepared) return;
	const dispatch = (allowChangedContent: boolean) => dispatchLinkedAudioChoice({
		release,
		accept: (file, locator) => allowChangedContent
			? controller.actions.projectBin.relinkLinkedVideo(clipId, file, locator, { allowChangedContent: true })
			: controller.actions.projectBin.relinkLinkedVideo(clipId, file, locator),
	}, prepared);
	if (prepared.classification === 'changed-content') {
		await dispatchLinkedAudioChoice({
			release,
			accept: (file, locator) => retain(Object.freeze({
				file,
				locator,
				apply: () => dispatch(true),
			})),
		}, prepared);
		return;
	}
	await dispatch(false);
}
