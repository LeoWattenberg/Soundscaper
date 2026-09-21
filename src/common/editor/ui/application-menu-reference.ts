/* SPDX-License-Identifier: AGPL-3.0-only */

export type ApplicationMenuReferenceProduct = 'soundscaper' | 'framescaper';
export type ApplicationMenuReferenceKind = 'command' | 'setting' | 'link';

export interface ApplicationMenuReferenceEntry {
	readonly id: string;
	readonly label: string;
	readonly locations: readonly string[];
	readonly products: readonly ApplicationMenuReferenceProduct[];
	readonly kind: ApplicationMenuReferenceKind;
}

type ReferenceSeed = readonly [
	id: string,
	label: string,
	location: string | readonly string[],
	products: readonly ApplicationMenuReferenceProduct[],
	kind?: ApplicationMenuReferenceKind,
];

const SOUNDSCAPER = Object.freeze(['soundscaper'] as const);
const FRAMESCAPER = Object.freeze(['framescaper'] as const);
const BOTH = Object.freeze(['soundscaper', 'framescaper'] as const);

const REFERENCE_SEEDS: readonly ReferenceSeed[] = Object.freeze([
	// File: local project lifecycle, delivery, interchange, and native media.
	['claim-project-lock', 'Edit here', 'File', BOTH],
	['recent-project', 'Recent project', 'File > Open recent', BOTH],
	['switch-product-to-framescaper', 'Edit in Framescaper', 'File', SOUNDSCAPER],
	['switch-product-to-soundscaper', 'Edit in Soundscaper', 'File', FRAMESCAPER],
	['cancel-switch-product-to-framescaper', 'Cancel: Edit in Framescaper', 'File', SOUNDSCAPER],
	['cancel-switch-product-to-soundscaper', 'Cancel: Edit in Soundscaper', 'File', FRAMESCAPER],
	['delivery-queue', 'Delivery queue', 'File', BOTH],
	['delivery-report', 'Delivery Report', 'File', BOTH],
	['save-aup4', 'Export AUP4', 'File > Export other', SOUNDSCAPER],
	['export-edl', 'Export edit list (EDL)', 'File > Export other', BOTH],
	['export-otio', 'Export OpenTimelineIO', 'File > Export other', BOTH],
	['export-fcpxml', 'Export FCPXML', 'File > Export other', BOTH],
	['export-dawproject', 'Export DAWproject', 'File > Export other', BOTH],
	['framescaper-import-image-sequence', 'Image sequence', 'File', FRAMESCAPER],
	['framescaper-add-to-render-queue', 'Add to render queue', 'File > Export other', FRAMESCAPER],
	['local-projects', 'Local projects', 'File > Project management', BOTH],
	['consolidate-media', 'Consolidate media', 'File > Project management', BOTH],
	['trim-media', 'Trim media to what is used', 'File > Project management', BOTH],
	['save-archive-manifest', 'Save archive checksums', 'File > Project management', BOTH],
	['rename-project', 'Rename project', 'File > Project management', BOTH],
	['duplicate-project', 'Duplicate project', 'File > Project management', BOTH],
	['delete-project', 'Delete project', 'File > Project management', BOTH],
	['clear-data', 'Clear all local editor data', 'File > Project management', BOTH],

	// Framescaper's selected-clip application-menu operations.
	['trim-left-edge-to-playhead', 'Trim left edge to playhead', 'Edit > Audio clips', FRAMESCAPER],
	['trim-right-edge-to-playhead', 'Trim right edge to playhead', 'Edit > Audio clips', FRAMESCAPER],
	['roll-left-edge-to-playhead', 'Roll left edge to playhead', 'Edit > Audio clips', FRAMESCAPER],
	['roll-right-edge-to-playhead', 'Roll right edge to playhead', 'Edit > Audio clips', FRAMESCAPER],
	['ripple-left-edge-to-playhead', 'Ripple left edge to playhead', 'Edit > Audio clips', FRAMESCAPER],
	['ripple-right-edge-to-playhead', 'Ripple right edge to playhead', 'Edit > Audio clips', FRAMESCAPER],
	['slip-source-earlier-one-frame', 'Slip source earlier one frame', 'Edit > Audio clips', FRAMESCAPER],
	['slip-source-later-one-frame', 'Slip source later one frame', 'Edit > Audio clips', FRAMESCAPER],
	['slide-clip-earlier-one-frame', 'Slide clip earlier one frame', 'Edit > Audio clips', FRAMESCAPER],
	['slide-clip-later-one-frame', 'Slide clip later one frame', 'Edit > Audio clips', FRAMESCAPER],
	['rate-stretch-left-edge-to-playhead', 'Rate stretch left edge to playhead', 'Edit > Audio clips', FRAMESCAPER],
	['rate-stretch-right-edge-to-playhead', 'Rate stretch right edge to playhead', 'Edit > Audio clips', FRAMESCAPER],
	['video-link-audio', 'Link audio', 'Edit > Audio clips', FRAMESCAPER],
	['video-unlink-audio', 'Unlink audio', 'Edit > Audio clips', FRAMESCAPER],
	['video-composition-editor', 'Transform and compositing', 'Edit > Audio clips', FRAMESCAPER],
	['video-keyframes-editor', 'Video keyframes', 'Edit > Audio clips', FRAMESCAPER],
	['video-retime-editor', 'Video retime…', 'Edit > Audio clips', FRAMESCAPER],
	['video-proxy-manager', 'Video proxies…', 'Edit > Audio clips', FRAMESCAPER],
	['assistance-task-make-highlights', 'Make Highlights…', 'Edit', FRAMESCAPER],

	// View: panels, workspaces, grid settings, external display, and desktop development.
	['panel-project-bin', 'Project bin', 'View > Panels', BOTH, 'setting'],
	['panel-video-preview', 'Video preview', 'View > Panels', BOTH, 'setting'],
	['panel-source-monitor', 'Source monitor', 'View > Panels', BOTH, 'setting'],
	['panel-labels', 'Labels', 'View > Panels', BOTH, 'setting'],
	['panel-markers', 'Markers', 'View > Panels', BOTH, 'setting'],
	['panel-metadata', 'Metadata', 'View > Panels', BOTH, 'setting'],
	['panel-freesound', 'Freesound', 'View > Panels', SOUNDSCAPER, 'setting'],
	['panel-mixer', 'Mixer', 'View > Panels', BOTH, 'setting'],
	['panel-recording-setup', 'Recording setup', 'View > Panels', FRAMESCAPER, 'setting'],
	['framescaper-mixer', 'Mixer & Routing', 'View > Panels', FRAMESCAPER],
	['framescaper-dialogue-chain', 'Dialogue Chain', 'View > Panels', FRAMESCAPER],
	['workspace-modern', 'Soundscaper', 'View > Workspace', SOUNDSCAPER, 'setting'],
	['workspace-audacity', 'Audacity', 'View > Workspace', SOUNDSCAPER, 'setting'],
	['workspace-music', 'Music', 'View > Workspace', SOUNDSCAPER, 'setting'],
	['workspace-classic', 'Classic', 'View > Workspace', SOUNDSCAPER, 'setting'],
	['workspace-video-editor', 'Video editor', 'View > Workspace', FRAMESCAPER, 'setting'],
	['workspace-custom', 'Custom workspace', 'View > Workspace', BOTH, 'setting'],
	['workspace-onboarding', 'Set up workspace', 'View > Workspace', SOUNDSCAPER],
	['show-arm-controls', 'Enable multi-track recording', 'View', SOUNDSCAPER, 'setting'],
	['show-markers', 'Show markers', 'View', BOTH, 'setting'],
	['snap-enabled', 'Snap to grid', 'View > Snapping', BOTH, 'setting'],
	['snap-triplets', 'Enable triplets', 'View > Snapping', BOTH, 'setting'],
	['snap-bar', 'Bar', 'View > Snapping > Musical divisions', BOTH, 'setting'],
	['snap-1-2', '1/2', 'View > Snapping > Musical divisions', BOTH, 'setting'],
	['snap-1-4', '1/4', 'View > Snapping > Musical divisions', BOTH, 'setting'],
	['snap-1-8', '1/8', 'View > Snapping > Musical divisions', BOTH, 'setting'],
	['snap-1-16', '1/16', 'View > Snapping > Musical divisions', BOTH, 'setting'],
	['snap-1-32', '1/32', 'View > Snapping > Musical divisions', BOTH, 'setting'],
	['snap-1-64', '1/64', 'View > Snapping > Musical divisions', BOTH, 'setting'],
	['snap-1-128', '1/128', 'View > Snapping > Musical divisions', BOTH, 'setting'],
	['snap-seconds', 'Seconds', 'View > Snapping > Seconds and samples', BOTH, 'setting'],
	['snap-deciseconds', 'Deciseconds', 'View > Snapping > Seconds and samples', BOTH, 'setting'],
	['snap-centiseconds', 'Centiseconds', 'View > Snapping > Seconds and samples', BOTH, 'setting'],
	['snap-milliseconds', 'Milliseconds', 'View > Snapping > Seconds and samples', BOTH, 'setting'],
	['snap-samples', 'Samples', 'View > Snapping > Seconds and samples', BOTH, 'setting'],
	['snap-video-24', 'Video frames (24 fps)', 'View > Snapping > Video frames', BOTH, 'setting'],
	['snap-video-ntsc', 'NTSC frames (29.97 fps)', 'View > Snapping > Video frames', BOTH, 'setting'],
	['snap-video-ntsc-drop', 'NTSC drop frames', 'View > Snapping > Video frames', BOTH, 'setting'],
	['snap-video-pal', 'PAL frames (25 fps)', 'View > Snapping > Video frames', BOTH, 'setting'],
	['snap-cdda', 'CDDA frames (75 fps)', 'View > Snapping > CD frames', BOTH, 'setting'],
	['framescaper-external-display-none', 'None', 'View > External display', FRAMESCAPER, 'setting'],
	['framescaper-external-display', 'External display', 'View > External display', FRAMESCAPER, 'setting'],
	['desktop-reload', 'Reload', 'View', BOTH],
	['desktop-toggle-dev-tools', 'Toggle Developer Tools', 'View', BOTH, 'setting'],

	// Track structure and product workflows.
	['new-audio-track', 'Audio track', 'Tracks > Add new track', BOTH],
	['soundscaper-freeze-track', 'Freeze track', 'Tracks > Freeze', SOUNDSCAPER],
	['soundscaper-refresh-freeze', 'Refresh frozen track', 'Tracks > Freeze', SOUNDSCAPER],
	['soundscaper-unfreeze-track', 'Unfreeze track', 'Tracks > Freeze', SOUNDSCAPER],
	['soundscaper-commit-freeze', 'Commit frozen track', 'Tracks > Freeze', SOUNDSCAPER],
	['nested-sequence-create', 'Create shared sequence', 'Tracks > Nested sequences', FRAMESCAPER],
	['nested-sequence-add', 'Add nested placement', 'Tracks > Nested sequences', FRAMESCAPER],
	['nested-sequence-update', 'Move nested sequence', 'Tracks > Nested sequences', FRAMESCAPER],
	['nested-sequence-remove', 'Remove nested sequence', 'Tracks > Nested sequences', FRAMESCAPER],
	['nested-sequence-delete', 'Delete shared sequence', 'Tracks > Nested sequences', FRAMESCAPER],
	['multicamera-create', 'Create from video sources', 'Tracks > Multicamera', FRAMESCAPER],
	['multicamera-switch', 'Switch camera', 'Tracks > Multicamera', FRAMESCAPER],
	['multicamera-nudge-earlier', 'Move active camera one frame earlier', 'Tracks > Multicamera', FRAMESCAPER],
	['multicamera-nudge-later', 'Move active camera one frame later', 'Tracks > Multicamera', FRAMESCAPER],
	['multicamera-remove', 'Remove multicamera group', 'Tracks > Multicamera', FRAMESCAPER],
	['framescaper-add-video-adjustment-layer', 'Add Video Adjustment Layer', 'Tracks', FRAMESCAPER],
	['framescaper-caption-tracks', 'Caption Tracks', 'Tracks', FRAMESCAPER],
	['framescaper-audio-automation', 'Automation Lanes', 'Tracks', FRAMESCAPER],

	// Generate: menu-only visual authoring and local assistance.
	['framescaper-add-video-still', 'Add Images', 'Generate', FRAMESCAPER],
	['framescaper-add-video-title', 'Add Title/Text', 'Generate > Video Generators', FRAMESCAPER],
	['framescaper-add-video-text', 'Add Text', 'Generate > Video Generators', FRAMESCAPER],
	['framescaper-add-video-shape', 'Add Shape', 'Generate > Video Generators', FRAMESCAPER],
	['framescaper-add-video-solid', 'Add Solid', 'Generate > Video Generators', FRAMESCAPER],
	['framescaper-save-video-visual-preset', 'Save Visual Preset', 'Generate > Video Generators', FRAMESCAPER],
	['assistance-task-generate-editorial-text', 'Generate Editorial Text…', 'Generate', BOTH],

	// Soundscaper native effects and destructive selection effects.
	['native-effect-manage', 'Plugin Manager', 'Effect', SOUNDSCAPER],
	['native-effect-use', 'Audio Plugins', 'Effect', SOUNDSCAPER],
	['audacity-amplify', 'Amplify', 'Effect > Volume and compression', SOUNDSCAPER],
	['audacity-auto-duck', 'Auto Duck', 'Effect > Volume and compression', SOUNDSCAPER],
	['audacity-compressor', 'Compressor', 'Effect > Volume and compression', SOUNDSCAPER],
	['multiband-compressor', 'Multiband compressor', 'Effect > Volume and compression', SOUNDSCAPER],
	['audacity-limiter', 'Limiter', 'Effect > Volume and compression', SOUNDSCAPER],
	['audacity-loudness-normalization', 'Loudness Normalization', 'Effect > Volume and compression', SOUNDSCAPER],
	['audacity-normalize', 'Normalize', 'Effect > Volume and compression', SOUNDSCAPER],
	['audacity-remove-dc-offset', 'Remove DC Offset', 'Effect > Volume and compression', SOUNDSCAPER],
	['audacity-fade-in', 'Fade In', 'Effect > Fading', SOUNDSCAPER],
	['audacity-fade-out', 'Fade Out', 'Effect > Fading', SOUNDSCAPER],
	['eq', 'Four-band parametric EQ', 'Effect > EQ and filters', SOUNDSCAPER],
	['highpass-filter', 'High-pass filter', 'Effect > EQ and filters', SOUNDSCAPER],
	['lowpass-filter', 'Low-pass filter', 'Effect > EQ and filters', SOUNDSCAPER],
	['notch-filter', 'Notch filter', 'Effect > EQ and filters', SOUNDSCAPER],
	['shelf-filter', 'Shelf filter', 'Effect > EQ and filters', SOUNDSCAPER],
	['audacity-bass-treble', 'Bass and Treble', 'Effect > EQ and filters', SOUNDSCAPER],
	['audacity-filter-curve-eq', 'Filter Curve EQ', 'Effect > EQ and filters', SOUNDSCAPER],
	['audacity-graphic-eq', 'Graphic EQ', 'Effect > EQ and filters', SOUNDSCAPER],
	['deesser', 'De-esser', 'Effect > Noise removal and repair', SOUNDSCAPER],
	['noise-gate', 'Noise gate', 'Effect > Noise removal and repair', SOUNDSCAPER],
	['audacity-click-removal', 'Click Removal', 'Effect > Noise removal and repair', SOUNDSCAPER],
	['audacity-noise-reduction', 'Noise Reduction', 'Effect > Noise removal and repair', SOUNDSCAPER],
	['audacity-repair', 'Repair', 'Effect > Noise removal and repair', SOUNDSCAPER],
	['multi-tap-delay', 'Delay', 'Effect > Delay and reverb', SOUNDSCAPER],
	['audacity-echo', 'Echo', 'Effect > Delay and reverb', SOUNDSCAPER],
	['audacity-reverb', 'Reverb (Audacity)', 'Effect > Delay and reverb', SOUNDSCAPER],
	['audacity-distortion', 'Distortion', 'Effect > Distortion and modulation', SOUNDSCAPER],
	['bitcrusher', 'Bitcrusher', 'Effect > Distortion and modulation', SOUNDSCAPER],
	['tremolo', 'Tremolo', 'Effect > Distortion and modulation', SOUNDSCAPER],
	['vocoder', 'Vocoder', 'Effect > Distortion and modulation', SOUNDSCAPER],
	['audacity-phaser', 'Phaser', 'Effect > Distortion and modulation', SOUNDSCAPER],
	['audacity-wahwah', 'Wahwah', 'Effect > Distortion and modulation', SOUNDSCAPER],
	['audacity-invert', 'Invert', 'Effect > Special', SOUNDSCAPER],
	['audacity-repeat', 'Repeat', 'Effect > Special', SOUNDSCAPER],
	['audacity-reverse', 'Reverse', 'Effect > Special', SOUNDSCAPER],
	['audacity-truncate-silence', 'Truncate Silence', 'Effect > Special', SOUNDSCAPER],
	['reviewed-utility-gain', 'Utility Gain (Reviewed)', 'Effect > Special', SOUNDSCAPER],
	['audacity-legacy-compressor', 'Legacy Compressor', 'Effect > Legacy effects', SOUNDSCAPER],
	['audacity-classic-filters', 'Classic Filters', 'Effect > Legacy effects', SOUNDSCAPER],
	['audio-warp-editor', 'Audio warp and transients', 'Effect > Pitch and tempo', SOUNDSCAPER],
	['audacity-paulstretch', 'Paulstretch', 'Effect > Pitch and tempo', SOUNDSCAPER],

	// Framescaper visual effects and native OpenFX entry points.
	['framescaper-add-video-transition', 'Add Video Transition', 'Effect > Video Transitions', FRAMESCAPER],
	['framescaper-add-dissolve-transition', 'Add Dissolve Transition', 'Effect > Video Transitions', FRAMESCAPER],
	['framescaper-edit-video-mask-matte', 'Edit Video Mask/Matte', 'Effect', FRAMESCAPER],
	['framescaper-freeze-video', 'Freeze Video', 'Effect', FRAMESCAPER],
	['framescaper-visual-inspector', 'Selected Visual Inspector', 'Effect > Video Finishing', FRAMESCAPER],
	['framescaper-color-management', 'Managed Color & Source Interpretation', 'Effect > Video Finishing', FRAMESCAPER],
	['framescaper-grading-presets', 'Grading & Finishing Presets', 'Effect > Video Finishing', FRAMESCAPER],
	['framescaper-stabilization', 'Similarity Stabilization', 'Effect > Video Finishing', FRAMESCAPER],
	['framescaper-denoise', 'Spatial & Temporal Denoise', 'Effect > Video Finishing', FRAMESCAPER],
	['framescaper-ofx-manage', 'Plugin Manager', 'Effect', FRAMESCAPER],
	['framescaper-ofx-add', 'Add OFX', 'Effect > Video effects', FRAMESCAPER],
	['framescaper-ofx-interact', 'Open OFX Interact', 'Effect > Video effects', FRAMESCAPER],

	// Assistance tasks are desktop-only at runtime, but retain product ownership here.
	['assistance-task-enhance-dialogue', 'Enhance Dialogue…', 'Effect > Noise removal and repair', BOTH],
	['assistance-task-reduce-reverb', 'Reduce Reverb…', 'Effect > Noise removal and repair', BOTH],
	['assistance-task-clean-filler-silence', 'Clean Filler & Silence…', 'Effect > Noise removal and repair', BOTH],
	['assistance-task-separate-dialogue-music-effects', 'Separate Dialogue / Music / Effects…', 'Effect > Source Separation', BOTH],
	['assistance-task-reframe', 'Reframe…', 'Effect > Video effects', FRAMESCAPER],

	// Analysis panels and guided analysis tasks.
	['analysis', 'Analysis', 'Analyze', SOUNDSCAPER],
	['ebu-r128-metrics', 'EBU R 128', 'Analyze', SOUNDSCAPER],
	['measure-loudness', 'Measure loudness', 'Analyze', SOUNDSCAPER],
	['native-analyzer-use', 'Vamp Plugins', 'Analyze', SOUNDSCAPER],
	['framescaper-motion-tracking', 'Motion Tracking', 'Analyze', FRAMESCAPER],
	['assistance-task-transcribe-captions', 'Transcribe & Captions…', 'Analyze > Speech', BOTH],
	['assistance-task-identify-speakers', 'Identify Speakers…', 'Analyze > Speech', BOTH],
	['assistance-task-mark-reactions', 'Mark Reactions…', 'Analyze > Speech', BOTH],
	['assistance-task-detect-beats-tempo', 'Detect Beats & Tempo…', 'Analyze > Music', BOTH],
	['assistance-task-mark-cuts', 'Mark Cuts…', 'Analyze > Video', FRAMESCAPER],

	// Tools: local models/assistance, mastering, and native video services.
	['local-assistance', 'Advanced Local Processing…', 'Tools', BOTH],
	['local-assistance-indexed-search', 'Indexed Search…', 'Tools > Search', BOTH],
	['assistance-task-index-transcript', 'Index Transcript…', 'Tools > Search', BOTH],
	['assistance-task-index-video', 'Index Video…', 'Tools > Search', FRAMESCAPER],
	['manage-local-models', 'Model Manager…', 'Tools', BOTH],
	['soundscaper-mastering-sequences', 'Mastering sequences', 'Tools', SOUNDSCAPER],
	['native-audio-device', 'Native audio device', 'Tools > Audio setup', SOUNDSCAPER, 'setting'],
	['native-audio-preferences', 'Native audio and latency', 'Tools > Audio setup', SOUNDSCAPER, 'setting'],
	['framescaper-background-jobs', 'Background jobs', 'Tools', FRAMESCAPER],
	['framescaper-watch-folders', 'Watch folders', 'Tools', FRAMESCAPER],
	['framescaper-proxy-generate', 'Generate', 'Tools > Proxies', FRAMESCAPER],
	['framescaper-proxy-attach', 'Attach', 'Tools > Proxies', FRAMESCAPER],
	['framescaper-proxy-detach', 'Detach', 'Tools > Proxies', FRAMESCAPER],
	['framescaper-proxy-relink', 'Relink', 'Tools > Proxies', FRAMESCAPER],
	['framescaper-native-media-preferences', 'Native media and scratch', 'Tools', FRAMESCAPER, 'setting'],
	['desktop-use-native-probe-helper', 'Use Native Probe Helper', 'Tools', BOTH, 'setting'],
	['desktop-clear-probe-helper-quarantine', 'Clear Probe Helper Quarantine', 'Tools', BOTH],
	['desktop-use-native-audio-helper', 'Use Native Audio Helper', 'Tools', BOTH, 'setting'],
	['desktop-clear-audio-helper-quarantine', 'Clear Audio Helper Quarantine', 'Tools', BOTH],
	['desktop-discover-native-effects', 'Discover Native Effects', 'Tools', BOTH, 'setting'],

	// Help: local surfaces, install affordance, and desktop links.
	['privacy-policy', 'Privacy policy', 'Help', BOTH, 'link'],
	['community-translations', 'Contribute translations', 'Help', BOTH, 'link'],
	['install-soundscaper', 'Install Soundscaper', 'Help', SOUNDSCAPER],
	['install-framescaper', 'Install Framescaper', 'Help', FRAMESCAPER],
	['debug-storage', 'Debug storage', 'Help', BOTH, 'setting'],
	['desktop-product-help-soundscaper', 'Soundscaper Help', 'Help', SOUNDSCAPER, 'link'],
	['desktop-product-help-framescaper', 'Framescaper Help', 'Help', FRAMESCAPER, 'link'],
	['desktop-check-updates', 'Check for updates', 'Help', BOTH],
	['desktop-view-source', 'View source', 'Help', BOTH, 'link'],
]);

function createReferenceEntry(seed: ReferenceSeed): Readonly<ApplicationMenuReferenceEntry> {
	const [id, label, location, products, kind = 'command'] = seed;
	const locations = typeof location === 'string' ? [location] : [...location];
	return Object.freeze({
		id,
		label,
		locations: Object.freeze(locations),
		products: Object.freeze([...products]),
		kind,
	});
}

export const APPLICATION_MENU_REFERENCE_ENTRIES: readonly Readonly<ApplicationMenuReferenceEntry>[] =
	Object.freeze(REFERENCE_SEEDS.map(createReferenceEntry));

export const APPLICATION_MENU_REFERENCE_BY_ID: Readonly<Record<string, Readonly<ApplicationMenuReferenceEntry>>> =
	Object.freeze(Object.fromEntries(APPLICATION_MENU_REFERENCE_ENTRIES.map((entry) => [entry.id, entry])));

/** Compatibility name for consumers that naturally treat the registry as a lookup. */
export const APPLICATION_MENU_REFERENCE = APPLICATION_MENU_REFERENCE_BY_ID;
