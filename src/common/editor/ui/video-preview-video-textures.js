/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoPreviewFrameIdentity } from '../controller/clip-video/video-preview-frame-identity.ts';

/**
 * The compositor's cache of one GL texture per decoded video element.
 *
 * Lifted out of the compositor because it is bookkeeping rather than
 * compositing: which element owns which texture, when its contents have to be
 * re-uploaded rather than sub-imaged, and which textures the frame just drawn
 * no longer needs. The compositor keeps the map and the generation counter and
 * hands both in, so nothing about ownership moves with the code.
 */

/**
 * Upload one video frame, allocating its texture the first time it is seen.
 *
 * Reuse pixels until the decoded frame changes. A dimension change reallocates
 * the texture; subsequent decoded frames sub-image the existing allocation.
 */
export function uploadVideoTexture(gl, videoTextures, video, generation) {
	const drawable = video.drawable || video;
	let record = videoTextures.get(video);
	if (!record) {
		const texture = gl.createTexture();
		if (!texture) throw new Error('Unable to allocate a video frame texture.');
		record = {
			texture, width: 0, height: 0, generation, frameVersion: 0,
			frameIdentity: createVideoPreviewFrameIdentity(video),
		};
		videoTextures.set(video, record);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	} else {
		record.generation = generation;
		gl.bindTexture(gl.TEXTURE_2D, record.texture);
	}
	const resized = record.width !== video.videoWidth || record.height !== video.videoHeight;
	if (record.frameIdentity && !record.frameIdentity.needsUpload() && !resized) return record.texture;
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
	try {
		if (resized) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, drawable);
			record.width = video.videoWidth;
			record.height = video.videoHeight;
		} else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, drawable);
		record.frameVersion += 1;
		record.frameIdentity?.markUploaded();
	} finally {
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
	}
	return record.texture;
}

/** Drop one element's texture, for an element the caller knows is finished. */
export function releaseVideoTexture(gl, videoTextures, video) {
	const record = videoTextures.get(video);
	if (!record) return;
	videoTextures.delete(video);
	record.frameIdentity?.dispose();
	gl.deleteTexture(record.texture);
}

/** Drop every texture the frame just drawn did not touch. */
export function pruneVideoTextures(gl, videoTextures, generation) {
	for (const [video, record] of videoTextures) {
		if (record.generation === generation) continue;
		releaseVideoTexture(gl, videoTextures, video);
	}
}
