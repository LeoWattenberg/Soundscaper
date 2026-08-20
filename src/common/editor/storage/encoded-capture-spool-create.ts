/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeCaptureSpoolCreationFence,
	type CaptureSpoolCreationFence,
} from './capture-spool-creation-fence.ts';

export interface CreateEncodedCaptureSpoolRequest {
	readonly projectId: string;
	readonly sessionId: string;
	readonly streamId: string;
	readonly spoolId: string;
	readonly spoolToken?: string;
	readonly creationFence?: CaptureSpoolCreationFence;
	/** The immutable media source which may later adopt this exact chunk token. */
	readonly sourceId: string;
	readonly mimeType: string;
}

export function normalizeEncodedCaptureSpoolCreateRequest(
	value: CreateEncodedCaptureSpoolRequest,
): CreateEncodedCaptureSpoolRequest {
	const creationFence = normalizeCaptureSpoolCreationFence(value?.creationFence);
	return Object.freeze({
		projectId: stableText(value?.projectId, 'encoded capture projectId', 256),
		sessionId: stableText(value?.sessionId, 'encoded capture sessionId', 256),
		streamId: stableText(value?.streamId, 'encoded capture streamId', 256),
		spoolId: stableText(value?.spoolId, 'encoded capture spoolId', 256),
		...(value?.spoolToken === undefined ? {} : {
			spoolToken: stableText(value.spoolToken, 'encoded capture spool token', 512),
		}),
		...(creationFence === undefined ? {} : { creationFence }),
		sourceId: stableText(value?.sourceId, 'encoded capture sourceId', 256),
		mimeType: stableText(value?.mimeType, 'encoded capture MIME type', 255),
	});
}

export function putEncodedCaptureSpoolWhenCurrent(
	values: Readonly<{
		putIfAbsentWhenCurrent?: (
			fenceKey: string, expectedFence: unknown, key: string, value: unknown,
		) => PromiseLike<boolean> | boolean;
	}>,
	fence: CaptureSpoolCreationFence,
	key: string,
	record: unknown,
): PromiseLike<boolean> | boolean {
	const create = values.putIfAbsentWhenCurrent;
	if (typeof create !== 'function') {
		throw new TypeError('Encoded capture spool creation requires an atomic creation fence.');
	}
	return create.call(values, fence.key, fence.expected, key, record);
}

function stableText(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > maximumLength
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}
