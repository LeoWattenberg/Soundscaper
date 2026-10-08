/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../closed-domain-value.ts';
import { readExactSafeVisualText } from '../safe-visual-text.ts';
import { catalogOriginalId, catalogOriginalReferences, type CatalogOriginalReferenceV1 } from './media-catalog-original-schema.ts';

/** Display fields come from the retained document, never the newly selected file. */
export interface CatalogOriginalRepairBindingV1 extends CatalogOriginalReferenceV1 {
	readonly catalogId: string;
	readonly importId: string | null;
	readonly name: string;
	readonly mimeType: string;
}

export interface CatalogOriginalRepairReceiptV1 {
	readonly assetId: string;
	readonly sha256: string;
	readonly size: number;
}

export interface CatalogOriginalRepairOptionsV1 { readonly signal?: AbortSignal }

export function normalizeCatalogOriginalRepairBindingV1(value: unknown): Readonly<CatalogOriginalRepairBindingV1> {
	const input = readClosedDomainRecord(value, 'catalog original repair binding', [
		'catalogId', 'importId', 'photoId', 'assetId', 'sourceId', 'sha256', 'size', 'name', 'mimeType',
	]);
	const field = (key: string) => readClosedDomainField(input, key, 'catalog original repair binding');
	const [reference] = catalogOriginalReferences([{ photoId: field('photoId'), assetId: field('assetId'),
		sourceId: field('sourceId'), sha256: field('sha256'), size: field('size') }]);
	if (!reference) throw new TypeError('A retained original reference is required.');
	const mimeType = field('mimeType');
	if (typeof mimeType !== 'string' || mimeType.length > 255
		|| !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mimeType)) {
		throw new TypeError('A bounded canonical original MIME type is required.');
	}
	return Object.freeze({ ...reference, catalogId: catalogOriginalId(field('catalogId')),
		importId: field('importId') === null ? null : catalogOriginalId(field('importId')),
		name: readExactSafeVisualText(field('name'), 'original filename', 512, false), mimeType });
}

export function readCatalogOriginalRepairSignalV1(options: unknown): AbortSignal | undefined {
	const input = readClosedDomainRecord(options, 'catalog original repair options', ['signal'], []);
	const signal = Object.hasOwn(input, 'signal') ? readClosedDomainField(input, 'signal', 'catalog original repair options') : undefined;
	if (signal === undefined) return undefined;
	if (!(signal instanceof AbortSignal) || Object.getPrototypeOf(signal) !== AbortSignal.prototype
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) {
		throw new TypeError('Original repair requires a native cancellation signal.');
	}
	Reflect.apply(AbortSignal.prototype.throwIfAborted, signal, []);
	return signal;
}
