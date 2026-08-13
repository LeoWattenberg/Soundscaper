/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	VIDEO_PROXY_MAXIMUM_BODY_BYTES,
} from '../common/editor/video-proxy-attachment-v18.ts';
import {
	closedDataRecord,
	nonEmptyString,
	positiveSafeInteger,
} from '../common/editor/video-proxy-relationship-values.ts';
import type { BoundVideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import {
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_MAXIMUM_BYTES,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../common/editor/video-timing-asset.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface BodyIdentityFoundationV18 {
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly generationToken: string;
}

export type FramescaperVideoProxyBodyIdentityV18 = Readonly<
	BodyIdentityFoundationV18 & (
		| {
			readonly role: 'proxy';
			readonly kind: 'video-proxy';
			readonly encoding: 'video-proxy-v1';
		}
		| {
			readonly role: 'timing';
			readonly kind: 'video-timing';
			readonly encoding: typeof VIDEO_TIMING_ASSET_ENCODING;
			readonly frameCount: number;
			readonly timescale: number;
			readonly finalFrameDurationTicks: string;
		}
	)
>;

export type FramescaperVideoProxyExpectedBodyV18 = Readonly<
	Omit<BodyIdentityFoundationV18, 'generationToken'> & (
		| {
			readonly role: 'proxy';
			readonly kind: 'video-proxy';
			readonly encoding: 'video-proxy-v1';
		}
		| {
			readonly role: 'timing';
			readonly kind: 'video-timing';
			readonly encoding: typeof VIDEO_TIMING_ASSET_ENCODING;
			readonly frameCount: number;
			readonly timescale: number;
			readonly finalFrameDurationTicks: string;
		}
	)
>;

export interface FramescaperVideoProxyBodyRequestV18 {
	readonly projectId: string;
	readonly sourceId: string;
	readonly role: 'proxy' | 'timing';
	readonly expected: FramescaperVideoProxyExpectedBodyV18;
	readonly signal?: AbortSignal;
}

export interface FramescaperVideoProxyBodyLeaseV18 {
	readonly identity: FramescaperVideoProxyBodyIdentityV18;
	readonly body: Blob;
	assertCurrent(): void;
	release(): Awaitable<void>;
}

export interface FramescaperVideoProxyOriginalIdentityV18 {
	readonly authority: 'owned' | 'linked';
	readonly projectId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly generationToken: string;
}

export interface FramescaperVideoProxyOriginalLeaseV18 {
	readonly identity: FramescaperVideoProxyOriginalIdentityV18;
	readonly timing: BoundVideoSourceTimingView;
	assertCurrent(): void;
	release(): Awaitable<void>;
}

export interface FramescaperVideoProxyOriginalRequestV18 {
	readonly projectId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly contentSha256: string;
	readonly signal?: AbortSignal;
}

export interface FramescaperVideoProxyReattestationAuthorityDependenciesV18 {
	readonly profile: EditorProjectRuntimeProfile;
	readonly getProject: () => unknown;
	readonly captureTask: () => unknown;
	readonly assertTaskCurrent: (token: unknown) => void;
	readonly acquireBody: (
		request: Readonly<FramescaperVideoProxyBodyRequestV18>,
	) => Awaitable<FramescaperVideoProxyBodyLeaseV18>;
	readonly observeOriginal: (
		request: Readonly<FramescaperVideoProxyOriginalRequestV18>,
	) => Awaitable<FramescaperVideoProxyOriginalLeaseV18>;
}

export interface FramescaperVideoProxyReattestationAuthorityV18 {
	readonly kind: 'framescaper-video-proxy-reattestation-authority';
	readonly version: 1;
}

export interface FramescaperVideoProxyTrustV18 {
	readonly kind: 'framescaper-video-proxy-trust';
	readonly version: 1;
}

export interface FramescaperVideoProxyChoiceV18 {
	readonly kind: 'framescaper-video-proxy-choice';
	readonly version: 1;
	readonly rule: 'existing-attachment-reattested-v1';
	readonly projectId: string;
	readonly sourceId: string;
	readonly proxy: FramescaperVideoProxyBodyIdentityV18;
	readonly timing: FramescaperVideoProxyBodyIdentityV18;
	readonly original: Readonly<FramescaperVideoProxyOriginalIdentityV18>;
	readonly audioPolicy: 'ignore-proxy-container-audio-v1';
}

export interface FramescaperVideoProxyReattestationResultV18 {
	readonly trust: FramescaperVideoProxyTrustV18;
	readonly choice: Readonly<FramescaperVideoProxyChoiceV18>;
}

export interface FramescaperVideoProxyReattestationRequestV18 {
	readonly sourceId: string;
	readonly signal?: AbortSignal;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const VIDEO_MIME = /^video\/[a-z0-9][a-z0-9!#$&^_.+\-]*$/u;
const PROXY_FIELDS = [
	'role', 'kind', 'encoding', 'storageKey', 'mimeType', 'byteLength', 'sha256',
	'generationToken',
] as const;
const TIMING_FIELDS = [
	...PROXY_FIELDS, 'frameCount', 'timescale', 'finalFrameDurationTicks',
] as const;

export function normalizeFramescaperVideoProxyBodyIdentityV18(
	value: unknown,
): FramescaperVideoProxyBodyIdentityV18 {
	const preliminary = closedDataRecord(value, TIMING_FIELDS, 'Framescaper V18 proxy body identity', PROXY_FIELDS);
	const role = preliminary.role;
	const raw = closedDataRecord(
		value,
		role === 'proxy' ? PROXY_FIELDS : TIMING_FIELDS,
		'Framescaper V18 proxy body identity',
	);
	const foundation = {
		storageKey: nonEmptyString(raw.storageKey, 'proxy body storageKey'),
		mimeType: nonEmptyString(raw.mimeType, 'proxy body mimeType'),
		byteLength: positiveSafeInteger(raw.byteLength, 'proxy body byteLength'),
		sha256: digest(raw.sha256, 'proxy body'),
		generationToken: nonEmptyString(raw.generationToken, 'proxy body generationToken'),
	};
	if (role === 'proxy') {
		if (raw.kind !== 'video-proxy' || raw.encoding !== 'video-proxy-v1'
			|| foundation.byteLength > VIDEO_PROXY_MAXIMUM_BODY_BYTES
			|| foundation.mimeType.length > 128 || !VIDEO_MIME.test(foundation.mimeType)) {
			throw new TypeError('The Framescaper V18 proxy body identity is invalid.');
		}
		return Object.freeze({ role, kind: 'video-proxy', encoding: 'video-proxy-v1', ...foundation });
	}
	if (role !== 'timing' || raw.kind !== 'video-timing'
		|| raw.encoding !== VIDEO_TIMING_ASSET_ENCODING
		|| foundation.mimeType !== VIDEO_TIMING_ASSET_MIME_TYPE
		|| foundation.byteLength > VIDEO_TIMING_ASSET_MAXIMUM_BYTES) {
		throw new TypeError('The Framescaper V18 proxy timing body identity is invalid.');
	}
	return Object.freeze({
		role, kind: 'video-timing', encoding: VIDEO_TIMING_ASSET_ENCODING, ...foundation,
		frameCount: positiveSafeInteger(raw.frameCount, 'proxy timing body frameCount'),
		timescale: positiveSafeInteger(raw.timescale, 'proxy timing body timescale'),
		finalFrameDurationTicks: positiveDecimal(raw.finalFrameDurationTicks),
	});
}

export function normalizeFramescaperVideoProxyOriginalIdentityV18(
	value: unknown,
): Readonly<FramescaperVideoProxyOriginalIdentityV18> {
	const raw = closedDataRecord(value, [
		'authority', 'projectId', 'sourceId', 'storageKey', 'mimeType', 'byteLength',
		'sha256', 'generationToken',
	], 'Framescaper V18 proxy original identity');
	if (raw.authority !== 'owned' && raw.authority !== 'linked') {
		throw new RangeError('The Framescaper V18 proxy original authority is invalid.');
	}
	const mimeType = videoMimeType(raw.mimeType);
	return Object.freeze({
		authority: raw.authority,
		projectId: nonEmptyString(raw.projectId, 'proxy original projectId'),
		sourceId: nonEmptyString(raw.sourceId, 'proxy original sourceId'),
		storageKey: nonEmptyString(raw.storageKey, 'proxy original storageKey'),
		mimeType,
		byteLength: positiveSafeInteger(raw.byteLength, 'proxy original byteLength'),
		sha256: digest(raw.sha256, 'proxy original'),
		generationToken: nonEmptyString(raw.generationToken, 'proxy original generationToken'),
	});
}

export function sameFramescaperVideoProxyBodyIdentityV18(left: unknown, right: unknown): boolean {
	try {
		const first = normalizeFramescaperVideoProxyBodyIdentityV18(left);
		const second = normalizeFramescaperVideoProxyBodyIdentityV18(right);
		return JSON.stringify(first) === JSON.stringify(second);
	} catch { return false; }
}

export function sameFramescaperVideoProxyOriginalIdentityV18(left: unknown, right: unknown): boolean {
	try {
		const first = normalizeFramescaperVideoProxyOriginalIdentityV18(left);
		const second = normalizeFramescaperVideoProxyOriginalIdentityV18(right);
		return Object.keys(first).every((key) => (
			first[key as keyof FramescaperVideoProxyOriginalIdentityV18]
			=== second[key as keyof FramescaperVideoProxyOriginalIdentityV18]
		));
	} catch { return false; }
}

function digest(value: unknown, name: string): string {
	const result = nonEmptyString(value, `${name} SHA-256`);
	if (!SHA256.test(result)) throw new TypeError(`${name} requires a lowercase SHA-256 digest.`);
	return result;
}

function videoMimeType(value: unknown): string {
	const result = nonEmptyString(value, 'video source MIME type');
	if (result.length > 128 || !VIDEO_MIME.test(result)) {
		throw new TypeError('The video source MIME type is invalid.');
	}
	return result;
}

function positiveDecimal(value: unknown): string {
	if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) {
		throw new RangeError('The proxy timing final-frame duration must be a positive decimal integer.');
	}
	return value;
}
