/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION, collectAudioEditorClipboardSourceIds,
	createAudioEditorSessionClipboard, normalizeAudioEditorSessionClipboard } from './session-clipboard-codec.ts';
import { createAudioEditorSessionControllerCore } from './session-controller-core.js';
export const AUDIO_EDITOR_SESSION_SCHEMA_VERSION = 1;
export { AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION, createAudioEditorSessionClipboard };

/**
 * @typedef {Object} AudioEditorSessionTab
 * @property {string} projectId
 * @property {Object} history
 * @property {boolean} readOnly
 * @property {string|null} readOnlyReason
 * @property {string|null} lockMethod
 * @property {boolean} dirty
 * @property {Object} metadata
 */

/**
 * Structured-clone-safe session snapshot. Source reference counts are derived
 * from tab histories and the clipboard, never trusted when restoring state.
 * @typedef {Object} AudioEditorSessionSnapshot
 * @property {1} schemaVersion
 * @property {string|null} activeProjectId
 * @property {AudioEditorSessionTab[]} tabs
 * @property {Object|null} clipboard
 * @property {Record<string, number>} sourceReferenceCounts
 * @property {boolean} disposed
 */

/**
 * A detached history snapshot paired with a private ownership token. The token
 * is deliberately absent from serialized session state and becomes stale when
 * its tab's history is replaced, closed, or restored as a new tab.
 *
 * @typedef {Object} AudioEditorSessionProjectHistoryCapture
 * @property {Object} history
 * @property {object} token
 */

const LEGACY_CLIPBOARD = Object.freeze({ schemaVersion: 1,
	normalizeClipboard: normalizeAudioEditorSessionClipboard, createClipboard: createAudioEditorSessionClipboard,
	collectSources: clipboard => collectAudioEditorClipboardSourceIds(clipboard?.descriptor),
	storageKeys: () => [], acceptsSnapshot: version => version === 1,
});
/** Existing session1 and clipboard1 remain fixed and strict. */
export function createAudioEditorSessionController(options = {}) {
	return createAudioEditorSessionControllerCore(options, LEGACY_CLIPBOARD);
}
