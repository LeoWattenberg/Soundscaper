/* SPDX-License-Identifier: AGPL-3.0-only */

type MaybePromise<Value> = PromiseLike<Value> | Value;

interface LinkedAudioChoice {
	readonly file: Blob;
	readonly locatorId: string;
	readonly locatorRevision: string;
}

interface LinkedAudioReference {
	readonly locatorId: string;
	readonly locatorRevision: string;
}

interface LinkedAudioChoiceHandoff<Scope extends object, Result> {
	choose(): PromiseLike<LinkedAudioChoice | null> | LinkedAudioChoice | null;
	isCurrent(scope: Scope): boolean;
	release(reference: LinkedAudioReference): MaybePromise<boolean>;
	accept(file: Blob, reference: LinkedAudioReference): MaybePromise<Result>;
}

/** Transfers one native locator to the controller only while its UI project scope remains current. */
export async function handoffLinkedAudioChoice<Scope extends object, Result>(
	dependencies: LinkedAudioChoiceHandoff<Scope, Result>,
	scope: Scope,
): Promise<Result | null> {
	const choice = await dependencies.choose();
	if (!choice) return null;
	const reference = Object.freeze({
		locatorId: choice.locatorId,
		locatorRevision: choice.locatorRevision,
	});
	if (!dependencies.isCurrent(scope)) {
		await releaseChoice(dependencies.release, reference);
		return null;
	}
	let operation: MaybePromise<Result>;
	try {
		operation = dependencies.accept(choice.file, reference);
	} catch (error) {
		try {
			await releaseChoice(dependencies.release, reference);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Linked-audio relink dispatch and locator cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
	return await operation;
}

async function releaseChoice(
	release: (reference: LinkedAudioReference) => MaybePromise<boolean>,
	reference: LinkedAudioReference,
): Promise<void> {
	if (!await release(reference)) {
		throw new Error('The unused linked-audio locator was not released.');
	}
}
