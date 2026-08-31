/* SPDX-License-Identifier: AGPL-3.0-only */

import { isDeepStrictEqual } from 'node:util';

export const MILESTONE_5_PRODUCTS = Object.freeze(['soundscaper', 'framescaper']);
export const MILESTONE_5_TARGETS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
export const SOUNDSCAPER_MILESTONE_5_SOURCE_IDS = Object.freeze([
	'electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'asio-sdk', 'lv2',
]);
export const SOUNDSCAPER_MILESTONE_5_PAYLOAD_PRODUCTS = Object.freeze([
	'soundscaper-professional',
]);
export const SOUNDSCAPER_MILESTONE_5_WORKLOAD_IDS = Object.freeze([
	'm5-native-helper-and-audio',
]);
const ALL_SOURCE_IDS = Object.freeze([
	...SOUNDSCAPER_MILESTONE_5_SOURCE_IDS, 'x264', 'x265', 'libvpx', 'libopus',
]);
const ALL_PAYLOAD_PRODUCTS = Object.freeze([
	'soundscaper', 'soundscaper-professional', 'framescaper-media', 'framescaper-openfx',
]);
const ALL_WORKLOAD_IDS = Object.freeze([
	...SOUNDSCAPER_MILESTONE_5_WORKLOAD_IDS,
	'm5b-native-media-plan-parity-and-decode',
	'm5b-professional-media-tier',
	'm5b-persistent-services-recovery',
	'm5b-clean-external-display',
	'm5b-openfx-isolation-and-packaging',
]);
const ALL_PAYLOAD_INPUT_KEYS = Object.freeze([
	'nativeAddonPayload', 'soundscaperProfessionalPayload', 'mediaHostPayload', 'openFxHostPayload',
]);

export function milestone5ProductIds(value = MILESTONE_5_PRODUCTS) {
	if (!Array.isArray(value) || value.length < 1
		|| value.some((productId) => !MILESTONE_5_PRODUCTS.includes(productId))
		|| new Set(value).size !== value.length) {
		throw new Error('Milestone 5 product scope must select unique known products.');
	}
	const productIds = MILESTONE_5_PRODUCTS.filter((productId) => value.includes(productId));
	return Object.freeze(productIds);
}

export function milestone5PackageCells(productIdsValue = MILESTONE_5_PRODUCTS) {
	const productIds = milestone5ProductIds(productIdsValue);
	return Object.freeze(productIds.flatMap((productId) => MILESTONE_5_TARGETS.map(
		(targetId) => Object.freeze({ productId, targetId }),
	)));
}

/**
 * The retained dual-product campaign remains the default. Stable Soundscaper
 * gets one explicitly smaller engineering authority; a Framescaper-only
 * package rehearsal intentionally keeps using the retained full campaign.
 */
export function milestone5EngineeringScope(productIdsValue = MILESTONE_5_PRODUCTS) {
	const products = milestone5ProductIds(productIdsValue);
	const soundscaperStable = isDeepStrictEqual(products, ['soundscaper']);
	const sourceIds = soundscaperStable ? SOUNDSCAPER_MILESTONE_5_SOURCE_IDS : ALL_SOURCE_IDS;
	const payloadProducts = soundscaperStable
		? SOUNDSCAPER_MILESTONE_5_PAYLOAD_PRODUCTS : ALL_PAYLOAD_PRODUCTS;
	const workloadIds = soundscaperStable
		? SOUNDSCAPER_MILESTONE_5_WORKLOAD_IDS : ALL_WORKLOAD_IDS;
	const payloadInputKeys = soundscaperStable
		? ['soundscaperProfessionalPayload'] : ALL_PAYLOAD_INPUT_KEYS;
	return deepFreeze({
		kind: soundscaperStable ? 'soundscaper-professional' : 'retained-dual-product',
		products: [...products],
		sourceIds: [...sourceIds],
		includeDelegatedSources: !soundscaperStable,
		payloadProducts: [...payloadProducts],
		payloadInputKeys: [...payloadInputKeys],
		workloadIds: [...workloadIds],
		sourceCount: sourceIds.length,
		payloadCount: payloadProducts.length * MILESTONE_5_TARGETS.length,
	});
}

export function milestone5MatrixAssemblyOptions(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Milestone 5 matrix assembly options have an invalid shape.');
	}
	const expectedKeys = value.productIds === undefined
		? ['packageDirectory', 'repositoryRoot', 'sourceRevision']
		: ['packageDirectory', 'productIds', 'repositoryRoot', 'sourceRevision'];
	if (!isDeepStrictEqual(Object.keys(value).sort(), expectedKeys)) {
		throw new Error('Milestone 5 matrix assembly options have an invalid shape.');
	}
	return Object.freeze({
		...value,
		productIds: milestone5ProductIds(value.productIds),
	});
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}
