/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioEditorSessionClipboard,
	type AudioEditorSessionClipboard,
	type CreateAudioEditorSessionClipboardOptions,
} from '../common/editor/session-clipboard-codec.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	cloneFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18.ts';

export interface FramescaperNestedSequenceCrossProductCopyRequestV18 {
	readonly targetProduct: 'soundscaper';
	readonly mode: 'copy-only-preservation';
}

export interface FramescaperNestedSequenceCrossProductCopyV18 {
	readonly kind: 'framescaper-nested-sequence-cross-product-copy';
	readonly targetProduct: 'soundscaper';
	readonly mode: 'copy-only-preservation';
	readonly activation: 'forbidden';
	readonly editable: false;
	readonly project: FramescaperProjectV18;
}

const COPY_REQUEST_FIELDS = ['targetProduct', 'mode'] as const;

/**
 * Detach a V18 nested graph for opaque Soundscaper preservation. This is not
 * an activation or schema-conversion authority.
 */
export function prepareFramescaperNestedSequenceCrossProductCopyV18(
	profile: unknown,
	projectValue: unknown,
	requestValue: FramescaperNestedSequenceCrossProductCopyRequestV18 | unknown,
): Readonly<FramescaperNestedSequenceCrossProductCopyV18> {
	assertFramescaperProjectV18Profile(profile);
	const project = cloneFramescaperProjectV18(profile, projectValue);
	if (project.subsequences.length === 0) {
		throw new Error('A Framescaper nested-sequence cross-product copy requires a nonempty V18 graph.');
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
 * Delegate flat V18 selections to the established session clipboard. Nested
 * graphs fail closed because that descriptor has no subsequence ownership.
 */
export function createFramescaperSessionClipboardV18(
	profile: unknown,
	projectValue: unknown,
	options: CreateAudioEditorSessionClipboardOptions = {},
): AudioEditorSessionClipboard {
	assertFramescaperProjectV18Profile(profile);
	const project = cloneFramescaperProjectV18(profile, projectValue);
	if (project.subsequences.length > 0) {
		throw new Error(
			'The Framescaper V18 session clipboard cannot preserve a nested-sequence graph; '
			+ 'use .scape copy-only preservation.',
		);
	}
	return createAudioEditorSessionClipboard(project, options);
}

function copyRequest(value: unknown): FramescaperNestedSequenceCrossProductCopyRequestV18 {
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
