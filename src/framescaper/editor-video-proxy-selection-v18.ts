/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	closedDataRecord,
} from '../common/editor/video-proxy-relationship-values.ts';
import type { BoundVideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import {
	normalizeFramescaperVideoProxyOriginalIdentityV18,
	sameFramescaperVideoProxyBodyIdentityV18,
	sameFramescaperVideoProxyOriginalIdentityV18,
	type FramescaperVideoProxyOriginalIdentityV18,
} from './editor-video-proxy-reattestation-contract-v18.ts';
import {
	framescaperVideoProxyReattestationMaterialV18,
} from './editor-video-proxy-reattestation-v18.ts';

export type FramescaperVideoProxyUsePurposeV18 = 'preview' | 'export' | 'delivery';

export interface FramescaperVideoProxySelectionRequestV18 {
	readonly purpose: FramescaperVideoProxyUsePurposeV18;
	readonly trust: unknown | null;
	readonly choice: unknown | null;
	readonly currentOriginal: unknown | null;
	readonly currentProxy: unknown | null;
	readonly currentTiming: unknown | null;
}

export type FramescaperVideoProxySelectionV18 = Readonly<
	| {
		readonly kind: 'proxy';
		readonly sourceId: string;
		readonly storageKey: string;
		readonly mimeType: string;
		readonly timing: BoundVideoSourceTimingView;
		readonly audioPolicy: 'ignore-proxy-container-audio-v1';
	}
	| {
		readonly kind: 'original';
		readonly sourceId: string;
		readonly storageKey: string;
		readonly mimeType: string;
	}
	| {
		readonly kind: 'unavailable';
		readonly sourceId: string;
	}
>;

/**
 * Select pictures without I/O. A proxy is preview-only and requires one live,
 * process-local attestation plus exact current original/proxy/timing generations.
 */
export function selectFramescaperVideoProxyV18(
	requestValue: FramescaperVideoProxySelectionRequestV18 | unknown,
): FramescaperVideoProxySelectionV18 {
	const request = captureRequest(requestValue);
	const original = maybeOriginal(request.currentOriginal);
	const material = framescaperVideoProxyReattestationMaterialV18(
		request.trust,
		request.choice,
	);
	const sourceId = material?.choice.sourceId ?? original?.sourceId ?? 'unavailable-video-source';

	if (request.purpose === 'preview' && material && original
		&& sameFramescaperVideoProxyOriginalIdentityV18(original, material.choice.original)
		&& sameFramescaperVideoProxyBodyIdentityV18(request.currentProxy, material.choice.proxy)
		&& sameFramescaperVideoProxyBodyIdentityV18(request.currentTiming, material.choice.timing)) {
		return Object.freeze({
			kind: 'proxy',
			sourceId: material.choice.sourceId,
			storageKey: material.choice.proxy.storageKey,
			mimeType: material.choice.proxy.mimeType,
			timing: material.proxyTiming,
			audioPolicy: material.choice.audioPolicy,
		});
	}
	if (original) return originalSelection(original);
	return Object.freeze({ kind: 'unavailable', sourceId });
}

function captureRequest(value: unknown): Readonly<FramescaperVideoProxySelectionRequestV18> {
	const raw = closedDataRecord(value, [
		'purpose', 'trust', 'choice', 'currentOriginal', 'currentProxy', 'currentTiming',
	], 'Framescaper V18 proxy selection request');
	if (raw.purpose !== 'preview' && raw.purpose !== 'export' && raw.purpose !== 'delivery') {
		throw new RangeError('The Framescaper V18 proxy use purpose is unsupported.');
	}
	return Object.freeze({
		purpose: raw.purpose,
		trust: raw.trust,
		choice: raw.choice,
		currentOriginal: raw.currentOriginal,
		currentProxy: raw.currentProxy,
		currentTiming: raw.currentTiming,
	});
}

function maybeOriginal(value: unknown): Readonly<FramescaperVideoProxyOriginalIdentityV18> | null {
	if (value === null) return null;
	try { return normalizeFramescaperVideoProxyOriginalIdentityV18(value); }
	catch { return null; }
}

function originalSelection(
	identity: Readonly<FramescaperVideoProxyOriginalIdentityV18>,
): FramescaperVideoProxySelectionV18 {
	return Object.freeze({
		kind: 'original',
		sourceId: identity.sourceId,
		storageKey: identity.storageKey,
		mimeType: identity.mimeType,
	});
}
