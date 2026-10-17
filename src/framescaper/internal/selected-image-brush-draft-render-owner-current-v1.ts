/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../common/editor/closed-domain-value.ts';
import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import { prepareImageDevelopMaskOverlaySelectionV1, type ImageDevelopMaskOverlaySelectionV1 } from '../../common/editor/imaging/image-develop-mask-overlay-v1.ts';
import { withBrushMaskResourceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import type { ImageDevelopFrameViewV1 } from '../../common/editor/imaging/image-develop-frame-core.ts';
import { prepareFramescaperImageBrushBodyCurrentV1, type FramescaperImageBrushBodyCurrentV1 } from './selected-image-brush-mask-port-current-v1.ts';
import { withFramescaperImageDevelopBrushDraftFrameCurrentV1, type FramescaperImageDevelopDraftFrameHostCurrentV1 } from './selected-image-develop-draft-render-owner-current-v1.ts';
import { assertFramescaperNativeImageSignalCurrentV1, checkFramescaperNativeImageSignalCurrentV1, retireFramescaperNativeImageCurrentV1 } from './timeline-image-native-pack-owner-current-v1.ts';

export interface FramescaperImageBrushDraftFrameCurrentV1 extends FramescaperImageBrushBodyCurrentV1 {
	readonly develop: Readonly<ImageDevelopStateThroughV4>;
	readonly maskOverlay?: Readonly<ImageDevelopMaskOverlaySelectionV1>;
}
const CAPTURES = new WeakSet<object>();
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, FILL = Uint8Array.prototype.fill;

/** The Session calls this synchronously while its full operation is installed;
 * subsequent same-tick caller edits cannot change accepted recipe/body/IDs. */
export function prepareFramescaperImageBrushDraftFrameCurrentV1(value: unknown): Readonly<FramescaperImageBrushDraftFrameCurrentV1> {
	const input = record(value, 'Frame brush draft', ['develop', 'reference', 'bytes', 'maskOverlay'], ['develop', 'reference', 'bytes']);
	const develop = normalizeImageDevelopStateThroughV4(field(input, 'develop', 'Frame brush draft'));
	const rawSelection = Object.hasOwn(input, 'maskOverlay') ? field(input, 'maskOverlay', 'Frame brush draft') : undefined;
	const maskOverlay = rawSelection === undefined ? undefined : prepareImageDevelopMaskOverlaySelectionV1(rawSelection);
	const body = prepareFramescaperImageBrushBodyCurrentV1(field(input, 'reference', 'Frame brush draft'), field(input, 'bytes', 'Frame brush draft'));
	const capture = Object.freeze({ develop, reference: body.reference, bytes: body.bytes, ...(maskOverlay ? { maskOverlay } : {}), retire: body.retire });
	CAPTURES.add(capture); return capture;
}

/** An uninstalled body is scoped to its exact selected recipe and never grants
 * native write/Original authority. Other saved/transient declarations still
 * authenticate through their existing real native resource readers. */
export async function withFramescaperImageBrushDraftFrameCurrentV1<Result>(host: FramescaperImageDevelopDraftFrameHostCurrentV1,
	request: Readonly<FramescaperImageBrushDraftFrameCurrentV1>, consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, signal?: AbortSignal): Promise<Result> {
	assertFramescaperNativeImageSignalCurrentV1(signal);
	if (!CAPTURES.has(request)) throw new TypeError('Frame brush rendering requires its privately captured draft.');
	let outcome: { value: Result } | { error: unknown };
	try {
		checkFramescaperNativeImageSignalCurrentV1(signal); host.assertCurrent();
		await withBrushMaskResourceV1({ reference: request.reference, bytes: request.bytes, signal }, () => undefined);
		const source = Object.freeze({ async withBytes<Value>(reference: Readonly<FramescaperImageBrushBodyCurrentV1['reference']>, borrower: (bytes: Uint8Array<ArrayBuffer>) => Value | Promise<Value>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Value> {
			if (reference.storageKey !== request.reference.storageKey) throw new TypeError('Temporary brush borrowing changed its exact admitted identity.');
			const bytes = request.bytes.slice(), backing = bytes.buffer; let result: { value: Value } | { error: unknown };
			try { result = { value: await withBrushMaskResourceV1({ reference, bytes, signal: options?.signal }, () => borrower(bytes)) }; } catch (error) { result = { error }; }
			await retireFramescaperNativeImageCurrentV1('error' in result ? result : undefined, [() => {
				if (Number(Reflect.apply(SIZE, backing, [])) !== reference.byteLength) throw new TypeError('Temporary Frame brush backing was detached before physical retirement.');
				Reflect.apply(FILL, new Uint8Array(backing), [0]);
			}]);
			if ('error' in result) throw result.error; return result.value;
		} });
		outcome = { value: await withFramescaperImageDevelopBrushDraftFrameCurrentV1(host, { develop: request.develop,
			...(request.maskOverlay ? { maskOverlay: request.maskOverlay } : {}) }, consume, signal, { reference: request.reference, source }) };
	} catch (error) { outcome = { error }; }
	await retireFramescaperNativeImageCurrentV1('error' in outcome ? outcome : undefined, [request.retire]);
	if ('error' in outcome) throw outcome.error; return outcome.value;
}
