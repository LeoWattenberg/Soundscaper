/* SPDX-License-Identifier: AGPL-3.0-only */

export const FRAMESCAPER_BASELINE_ENTRY_MODULES = Object.freeze([
	'editor-project.ts',
	'editor-project-commands.ts',
	'editor-project-feature-requirements.ts',
	'editor-project-playback.ts',
	'editor-project-runtime.ts',
	'editor-project-runtime-profile.ts',
	'editor-project-runtime-selection.ts',
	'editor-project-source-rebind.ts',
	'editor-project-store.ts',
	'editor-scape-assets.ts',
	'editor-native-watch-import-client.ts',
	'editor-native-render-input-stream-producer.ts',
	'editor-native-prores-proxy-candidate.ts',
	'editor-controller-assistance-foundation-view.ts',
	'editor-controller-assistance-inherited-bindings.ts',
	'editor-controller.ts',
	'video-export-strategy.ts',
	'desktop-project-library-body-contract.ts',
	'desktop-project-library-body-transfer.ts',
	'desktop-project-library-renderer.ts',
] as const);

/**
 * Closed boundary inventory for the product tree. Every surviving version token
 * denotes an independently serialized clipboard, delivery, or native carrier.
 */
export const FRAMESCAPER_BASELINE_VERSIONED_BOUNDARIES = Object.freeze([
	boundary('./delivery-native-report-closure-v1.ts', 'contract',
		'Native delivery report closure uses persisted protocol version 1.'),
	boundary('./delivery-native-report-v1.ts', 'contract',
		'Native delivery report document uses persisted protocol version 1.'),
	boundary('./delivery-native-report-validation-v1.ts', 'contract',
		'Native delivery report validator is bound to persisted protocol version 1.'),
	boundary('./editor-session-clipboard-v8.ts', 'contract',
		'Clipboard document version 8 remains an independently persisted contract.'),
	boundary('./editor-session-clipboard-v9.ts', 'contract',
		'Clipboard document version 9 remains an independently persisted contract.'),
	boundary('./editor-session-clipboard-v11.ts', 'contract',
		'Clipboard document version 11 remains an independently persisted contract.'),
	boundary('./editor-session-clipboard-v11-controller.ts', 'contract',
		'Clipboard version 11 controller retains its persisted DTO boundary.'),
	boundary('./editor-session-clipboard-v11-selection.ts', 'contract',
		'Clipboard version 11 selection retains its persisted DTO boundary.'),
	boundary('./editor-session-clipboard-v12.ts', 'contract',
		'Clipboard document version 12 remains an independently persisted contract.'),
	boundary('./editor-session-clipboard-v12-controller.ts', 'contract',
		'Clipboard version 12 controller retains its persisted DTO boundary.'),
	boundary('./editor-session-clipboard-v13-paste.ts', 'contract',
		'Clipboard version 13 image-body transfer remains independently persisted.'),
	boundary('./editor-session-clipboard-v13.ts', 'contract',
		'Clipboard document version 13 remains an independently persisted contract.'),
	boundary('./native-render-frame-pack-v1.ts', 'contract',
		'Native evaluated RGBA frame pack uses persisted carrier protocol version 1.'),
] as const);

function boundary(
	module: `./${string}.ts`,
	kind: 'contract',
	reason: string,
) {
	return Object.freeze({ module, kind, reason });
}
