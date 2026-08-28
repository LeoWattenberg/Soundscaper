/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioEditorSessionClipboard,
	type AudioEditorSessionClipboard,
	type CreateAudioEditorSessionClipboardOptions,
} from '../common/editor/session-clipboard-codec.ts';
import { assertFramescaperProjectSequenceProfile } from './editor-project-sequence-profile.ts';
import {
	cloneFramescaperProjectSequence,
	type FramescaperProjectSequence,
} from './editor-project-sequence.ts';

export interface FramescaperNestedSequenceCrossProductCopyRequestSequence {
	readonly targetProduct: 'soundscaper';
	readonly mode: 'copy-only-preservation';
}

export interface FramescaperNestedSequenceCrossProductCopySequence {
	readonly kind: 'framescaper-nested-sequence-cross-product-copy';
	readonly targetProduct: 'soundscaper';
	readonly mode: 'copy-only-preservation';
	readonly activation: 'forbidden';
	readonly editable: false;
	readonly project: FramescaperProjectSequence;
}

export interface FramescaperMulticameraCrossProductCopyRequestSequence {
	readonly targetProduct: 'soundscaper';
	readonly mode: 'copy-only-preservation';
}

export interface FramescaperMulticameraCrossProductCopySequence {
	readonly kind: 'framescaper-multicamera-cross-product-copy';
	readonly targetProduct: 'soundscaper';
	readonly mode: 'copy-only-preservation';
	readonly activation: 'forbidden';
	readonly editable: false;
	readonly project: FramescaperProjectSequence;
}

const COPY_REQUEST_FIELDS = ['targetProduct', 'mode'] as const;

/**
 * Detach a sequence nested graph for opaque Soundscaper preservation. This is not
 * an activation or schema-conversion authority.
 */
export function prepareFramescaperNestedSequenceCrossProductCopySequence(
	profile: unknown,
	projectValue: unknown,
	requestValue: FramescaperNestedSequenceCrossProductCopyRequestSequence | unknown,
): Readonly<FramescaperNestedSequenceCrossProductCopySequence> {
	assertFramescaperProjectSequenceProfile(profile);
	const project = cloneFramescaperProjectSequence(profile, projectValue);
	if (project.subsequences.length === 0) {
		throw new Error('A Framescaper nested-sequence cross-product copy requires a nonempty sequence graph.');
	}
	const request = copyRequest(requestValue);
	return Object.freeze({
		kind: 'framescaper-nested-sequence-cross-product-copy',
		targetProduct: request.targetProduct,
		mode: request.mode,
		activation: 'forbidden',
		editable: false,
		project,
	});
}

/**
 * Detach a sequence multicamera graph for opaque Soundscaper preservation. The
 * recipient remains read-only and cannot activate the Framescaper graph.
 */
export function prepareFramescaperMulticameraCrossProductCopySequence(
	profile: unknown,
	projectValue: unknown,
	requestValue: FramescaperMulticameraCrossProductCopyRequestSequence | unknown,
): Readonly<FramescaperMulticameraCrossProductCopySequence> {
	assertFramescaperProjectSequenceProfile(profile);
	const project = cloneFramescaperProjectSequence(profile, projectValue);
	if (project.multicameraGroups.length === 0) {
		throw new Error('A Framescaper multicamera cross-product copy requires a nonempty sequence graph.');
	}
	const request = copyRequest(requestValue);
	return Object.freeze({
		kind: 'framescaper-multicamera-cross-product-copy',
		targetProduct: request.targetProduct,
		mode: request.mode,
		activation: 'forbidden',
		editable: false,
		project,
	});
}

/**
 * Delegate flat sequence selections to the established session clipboard. Nested
 * graphs fail closed because that descriptor has no subsequence ownership.
 */
export function createFramescaperSessionClipboardSequence(
	profile: unknown,
	projectValue: unknown,
	options: CreateAudioEditorSessionClipboardOptions = {},
): AudioEditorSessionClipboard {
	assertFramescaperProjectSequenceProfile(profile);
	const project = cloneFramescaperProjectSequence(profile, projectValue);
	if (project.subsequences.length > 0) {
		throw new Error(
			'The Framescaper sequence session clipboard cannot preserve a nested-sequence graph; '
			+ 'use Scape copy-only preservation.',
		);
	}
	if (project.multicameraGroups.length > 0) {
		throw new Error(
			'The Framescaper sequence session clipboard cannot preserve a multicamera graph; '
			+ 'use Scape copy-only preservation.',
		);
	}
	return createAudioEditorSessionClipboard(project, options);
}

function copyRequest(value: unknown): FramescaperNestedSequenceCrossProductCopyRequestSequence {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('A Framescaper nested-sequence cross-product copy request is required.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== COPY_REQUEST_FIELDS.length
		|| keys.some((key) => typeof key !== 'string' || !COPY_REQUEST_FIELDS.includes(
			key as typeof COPY_REQUEST_FIELDS[number],
		))) {
		throw new TypeError('The Framescaper nested-sequence cross-product copy request is not exact.');
	}
	const targetProduct = ownData(value, 'targetProduct');
	const mode = ownData(value, 'mode');
	if (targetProduct !== 'soundscaper') {
		throw new RangeError('A nested-sequence cross-product preservation copy must target Soundscaper.');
	}
	if (mode !== 'copy-only-preservation') {
		throw new RangeError('A nested-sequence cross-product transfer must be copy-only preservation.');
	}
	return Object.freeze({ targetProduct, mode });
}

function ownData(value: object, key: typeof COPY_REQUEST_FIELDS[number]): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`The Framescaper nested-sequence copy request ${key} must be an own data property.`);
	}
	return descriptor.value;
}
