/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CurrentAudioEditorClipboardDescriptor, CurrentAudioEditorMutationCommandV2 } from '../common/editor/commands/clipboard-command-v2.ts';
import { normalizeAudioEditorClipboardDescriptorV7 } from '../common/editor/commands/clipboard-codec-v7.ts';
import { normalizeAudioEditorClipboardDescriptor } from '../common/editor/commands/clipboard-codec.ts';
import { createClipboardDescriptorV7 } from '../common/editor/commands/clipboard-runtime-v7.ts';
import { framescaperProjectForEditClipboardConsumers } from './editor-project-runtime.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { createFramescaperSessionClipboardV13, type FramescaperSessionClipboardV13 } from './editor-session-clipboard-v13.ts';
import { createFramescaperSessionClipboardV14, type FramescaperSessionClipboardV14 } from './editor-session-clipboard-v14.ts';
import { prepareFramescaperSessionClipboardPasteV13, type FramescaperSessionClipboardPasteV13 } from './editor-session-clipboard-v13-paste.ts';
import { prepareFramescaperSessionClipboardPasteV14, type FramescaperSessionClipboardPasteV14 } from './editor-session-clipboard-v14-paste.ts';
import { normalizeFramescaperImageSourceV1OrV2 } from '../common/editor/timeline-image-model-v2.ts';
import { readClosedDomainArray } from '../common/editor/closed-domain-value.ts';
import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';

export type CurrentFramescaperSessionClipboard = FramescaperSessionClipboardV13 | FramescaperSessionClipboardV14;
export type CurrentFramescaperSessionClipboardPaste = FramescaperSessionClipboardPasteV13 | FramescaperSessionClipboardPasteV14;

/** The selected Frame owner chooses complete descriptor7/Frame14 capture.
 * Explicit legacy descriptors keep the exact V13 admission path. */
export function createFramescaperCurrentClipboardRuntime(profile: unknown) {
	return Object.freeze({
		captureEditClipboardDescriptor(project: unknown, options: Parameters<typeof createClipboardDescriptorV7>[1]) {
			const descriptor = createClipboardDescriptorV7(framescaperProjectForEditClipboardConsumers(profile, project), options);
			assertSelectedImages(project, descriptor);
			return descriptor;
		},
		createClipboard,
		preparePaste,
		preparePasteCommand(project: unknown, clipboard: unknown, command: CurrentAudioEditorMutationCommandV2,
			createId: (prefix?: string) => string) {
			const prepared = preparePaste(project, clipboard, command, createId);
			const sourceProject = framescaperProjectTimelineImageFoundationShapeAssistance(project);
			const availableImages = new Set(sourceProject.sources.filter(source => source.kind === 'image').map(source => source.id));
			// Images whose durable bodies already belong to this destination retain
			// their rich leaves. New image IO still requires its explicit staging owner.
			return [...prepared.imageSourceIdMap.values()].every(id => availableImages.has(id))
				? prepared.command : prepared.foundationCommand;
		},
	});

	function createClipboard(project: unknown, descriptor: CurrentAudioEditorClipboardDescriptor): CurrentFramescaperSessionClipboard {
		const version = Object.getOwnPropertyDescriptor(descriptor, 'schemaVersion');
		if (version && Object.hasOwn(version, 'value') && version.value === 7) {
			const current = normalizeAudioEditorClipboardDescriptorV7(descriptor);
			assertSelectedImages(project, current);
			return createFramescaperSessionClipboardV14(profile, project, current);
		}
		const legacy = normalizeAudioEditorClipboardDescriptor(descriptor);
		assertSelectedImages(project, legacy);
		return createFramescaperSessionClipboardV13(FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
			framescaperProjectTimelineImageFoundationShapeAssistance(project), legacy);
	}
	function preparePaste(project: unknown, clipboard: unknown, command: CurrentAudioEditorMutationCommandV2,
		createId: (prefix?: string) => string): CurrentFramescaperSessionClipboardPaste {
		assertIncomingImages(clipboard);
		const version = clipboard && typeof clipboard === 'object' ? Object.getOwnPropertyDescriptor(clipboard, 'schemaVersion') : undefined;
		return version && Object.hasOwn(version, 'value') && version.value === 14
			? prepareFramescaperSessionClipboardPasteV14(profile, project, clipboard, command, createId)
			: prepareFramescaperSessionClipboardPasteV13(FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
				framescaperProjectTimelineImageFoundationShapeAssistance(project), clipboard, command as AudioEditorCommand, createId);
	}
	function assertSelectedImages(project: unknown, descriptor: CurrentAudioEditorClipboardDescriptor): void {
		const selected = framescaperProjectTimelineImageFoundationShapeAssistance(project);
		const ids = new Set(descriptor.tracks.flatMap(track => track.clips.map(clip => clip.sourceId)));
		if (selected.sources.some(source => source.kind === 'image' && source.schemaVersion === 2 && ids.has(source.id))) {
			throw new RangeError('Editable image clipboard transfer is not supported; export or save its complete project instead.');
		}
	}
}

/** No V1 rich fragment may silently discard a V2 recipe. Admission is scalar
 * only and happens before any controller stages clipboard bodies. */
function assertIncomingImages(value: unknown): void {
	if (!value || typeof value !== 'object') return;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'sources');
	if (!descriptor) return;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Clipboard sources must be own data.');
	for (const row of readClosedDomainArray(descriptor.value, 'Clipboard sources', 0, 100_000)) {
		if (!row || typeof row !== 'object') continue;
		const kind = Object.getOwnPropertyDescriptor(row, 'kind');
		if (!kind?.enumerable || !Object.hasOwn(kind, 'value')) throw new TypeError('Clipboard source kind must be own data.');
		if (kind.value === 'image' && normalizeFramescaperImageSourceV1OrV2(row).schemaVersion === 2) {
			throw new RangeError('Editable image clipboard transfer is not supported; export or save its complete project instead.');
		}
	}
}
