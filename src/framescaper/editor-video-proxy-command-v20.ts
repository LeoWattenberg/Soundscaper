/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoProxyAttachmentV18,
	type VideoProxyAttachmentV18,
} from '../common/editor/video-proxy-attachment-v18.ts';

const FIELDS = Object.freeze(['type', 'sourceId', 'expectedAttachment']);

/** One stale-safe, history-owned removal of a selected editorial proxy. */
export interface FramescaperVideoProxyDetachCommandV20 {
	readonly type: 'framescaper/video-proxy-detach';
	readonly sourceId: string;
	readonly expectedAttachment: Readonly<VideoProxyAttachmentV18>;
}

export function isFramescaperVideoProxyDetachCommandV20(
	value: unknown,
): value is FramescaperVideoProxyDetachCommandV20 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
	return Boolean(descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& descriptor.value === 'framescaper/video-proxy-detach');
}

export function snapshotFramescaperVideoProxyDetachCommandV20(
	value: unknown,
): Readonly<FramescaperVideoProxyDetachCommandV20> {
	const record = closedRecord(value);
	if (record.type !== 'framescaper/video-proxy-detach') {
		throw new RangeError('The Framescaper V20 proxy command type is unsupported.');
	}
	if (typeof record.sourceId !== 'string' || !record.sourceId
		|| record.sourceId.length > 256) {
		throw new TypeError('The Framescaper V20 proxy detach source ID is invalid.');
	}
	return Object.freeze({
		type: 'framescaper/video-proxy-detach',
		sourceId: record.sourceId,
		expectedAttachment: normalizeVideoProxyAttachmentV18(record.expectedAttachment),
	});
}

/** Mutate only the already-cloned V20 source carrier; its owner finalizes the command. */
export function detachFramescaperVideoProxyDraftV20(
	draft: Record<string, unknown>,
	command: Readonly<FramescaperVideoProxyDetachCommandV20>,
): void {
	if (!Array.isArray(draft.sources)) {
		throw new TypeError('Framescaper V20 project.sources must be an array.');
	}
	const source = draft.sources.find((candidate) => (
		candidate && typeof candidate === 'object'
		&& (candidate as Readonly<Record<string, unknown>>).id === command.sourceId
	)) as Record<string, unknown> | undefined;
	if (!source) throw new ReferenceError(`Video source ${command.sourceId} does not exist.`);
	if (source.kind !== 'video') throw new TypeError(`Source ${command.sourceId} is not a video source.`);
	if (source.proxyAttachment === null
		|| JSON.stringify(source.proxyAttachment) !== JSON.stringify(command.expectedAttachment)) {
		throw new RangeError(`Video source ${command.sourceId} has a stale expected proxy attachment.`);
	}
	source.proxyAttachment = null;
}

function closedRecord(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('The Framescaper V20 proxy detach command must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== FIELDS.length
		|| keys.some((key) => typeof key !== 'string' || !FIELDS.includes(key))) {
		throw new TypeError('The Framescaper V20 proxy detach command has unsupported, missing, or extra fields.');
	}
	for (const field of FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`The Framescaper V20 proxy detach command.${field} must be an own data property.`);
		}
	}
	return value as Readonly<Record<string, unknown>>;
}
