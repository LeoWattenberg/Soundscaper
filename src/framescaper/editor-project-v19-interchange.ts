/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';
import { digestScapeBytes } from '../common/editor/scape-archive-media.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import {
	cloneFramescaperProjectV19,
	type FramescaperProjectV19,
} from './editor-project-v19.ts';

export interface FramescaperVideoCompositionCrossProductCopyRequestV19 {
	readonly targetProduct: 'soundscaper';
	readonly mode: 'copy-only-preservation';
}

export interface FramescaperVideoCompositionCrossProductCopyV19 {
	readonly kind: 'framescaper-video-composition-cross-product-copy';
	readonly targetProduct: 'soundscaper';
	readonly mode: 'copy-only-preservation';
	readonly activation: 'forbidden';
	readonly editable: false;
	readonly projectSha256: string;
	readonly project: FramescaperProjectV19;
}

const REQUEST_FIELDS = ['targetProduct', 'mode'] as const;
const COPY_FIELDS = [
	'kind', 'targetProduct', 'mode', 'activation', 'editable', 'projectSha256', 'project',
] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TEXT_ENCODER = new TextEncoder();

/**
 * Detach an exact V19 composition project for opaque Soundscaper custody.
 * The descriptor carries no activation, edit, migration, or projection API.
 */
export function prepareFramescaperVideoCompositionCrossProductCopyV19(
	profile: unknown,
	projectValue: unknown,
	requestValue: FramescaperVideoCompositionCrossProductCopyRequestV19 | unknown,
): Readonly<FramescaperVideoCompositionCrossProductCopyV19> {
	assertFramescaperProjectV19Profile(profile);
	const request = copyRequest(requestValue);
	const project = cloneFramescaperProjectV19(profile, projectValue);
	assertCompositionOccurrence(project);
	return Object.freeze({
		kind: 'framescaper-video-composition-cross-product-copy',
		targetProduct: request.targetProduct,
		mode: request.mode,
		activation: 'forbidden',
		editable: false,
		projectSha256: projectFingerprint(project),
		project,
	});
}

/**
 * Re-authenticate a preservation-only descriptor at the V19 owner boundary.
 * A changed policy scalar or a malformed project fails before gaining native
 * activation or edit authority.
 */
export function restoreFramescaperVideoCompositionCrossProductCopyV19(
	profile: unknown,
	copyValue: FramescaperVideoCompositionCrossProductCopyV19 | unknown,
): FramescaperProjectV19 {
	assertFramescaperProjectV19Profile(profile);
	const copy = closedRecord(copyValue, COPY_FIELDS, 'Framescaper V19 cross-product copy');
	if (ownData(copy, 'kind') !== 'framescaper-video-composition-cross-product-copy') {
		throw new RangeError('The Framescaper V19 cross-product copy kind is invalid.');
	}
	if (ownData(copy, 'targetProduct') !== 'soundscaper') {
		throw new RangeError('The Framescaper V19 cross-product copy must target Soundscaper.');
	}
	if (ownData(copy, 'mode') !== 'copy-only-preservation') {
		throw new RangeError('The Framescaper V19 cross-product copy mode must remain copy-only preservation.');
	}
	if (ownData(copy, 'activation') !== 'forbidden') {
		throw new RangeError('The Framescaper V19 cross-product copy activation must remain forbidden.');
	}
	if (ownData(copy, 'editable') !== false) {
		throw new RangeError('The Framescaper V19 cross-product copy editable flag must remain false.');
	}
	const expectedFingerprint = ownData(copy, 'projectSha256');
	if (typeof expectedFingerprint !== 'string' || !SHA256_PATTERN.test(expectedFingerprint)) {
		throw new TypeError('The Framescaper V19 cross-product copy requires a lowercase project SHA-256.');
	}
	const project = cloneFramescaperProjectV19(profile, ownData(copy, 'project'));
	assertCompositionOccurrence(project);
	if (projectFingerprint(project) !== expectedFingerprint) {
		throw new Error('The Framescaper V19 cross-product copy project changed during preservation.');
	}
	return project;
}

function copyRequest(value: unknown): FramescaperVideoCompositionCrossProductCopyRequestV19 {
	const request = closedRecord(value, REQUEST_FIELDS, 'Framescaper V19 cross-product copy request');
	const targetProduct = ownData(request, 'targetProduct');
	const mode = ownData(request, 'mode');
	if (targetProduct !== 'soundscaper') {
		throw new RangeError('A V19 video-composition cross-product preservation copy must target Soundscaper.');
	}
	if (mode !== 'copy-only-preservation') {
		throw new RangeError('A V19 video-composition cross-product transfer must be copy-only preservation.');
	}
	return Object.freeze({ targetProduct, mode });
}

function assertCompositionOccurrence(project: FramescaperProjectV19): void {
	const timelineVideo = project.clips.some((clip) => clip.kind === 'video');
	const binVideo = project.projectBin.clips.some((clip) => clip.kind === 'video');
	if (!timelineVideo && !binVideo) {
		throw new Error('A V19 video-composition cross-product copy requires at least one video clip.');
	}
}

function projectFingerprint(project: FramescaperProjectV19): string {
	return digestScapeBytes(TEXT_ENCODER.encode(serializeScapeProjectDocument(project)));
}

function closedRecord<Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	name: string,
): Record<Fields[number], unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => (
		typeof key !== 'string' || !fields.includes(key)
	))) {
		throw new TypeError(`${name} is not exact.`);
	}
	for (const field of fields) ownData(value, field);
	return value as Record<Fields[number], unknown>;
}

function ownData(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}
