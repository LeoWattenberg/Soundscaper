/* SPDX-License-Identifier: AGPL-3.0-only */

// Product-neutral image kernels and inert still/effect/mask contracts serve
// Frame images and photo workflows. Their exact flat contracts share this
// owner so catalog validation does not load neighboring timeline domains.
/** @type {import('rolldown').CodeSplittingGroup[]} */
export const imagingChunkGroups = [{
	name: 'editor-imaging',
	test: /src[\\/]common[\\/]editor[\\/](?:imaging[\\/][^\\/]+\.ts|(?:image-import-admission|image-format-signature|image-decoder-routing|video-mask-matte-v24|video-visual-model-v24|timeline-image-(?:model|frame-pack-v1(?:-layout)?|native-decode-v1|browser-native-port|conversion-receipt-v1))\.ts|video-effects\.js)$/,
	priority: 66,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}];
