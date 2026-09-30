/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperNativeServicesBridge } from '../common/editor/ui/framescaper-native-services-bridge.ts';

export type FramescaperNativeImageSequenceActionBridgeNativeMedia = Required<Pick<
	FramescaperNativeServicesBridge,
	'capabilities' | 'selectImageSequence' | 'readImageSequenceFile' | 'releaseImageSequence'
	| 'imageSequenceImport' | 'writeImageSequenceImportChunk' | 'readImageSequenceImportBody'
>>;

export type FramescaperNativeOpenFxActionBridgeNativeMedia = Required<Pick<
	FramescaperNativeServicesBridge,
	'capabilities' | 'listOpenFxPlugins'
>>;

const IMAGE_SEQUENCE_METHODS = Object.freeze([
	'capabilities', 'selectImageSequence', 'readImageSequenceFile', 'releaseImageSequence',
	'imageSequenceImport', 'writeImageSequenceImportChunk', 'readImageSequenceImportBody',
] as const);
const OPEN_FX_METHODS = Object.freeze(['capabilities', 'listOpenFxPlugins'] as const);

export function framescaperNativeImageSequenceActionBridgeAvailableNativeMedia(
	value: unknown,
): value is FramescaperNativeImageSequenceActionBridgeNativeMedia {
	return bridgeHasMethods(value, IMAGE_SEQUENCE_METHODS);
}

export function framescaperNativeOpenFxActionBridgeAvailableNativeMedia(
	value: unknown,
): value is FramescaperNativeOpenFxActionBridgeNativeMedia {
	return bridgeHasMethods(value, OPEN_FX_METHODS);
}

function bridgeHasMethods(value: unknown, methods: readonly string[]): boolean {
	if (!value || typeof value !== 'object') return false;
	try {
		if (Array.isArray(value)) return false;
		return methods.every((method) => {
			const descriptor = Object.getOwnPropertyDescriptor(value, method);
			return Boolean(descriptor && Object.hasOwn(descriptor, 'value')
				&& typeof descriptor.value === 'function');
		});
	} catch {
		return false;
	}
}
