/* SPDX-License-Identifier: AGPL-3.0-only */

import { deepFreezeAuditSites } from './foundation-audit-site-freeze.ts';
import type { FoundationTimeConversionSite } from './foundation-time-conversion-audit.ts';

/**
 * Conversion sites owned outside the shared editor: the two product trees and the
 * desktop main process.
 *
 * The shared helpers are importable from anywhere in the repository, so a register
 * that stopped at `src/common/editor` claimed a coverage it did not have. The paired
 * audit test walks `src/`, `desktop/` and `native/` and reads these sites through the
 * combined export, so a product-owned paste path or an assistance bound check is
 * classified on exactly the same terms as a foundation site.
 */
export const FOUNDATION_TIME_CONVERSION_PRODUCT_SITES: readonly FoundationTimeConversionSite[] = deepFreezeAuditSites([
	{
		id: 'desktop-owned-audio-cut-source-bounds',
		file: 'desktop/assistance-workflow-owned-audio-cut-source-normalization.ts',
		behavior: 'Raw model timing is bounded by the fenced audio extent restated at the model\'s own analysis rate: the fenced source span is scaled from the capture rate to that rate as a nearest-point sample count, and a voice-activity row, speaker turn or aligned word that ends past it is refused rather than clamped.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'soundscaper-automation-capture-position',
		file: 'src/soundscaper/editor-automation-session.ts',
		behavior: 'A musical-beat automation lane records each captured gesture point as the exact rational beat of the transport sample position under the authoritative tempo map, so the monotonicity comparison and a later tempo edit both keep the gesture; an absolute-sample lane stores the transport frame unconverted.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }],
	},
	{
		id: 'framescaper-v13-image-paste-placement',
		file: 'src/framescaper/editor-session-clipboard-v13-paste.ts',
		behavior: 'V13 image paste anchors at the nearest sequence frame to the paste sample position and converts the clip offsets, already rescaled from the clipboard rate to the destination rate, to nearest sequence frames, keeping the placed image at least one frame long.',
		conversions: [{ helper: 'sampleFrameToVideoFrame', policies: ['point'] }],
	},
	{
		id: 'framescaper-v11-visual-paste-placement',
		file: 'src/framescaper/editor-session-clipboard-v11-controller.ts',
		behavior: 'V11 finishing paste places a visual clip on the same terms as V13: the paste anchor and the clipboard-rescaled offset start and end each resolve to the nearest sequence frame at the destination rate, and the placed span is held to at least one frame.',
		conversions: [{ helper: 'sampleFrameToVideoFrame', policies: ['point'] }],
	},
	{
		id: 'framescaper-native-image-sequence-import',
		file: 'src/framescaper/editor-native-image-sequence-import.ts',
		behavior: 'An imported native image sequence takes its sample length from the enclosing end of its frame count so the final image is covered whole, and the bin clip converts that length back to the nearest sequence-frame count at the primary sequence rate, never below one frame.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['enclosingEnd'] },
		],
	},
	{
		id: 'framescaper-dissolve-authoring-workflow',
		file: 'src/framescaper/editor-selected-finishing-authoring-workflows.ts',
		behavior: 'Adding a dissolve to two adjacent unlinked video clips moves the incoming clip back by the negotiated transition length and states that sequence-frame start as a nearest-point timeline sample position for the move command.',
		conversions: [{ helper: 'videoFrameToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'framescaper-dissolve-visual-commands',
		file: 'src/framescaper/editor-selected-finishing-visual-authoring-commands.ts',
		behavior: 'Applying or removing a dissolve moves the incoming clip to the sequence frame the operation implies as a nearest-point sample position, and shifts a linked audio peer by the difference between the old and new starts converted the same way, so the A/V link survives the edit.',
		conversions: [{ helper: 'videoFrameToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'framescaper-add-images-placement',
		file: 'src/framescaper/editor-selected-timeline-image-image-authoring-controller.ts',
		behavior: 'Add Images inserts at the sequence frame enclosing the playhead sample position, so an import started part-way through a frame lands on the frame currently displayed rather than the following one.',
		conversions: [{ helper: 'sampleFrameToVideoFrame', policies: ['enclosingStart'] }],
	},
	{
		id: 'framescaper-highlight-publication-boundaries',
		file: 'src/framescaper/editor-local-assistance-highlight-publication.ts',
		behavior: 'A published assistance highlight must start and end on an exact sequence-frame boundary: each sample position resolves to the nearest sequence frame and is converted back at the same policy, and publication is refused unless that round trip returns the original sample.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
]);
