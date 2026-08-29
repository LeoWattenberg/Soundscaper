/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The closed family-v1 root inventory carried by a conversion ledger.
 * Owning-model tests pin these leaf lists to the actual product validators so
 * report admission stays dependency-light without loading either product tree.
 */
export const CROSS_PRODUCT_HANDOFF_ROOTS = Object.freeze({
	soundscaper: Object.freeze([
		'schemaFamily', 'schemaVersion', 'id', 'title', 'revision', 'createdAt', 'updatedAt',
		'sampleRate', 'masterChannels', 'tempo', 'snap', 'timeDisplay', 'metadata', 'selection',
		'loop', 'view', 'sources', 'clips', 'tracks', 'master', 'mixer', 'opaqueExtensions',
		'projectBin', 'featureRequirements', 'sequences', 'primarySequenceId', 'tempoMap',
		'signatureMap', 'timelineAnnotations', 'trackFolders', 'takeGroups', 'automationLanes',
		'masteringSequences', 'nativePluginStates', 'assistanceAssets',
	] as const),
	framescaper: Object.freeze([
		'schemaFamily', 'schemaVersion', 'id', 'title', 'revision', 'createdAt', 'updatedAt',
		'sampleRate', 'masterChannels', 'tempo', 'snap', 'timeDisplay', 'metadata', 'selection',
		'loop', 'view', 'sources', 'clips', 'tracks', 'master', 'mixer', 'opaqueExtensions',
		'projectBin', 'featureRequirements', 'sequences', 'primarySequenceId', 'tempoMap',
		'signatureMap', 'timelineAnnotations', 'trackFolders', 'takeGroups', 'subsequences',
		'multicameraGroups', 'videoAdjustmentLayers', 'videoVisualPresets', 'videoMaskMattes',
		'videoFreezeFallbacks', 'videoColorContexts', 'videoSourceColorInterpretations',
		'videoVisualPresentations', 'videoProcessorStacks', 'videoMotionAnalyses',
		'videoFinishingPresets', 'videoCaptionTracks', 'automationLanes', 'ofxEffects',
		'assistanceAssets',
	] as const),
});

export function crossProductHandoffRootNames(
	family: 'soundscaper' | 'framescaper',
): readonly string[] {
	return CROSS_PRODUCT_HANDOFF_ROOTS[family];
}
