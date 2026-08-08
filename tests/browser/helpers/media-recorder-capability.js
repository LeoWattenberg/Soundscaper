/* SPDX-License-Identifier: AGPL-3.0-only */

export function hasMediaRecorderCapability(runtime = globalThis) {
	return typeof runtime?.MediaRecorder === 'function';
}
