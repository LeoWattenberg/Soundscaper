/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * The clipboard Audacity's Cut/Copy Labeled Audio produce.
 *
 * EditClipboardByLabel in au3/src/menus/LabelMenus.cpp copies each labelled
 * region and pastes them back together right to left, shifting the accumulated
 * material by the distance between one region and the next. The result spans
 * the first region's start to the last region's end with the unlabelled
 * material between the regions left blank, which is what this rebuilds from
 * one descriptor per region.
 *
 * Only media rides along. Upstream copies exactly the playable tracks it
 * edits, so timeline annotations and take groups stay behind rather than being
 * stitched across the gaps.
 */

import { normalizeAudioEditorClipboardDescriptor } from './commands/clipboard-codec.ts';
import type { LabeledAudioRegion } from './labeled-audio-regions.ts';

type DataRecord = Record<string, unknown>;

export type LabeledAudioClipboardFactory = (
	project: unknown,
	options: Readonly<{
		readonly startFrame: number;
		readonly endFrame: number;
		readonly trackIds: readonly string[];
	}>,
) => unknown;

/** Build the Cut/Copy Labeled Audio clipboard, or null when no region spans audio. */
export function createLabeledAudioClipboardDescriptor(
	project: unknown,
	regions: readonly LabeledAudioRegion[],
	trackIds: readonly string[],
	createDescriptor: LabeledAudioClipboardFactory,
): unknown {
	const spans = regions.filter((region) => region.endFrame > region.startFrame);
	if (spans.length === 0 || trackIds.length === 0) return null;
	const originFrame = spans[0]!.startFrame;
	const durationFrames = spans.at(-1)!.endFrame - originFrame;
	const merged = new Map<string, DataRecord>();
	let template: DataRecord | null = null;
	for (const region of spans) {
		const descriptor = createDescriptor(project, {
			startFrame: region.startFrame,
			endFrame: region.endFrame,
			trackIds,
		}) as DataRecord;
		template ??= descriptor;
		const offset = region.startFrame - originFrame;
		for (const value of (descriptor.tracks as DataRecord[] | undefined) || []) {
			const sourceTrackId = String(value.sourceTrackId);
			const existing = merged.get(sourceTrackId);
			const clips = ((value.clips as DataRecord[] | undefined) || []).map((clip) => ({
				...clip,
				offsetFrame: Number(clip.offsetFrame) + offset,
			}));
			if (existing) existing.clips = [...(existing.clips as DataRecord[]), ...clips];
			else merged.set(sourceTrackId, { ...value, clips });
		}
	}
	if (!template || merged.size === 0) return null;
	const descriptor: DataRecord = { ...template, durationFrames, tracks: [...merged.values()] };
	if (Object.hasOwn(descriptor, 'annotations')) descriptor.annotations = [];
	if (Object.hasOwn(descriptor, 'takeGroups')) descriptor.takeGroups = [];
	return normalizeAudioEditorClipboardDescriptor(descriptor);
}

export interface LabeledAudioClipboardPortRuntime {
	readonly projectForEditClipboardConsumers?: (project: unknown) => unknown;
	readonly prepareEditClipboardDescriptor: (project: unknown, descriptor: unknown) => unknown;
}

export interface LabeledAudioClipboardPortOptions {
	getProject(): unknown;
	getCommandProject(): unknown;
	readonly projectRuntime: LabeledAudioClipboardPortRuntime;
	readonly createDescriptor: LabeledAudioClipboardFactory;
}

export interface LabeledAudioClipboardPort {
	create(regions: readonly LabeledAudioRegion[], trackIds: readonly string[]): unknown;
}

/**
 * Bind the merge to the product's clipboard projection: the regions are read
 * from whichever projection the edit clipboard consumes, and the finished
 * descriptor goes through the same session carrier an ordinary copy uses.
 */
export function createLabeledAudioClipboardPort(
	options: LabeledAudioClipboardPortOptions,
): Readonly<LabeledAudioClipboardPort> {
	return Object.freeze({
		create(regions: readonly LabeledAudioRegion[], trackIds: readonly string[]) {
			const project = options.getProject();
			const source = options.projectRuntime.projectForEditClipboardConsumers
				? options.projectRuntime.projectForEditClipboardConsumers(project)
				: options.getCommandProject();
			const descriptor = createLabeledAudioClipboardDescriptor(
				source,
				regions,
				trackIds,
				options.createDescriptor,
			);
			return descriptor === null
				? null
				: options.projectRuntime.prepareEditClipboardDescriptor(project, descriptor);
		},
	});
}
