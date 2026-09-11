/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_CLOSE_GAP_BEHAVIORS,
	type AudioEditorCloseGapBehavior,
} from '../../editing-preferences.ts';
import type {
	ConfiguredAudioEditorDeleteBehavior,
	DeleteBehaviorConfirmationDecision,
	DeleteBehaviorConfirmationRequest,
} from '../../delete-behavior-onboarding.ts';

export type {
	ConfiguredAudioEditorDeleteBehavior,
	DeleteBehaviorConfirmationDecision,
	DeleteBehaviorConfirmationRequest,
} from '../../delete-behavior-onboarding.ts';

export type DefaultDeleteEditAction = 'cut' | 'delete';
export type ConfiguredDeleteEditAction =
	| 'cut-leave-gap'
	| 'cut-per-clip-ripple'
	| 'cut-per-track-ripple'
	| 'cut-all-tracks-ripple'
	| 'delete-leave-gap'
	| 'delete-per-clip-ripple'
	| 'delete-per-track-ripple'
	| 'delete-all-tracks-ripple';

export interface DeleteBehaviorOnboardingRequest<Result> {
	readonly action: DefaultDeleteEditAction;
	readonly title: string;
	readonly initialCloseGapBehavior: AudioEditorCloseGapBehavior;
	readonly signal?: AbortSignal;
	readonly confirm: (
		request: Readonly<DeleteBehaviorConfirmationRequest>,
	) => PromiseLike<DeleteBehaviorConfirmationDecision> | DeleteBehaviorConfirmationDecision;
	readonly updatePreferences: (editing: Readonly<{
		readonly deleteBehavior: ConfiguredAudioEditorDeleteBehavior;
		readonly closeGapBehavior: AudioEditorCloseGapBehavior;
	}>) => PromiseLike<unknown> | unknown;
	readonly assertCurrent: () => void;
	readonly apply: (action: ConfiguredDeleteEditAction) => Result;
}

/**
 * Complete Audacity's one-time delete choice without leaving a stale edit
 * parked across either the modal or durable preference write.
 */
export async function completeDeleteBehaviorOnboarding<Result>(
	request: Readonly<DeleteBehaviorOnboardingRequest<Result>>,
): Promise<Awaited<Result> | null> {
	const title = boundedTitle(request.title);
	const initialCloseGapBehavior = closeGapBehavior(request.initialCloseGapBehavior);
	request.assertCurrent();
	const decision = confirmationDecision(await request.confirm(Object.freeze({
		title,
		initialDeleteBehavior: 'leave-gap' as const,
		initialCloseGapBehavior,
		...(request.signal ? { signal: request.signal } : {}),
	})));
	if (!decision.accepted) return null;
	request.assertCurrent();
	await request.updatePreferences(Object.freeze({
		deleteBehavior: decision.deleteBehavior,
		closeGapBehavior: decision.closeGapBehavior,
	}));
	request.assertCurrent();
	return await request.apply(configuredAction(request.action, decision));
}

function configuredAction(
	action: DefaultDeleteEditAction,
	decision: Extract<DeleteBehaviorConfirmationDecision, { readonly accepted: true }>,
): ConfiguredDeleteEditAction {
	if (decision.deleteBehavior === 'leave-gap') return `${action}-leave-gap`;
	switch (decision.closeGapBehavior) {
	case 'clip': return `${action}-per-clip-ripple`;
	case 'track': return `${action}-per-track-ripple`;
	case 'all-tracks': return `${action}-all-tracks-ripple`;
	}
}

function confirmationDecision(value: unknown): DeleteBehaviorConfirmationDecision {
	const decision = closedRecord(value, 'Delete behavior confirmation decision');
	if (typeof decision.accepted !== 'boolean') {
		throw new TypeError('Delete behavior confirmation accepted must be boolean.');
	}
	if (!decision.accepted) {
		assertExactKeys(decision, ['accepted'], 'dismissed delete behavior confirmation');
		return Object.freeze({ accepted: false });
	}
	assertExactKeys(
		decision,
		['accepted', 'deleteBehavior', 'closeGapBehavior'],
		'accepted delete behavior confirmation',
	);
	if (decision.deleteBehavior !== 'leave-gap' && decision.deleteBehavior !== 'close-gap') {
		throw new RangeError('Delete behavior confirmation must choose a concrete delete behavior.');
	}
	return Object.freeze({
		accepted: true,
		deleteBehavior: decision.deleteBehavior,
		closeGapBehavior: closeGapBehavior(decision.closeGapBehavior),
	});
}

function closeGapBehavior(value: unknown): AudioEditorCloseGapBehavior {
	if (!AUDIO_EDITOR_CLOSE_GAP_BEHAVIORS.includes(value as AudioEditorCloseGapBehavior)) {
		throw new RangeError(`Unsupported close-gap behavior: ${String(value)}.`);
	}
	return value as AudioEditorCloseGapBehavior;
}

function boundedTitle(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 4_096) {
		throw new TypeError('Delete behavior confirmation title must be bounded text.');
	}
	return value;
}

function closedRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const output: Record<string, unknown> = Object.create(null);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} may only contain string fields.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an enumerable data property.`);
		}
		output[key] = descriptor.value;
	}
	return output;
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
	if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
		throw new TypeError(`${name} has unsupported fields.`);
	}
}
