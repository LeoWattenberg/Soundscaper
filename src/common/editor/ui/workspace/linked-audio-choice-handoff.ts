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

type LinkedAudioChoiceClassification = 'exact-content' | 'changed-content';

interface LinkedAudioChoicePreparation<Scope extends object> {
	choose(): PromiseLike<LinkedAudioChoice | null> | LinkedAudioChoice | null;
	isCurrent(scope: Scope): boolean;
	release(reference: LinkedAudioReference): MaybePromise<boolean>;
	classify(file: Blob, reference: LinkedAudioReference): MaybePromise<LinkedAudioChoiceClassification>;
}

interface LinkedAudioChoiceDispatch<Result> {
	release(reference: LinkedAudioReference): MaybePromise<boolean>;
	accept(file: Blob, reference: LinkedAudioReference): MaybePromise<Result>;
}

export interface PreparedLinkedAudioChoice {
	readonly classification: LinkedAudioChoiceClassification;
	readonly file: Blob;
	readonly reference: LinkedAudioReference;
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

/** Classify one current chooser result while the UI retains its locator ownership. */
export async function prepareLinkedAudioChoice<Scope extends object>(
	dependencies: LinkedAudioChoicePreparation<Scope>,
	scope: Scope,
): Promise<Readonly<PreparedLinkedAudioChoice> | null> {
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
	let classification: LinkedAudioChoiceClassification;
	try {
		classification = await dependencies.classify(choice.file, reference);
		if (classification !== 'exact-content' && classification !== 'changed-content') {
			throw new TypeError('Linked-audio relink classification is invalid.');
		}
	} catch (error) {
		throw await failureWithRelease(
			error,
			dependencies.release,
			reference,
			'Linked-audio relink classification and locator cleanup both failed.',
		);
	}
	if (!dependencies.isCurrent(scope)) {
		await releaseChoice(dependencies.release, reference);
		return null;
	}
	return Object.freeze({ classification, file: choice.file, reference });
}

/** Transfer one prepared locator to a controller operation at its synchronous call boundary. */
export async function dispatchLinkedAudioChoice<Result>(
	dependencies: LinkedAudioChoiceDispatch<Result>,
	prepared: Readonly<PreparedLinkedAudioChoice>,
): Promise<Result> {
	let operation: MaybePromise<Result>;
	try {
		operation = dependencies.accept(prepared.file, prepared.reference);
	} catch (error) {
		throw await failureWithRelease(
			error,
			dependencies.release,
			prepared.reference,
			'Linked-audio relink dispatch and locator cleanup both failed.',
		);
	}
	return await operation;
}

async function failureWithRelease(
	primary: unknown,
	release: (reference: LinkedAudioReference) => MaybePromise<boolean>,
	reference: LinkedAudioReference,
	message: string,
): Promise<unknown> {
	try {
		await releaseChoice(release, reference);
		return primary;
	} catch (cleanupError) {
		return new AggregateError([primary, cleanupError], message, { cause: primary });
	}
}

async function releaseChoice(
	release: (reference: LinkedAudioReference) => MaybePromise<boolean>,
	reference: LinkedAudioReference,
): Promise<void> {
	if (!await release(reference)) {
		throw new Error('The unused linked-audio locator was not released.');
	}
}
