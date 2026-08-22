/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertOfxEffectStateV26,
	type OfxEffectStateV26,
} from '../common/editor/native-ofx-state-v26.ts';
import {
	framescaperProjectFeatureRequirementsForV25FoundationV26,
	validateFramescaperProjectFeatureRequirementsV26,
} from './editor-project-feature-requirements-v26.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v25.ts';
import { assertFramescaperProjectV26CandidateProfile } from './editor-project-runtime-profile-v26.ts';
import { validateFramescaperProjectV25, type FramescaperProjectV25 } from './editor-project-v25.ts';

export const FRAMESCAPER_PROJECT_V26_SCHEMA_VERSION = 26 as const;
export const FRAMESCAPER_PROJECT_V26_MAXIMUM_OPENFX_EFFECTS = 100_000;

export interface FramescaperProjectV26 extends Omit<FramescaperProjectV25, 'schemaVersion'> {
	readonly id: string;
	readonly schemaVersion: 26;
	readonly ofxEffects: readonly OfxEffectStateV26[];
}

export function validateFramescaperProjectV26(
	profile: unknown,
	project: unknown,
): project is FramescaperProjectV26 {
	assertFramescaperProjectV26CandidateProfile(profile);
	const candidate = record(project, 'Framescaper V26 project');
	if (data(candidate, 'schemaVersion') !== 26) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(data(candidate, 'schemaVersion'))}.`);
	}
	validateFramescaperProjectV25(
		FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV25FoundationV26(profile, candidate),
	);
	validateOpenFxOwnership(candidate);
	validateFramescaperProjectFeatureRequirementsV26(profile, candidate);
	return true;
}

export function framescaperProjectV25FoundationV26(
	profile: unknown,
	project: unknown,
): FramescaperProjectV25 {
	assertFramescaperProjectV26CandidateProfile(profile);
	const candidate = record(project, 'Framescaper V26 project');
	const foundation = structuredClone(candidate) as Record<string, unknown>;
	foundation.schemaVersion = 25;
	delete foundation.ofxEffects;
	foundation.featureRequirements = framescaperProjectFeatureRequirementsForV25FoundationV26(
		profile, candidate,
	);
	return foundation as unknown as FramescaperProjectV25;
}

function validateOpenFxOwnership(project: Record<string, unknown>): void {
	const effects = array(project, 'ofxEffects');
	if (effects.length > FRAMESCAPER_PROJECT_V26_MAXIMUM_OPENFX_EFFECTS) {
		throw new RangeError('A Framescaper V26 project exceeds its OpenFX effect ceiling.');
	}
	const projectObjects = projectIdentities(project);
	const instanceIds = new Set<string>();
	const sources = new Map(records(data(project, 'sources'), 'sources').map((source) => [String(source.id), source]));
	for (const effect of effects) {
		assertOfxEffectStateV26(effect);
		const state = effect as OfxEffectStateV26;
		if (projectObjects.has(state.instanceId) || instanceIds.has(state.instanceId)) {
			throw new RangeError(`OpenFX instance identity ${state.instanceId} collides with project identity.`);
		}
		instanceIds.add(state.instanceId);
		if (!projectObjects.has(state.attachment.targetId)) {
			throw new ReferenceError(`OpenFX attachment target ${state.attachment.targetId} is missing.`);
		}
		for (const input of state.inputs) {
			if (!projectObjects.has(input.sourceRef)) {
				throw new ReferenceError(`OpenFX named input ${input.name} references missing project identity ${input.sourceRef}.`);
			}
		}
		validateContextAttachment(state, projectObjects);
		const fallback = state.frozenFallback;
		if (fallback !== null) {
			const source = sources.get(fallback.externalMediaSourceId);
			if (!source || source.kind !== 'video') {
				throw new ReferenceError('An OpenFX frozen fallback must remain an external video media source.');
			}
			if (source.contentSha256 !== fallback.renderedAssetSha256) {
				throw new RangeError('An OpenFX frozen fallback digest must match its external media asset.');
			}
		}
	}
}

function projectIdentities(project: Record<string, unknown>): Map<string, Record<string, unknown>> {
	const values: Record<string, unknown>[] = [project];
	for (const key of [
		'sources', 'clips', 'tracks', 'sequences', 'subsequences', 'multicameraGroups',
		'videoAdjustmentLayers', 'videoVisualPresets', 'videoMaskMattes',
	]) {
		if (Array.isArray(project[key])) values.push(...records(project[key], key));
	}
	const projectBin = record(data(project, 'projectBin'), 'projectBin');
	values.push(...records(data(projectBin, 'clips'), 'projectBin.clips'));
	for (const track of records(data(project, 'tracks'), 'tracks')) {
		if (Array.isArray(track.videoTransitions)) values.push(...records(track.videoTransitions, 'videoTransitions'));
	}
	return new Map(values.map((value) => [String(data(value, 'id')), value]));
}

function validateContextAttachment(
	state: OfxEffectStateV26,
	objects: ReadonlyMap<string, Record<string, unknown>>,
): void {
	const target = objects.get(state.attachment.targetId)!;
	const kind = target.kind;
	const generator = target.generator;
	const externalGenerator = kind === 'generator' && generator !== null
		&& typeof generator === 'object' && !Array.isArray(generator)
		&& (generator as Record<string, unknown>).kind === 'external-generator'
		&& (generator as Record<string, unknown>).bindingId === state.instanceId;
	if (state.context === 'generator' || state.context === 'general') {
		if (!externalGenerator) {
			throw new RangeError(`OpenFX ${state.context} must own its exact external-generator source.`);
		}
		return;
	}
	if (state.context === 'transition') {
		if (typeof target.outgoingClipId !== 'string' || typeof target.incomingClipId !== 'string') {
			throw new RangeError('OpenFX Transition must attach to an explicit V22 transition object.');
		}
		return;
	}
	const visualClip = (kind === 'video' || kind === 'still' || kind === 'generator')
		&& typeof target.sourceId === 'string';
	if (state.context === 'retimer') {
		if (kind !== 'video' || !visualClip) {
			throw new RangeError('OpenFX Retimer must attach to an exact video clip retime map.');
		}
		return;
	}
	if (state.context === 'paint') {
		const names = new Set(state.inputs.map(({ name }) => name));
		if (!visualClip || !names.has('Source') || !names.has('Mask')) {
			throw new RangeError('OpenFX Paint requires a visual clip plus explicit Source and Mask inputs.');
		}
		return;
	}
	if (state.context === 'filter' && !visualClip && kind !== 'adjustment-layer') {
		throw new RangeError('OpenFX Filter must attach to a visual clip or adjustment layer.');
	}
}

function data(value: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function array(value: Record<string, unknown>, key: string): unknown[] {
	const result = data(value, key);
	if (!Array.isArray(result)) throw new TypeError(`${key} must be an array.`);
	return result;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
