/* SPDX-License-Identifier: AGPL-3.0-only */

export function hasWebGl2Capability(runtime = globalThis) {
	const canvas = runtime?.document?.createElement?.('canvas');
	if (typeof canvas?.getContext !== 'function') return false;
	return Boolean(canvas.getContext('webgl2', {
		alpha: true,
		antialias: false,
		depth: false,
		preserveDrawingBuffer: false,
		premultipliedAlpha: false,
		stencil: false,
	}));
}
