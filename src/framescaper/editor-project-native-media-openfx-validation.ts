/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertOfxEffectStateV26, type OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';

export const FRAMESCAPER_PROJECT_NATIVE_MEDIA_MAXIMUM_OPENFX_EFFECTS = 100_000;

export function validateFramescaperOpenFxOwnershipNativeMedia(project: Record<string, unknown>): void {
	const effects = array(project.ofxEffects, 'ofxEffects');
	if (effects.length > FRAMESCAPER_PROJECT_NATIVE_MEDIA_MAXIMUM_OPENFX_EFFECTS) {
		throw new RangeError('A Framescaper nativeMedia project exceeds its OpenFX effect ceiling.');
	}
	const objects = projectObjects(project);
	const instanceIds = new Set<string>();
	const sources = new Map(records(project.sources, 'sources').map((source) => [String(source.id), source]));
	for (const effect of effects) {
		assertOfxEffectStateV26(effect);
		const state = effect as OfxEffectStateV26;
		if (objects.has(state.instanceId) || instanceIds.has(state.instanceId)) {
			throw new RangeError(`OpenFX instance identity ${state.instanceId} collides with project identity.`);
		}
		instanceIds.add(state.instanceId);
		if (!objects.has(state.attachment.targetId)) {
			throw new ReferenceError(`OpenFX attachment target ${state.attachment.targetId} is missing.`);
		}
		for (const input of state.inputs) {
			if (!objects.has(input.sourceRef)) {
				throw new ReferenceError(`OpenFX input ${input.name} references missing identity ${input.sourceRef}.`);
			}
		}
		validateContext(state, objects);
		if (state.frozenFallback !== null) {
			const source = sources.get(state.frozenFallback.externalMediaSourceId);
			if (source?.kind !== 'video' || source.contentSha256 !== state.frozenFallback.renderedAssetSha256) {
				throw new RangeError('An OpenFX frozen fallback must bind an exact external video asset.');
			}
		}
	}
}

function validateContext(state: OfxEffectStateV26, objects: ReadonlyMap<string, Record<string, unknown>>): void {
	const target = objects.get(state.attachment.targetId)!;
	const externalGenerator = target.kind === 'generator' && recordOrNull(target.generator)?.kind === 'external-generator'
		&& recordOrNull(target.generator)?.bindingId === state.instanceId;
	if (state.context === 'generator' || state.context === 'general') {
		if (!externalGenerator) throw new RangeError(`OpenFX ${state.context} must own its external generator source.`);
		return;
	}
	if (state.context === 'transition') {
		if (typeof target.outgoingClipId !== 'string' || typeof target.incomingClipId !== 'string') {
			throw new RangeError('OpenFX Transition must attach to an explicit transition.');
		}
		return;
	}
	const visualClip = (target.kind === 'video' || target.kind === 'still' || target.kind === 'generator')
		&& typeof target.sourceId === 'string';
	if (state.context === 'retimer' && (target.kind !== 'video' || !visualClip)) {
		throw new RangeError('OpenFX Retimer must attach to an exact video clip retime map.');
	}
	if (state.context === 'paint') {
		const names = new Set(state.inputs.map(({ name }) => name));
		if (!visualClip || !names.has('Source') || !names.has('Mask')) {
			throw new RangeError('OpenFX Paint requires explicit Source and Mask inputs.');
		}
	}
	if (state.context === 'filter' && !visualClip && target.kind !== 'adjustment-layer') {
		throw new RangeError('OpenFX Filter must attach to a visual clip or adjustment layer.');
	}
}

function projectObjects(project: Record<string, unknown>): Map<string, Record<string, unknown>> {
	const values: Record<string, unknown>[] = [project];
	for (const key of [
		'sources', 'clips', 'tracks', 'sequences', 'subsequences', 'multicameraGroups',
		'videoAdjustmentLayers', 'videoVisualPresets', 'videoMaskMattes',
		'videoVisualPresentations', 'videoProcessorStacks', 'videoMotionAnalyses',
		'videoFinishingPresets', 'videoCaptionTracks',
	]) values.push(...records(project[key], key));
	values.push(...records(record(project.projectBin, 'projectBin').clips, 'projectBin.clips'));
	for (const track of records(project.tracks, 'tracks')) {
		if (Array.isArray(track.videoTransitions)) values.push(...records(track.videoTransitions, 'videoTransitions'));
	}
	for (const stack of records(project.videoProcessorStacks, 'videoProcessorStacks')) {
		values.push(...records(stack.processors, 'videoProcessorStacks.processors'));
	}
	return new Map(values.map((value) => [String(value.id), value]));
}

function array(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}
function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}
function recordOrNull(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function records(value: unknown, name: string): Record<string, unknown>[] {
	return array(value, name).map((item, index) => record(item, `${name}[${String(index)}]`));
}
