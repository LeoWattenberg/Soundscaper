/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { commandFixture, type CommandFixture } from './round3-command-fixtures.ts';
import type * as Range from '../../src/common/editor/commands/range-runtime.js';
import type * as Clipboard from '../../src/common/editor/commands/clipboard-runtime.js';
import type * as Link from '../../src/common/editor/commands/clip-link-runtime.js';
import type * as Bin from '../../src/common/editor/commands/project-source-bin-runtime.js';

interface Modules {
	range: typeof Range; clipboard: typeof Clipboard; link: typeof Link; bin: typeof Bin;
	prepareProject?: (project: object) => void;
}
export interface ParityCase { name: string; hash: string }

/** Frozen-base hash binds the complete draft, result and precise refusal after each command. */
export function round3CommandParity(modules: Modules): ParityCase[] {
	const results: ParityCase[] = [];
	const record = (name: string, project: CommandFixture, operation: () => unknown): void => {
		let result: unknown = null;
		let error: unknown = null;
		try { result = operation() ?? null; } catch (failure) {
			if (!(failure instanceof Error)) throw failure;
			error = { name: failure.name, message: failure.message };
		}
		results.push({ name, hash: createHash('sha256').update(JSON.stringify({ project, result, error })).digest('hex') });
	};
	const variants = ['plain', 'duplicate-clip', 'duplicate-track', 'duplicate-owner', 'missing', 'unowned', 'unsorted', 'av-chain'] as const;
	const fixture = (variant: typeof variants[number]): CommandFixture => {
		const project = commandFixture(8, 3);
		modules.prepareProject?.(project);
		if (variant === 'duplicate-clip') project.clips[5]!.id = 'clip-0';
		if (variant === 'duplicate-track') project.tracks[2]!.id = 'track-0';
		if (variant === 'duplicate-owner') project.tracks[1]!.clipIds.push('clip-0');
		if (variant === 'missing') project.tracks[0]!.clipIds.push('missing');
		if (variant === 'unowned') project.tracks[0]!.clipIds = project.tracks[0]!.clipIds.filter(id => id !== 'clip-0');
		if (variant === 'unsorted') project.tracks[0]!.clipIds.reverse();
		if (variant === 'av-chain') for (let index = 0; index < 6; index += 2) {
			project.clips[index]!.avLinkId = `pair-${String(index)}`;
			project.clips[index + 1]!.avLinkId = `pair-${String(index)}`;
		}
		return project;
	};
	for (const variant of variants) {
		for (const seeds of [['clip-0'], ['clip-7', 'clip-0'], ['missing'], []]) {
			const project = fixture(variant);
			record(`av/${variant}/${seeds.join('+')}`, project, () => modules.range.collectAvLinkedClipIds(project, seeds));
		}
		for (const tracks of [['track-0'], ['track-2', 'track-0'], ['missing'], []]) {
			const project = fixture(variant);
			record(`linked/${variant}/${tracks.join('+')}`, project, () => modules.range.collectLinkedTrackRippleTargets(project, tracks));
		}
		for (const [startFrame, endFrame] of [[0, 20], [5, 15], [50, 250], [1200, 1300]]) {
			for (const mode of ['none', 'clip', 'track']) {
				const project = fixture(variant);
				const splitIds = Object.fromEntries(project.clips.map(clip => [clip.id, `split-${clip.id}`]));
				record(`process/${variant}/${String(startFrame)}-${String(endFrame)}/${mode}`, project, () => modules.range.processTrackRange(
					project, project.tracks[0], { startFrame, endFrame, durationFrames: endFrame - startFrame }, mode, splitIds,
					Object.fromEntries(project.clips.filter(clip => clip.avLinkId).map(clip => [clip.avLinkId, `right-${clip.avLinkId!}`])),
				));
			}
			for (const operation of ['keep', 'replace']) {
				const project = fixture(variant);
				record(`${operation}/${variant}/${String(startFrame)}-${String(endFrame)}`, project, () => operation === 'keep'
					? modules.range.keepRange(project, { startFrame, endFrame, trackIds: ['track-0'] })
					: modules.range.replaceRange(project, { startFrame, endFrame, trackId: 'track-0', clipId: 'replacement',
						source: { id: 'replacement-source', storageKey: 'replacement-source', channelCount: 1, frameCount: 10 },
						splitClipIds: Object.fromEntries(project.clips.map(clip => [clip.id, `split-${clip.id}`])),
					}));
			}
		}
		for (const operation of ['group', 'ungroup', 'join', 'can-join', 'bin-move']) {
			for (const ids of [['clip-0', 'clip-3'], ['clip-0', 'missing'], ['clip-0', 'clip-0'], ['clip-0']]) {
				const project = fixture(variant);
				project.clips[3]!.timelineStartFrame = 20;
				project.clips[3]!.sourceStartFrame = 20;
				record(`${operation}/${variant}/${ids.join('+')}`, project, () => {
					if (operation === 'group') return modules.link.groupClips(project, ids, 'group');
					if (operation === 'ungroup') return modules.link.ungroupClips(project, ids);
					if (operation === 'join') return modules.link.joinClips(project, ids);
					if (operation === 'can-join') return modules.link.canJoinClips(project, ids);
					return modules.bin.createProjectSourceBinRuntimeHandlers(() => undefined)['project-bin/move-from-timeline'](project, { clipIds: ids });
				});
			}
		}
		{
			const project = fixture(variant);
			record(`descriptor/${variant}`, project, () => modules.clipboard.createClipboardDescriptor(project, { startFrame: 0, endFrame: 250 }));
		}
	}
	for (const mode of ['reject', 'overlap', 'insert-track', 'insert-all']) {
		for (const atFrame of [0, 20, 250, 1000]) {
			for (const variant of variants) {
				const project = fixture(variant);
				const clean = fixture('plain');
				const clipboard = modules.clipboard.createClipboardDescriptor(clean, { startFrame: 0, endFrame: 250 });
				let id = 0;
				record(`paste/${mode}/${String(atFrame)}/${variant}`, project, () => {
					const command = modules.clipboard.preparePasteCommand(clipboard, { mode, atFrame, project }, () => `pasted-${String(id++)}`);
					return modules.clipboard.pasteClipboard(project, command);
				});
			}
		}
	}
	return results;
}
