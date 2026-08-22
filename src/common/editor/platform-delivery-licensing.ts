/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The licensing rows the platform delivery catalog depends on, as recorded.
 *
 * The matrix itself is a large config document the running app has no other
 * reason to carry, so what ships is this: the status and blocker of exactly the
 * rows the catalog names. It is a copy, and a copy can drift, which is why a
 * test reads `config/production-licensing-matrix.json` and fails the moment
 * these two disagree — nothing here may claim a status the matrix does not.
 *
 * Editing this file does not clear a row. Clearing one is a recorded licensing
 * decision in the matrix, and this file follows it rather than leading it.
 */

export interface PlatformDeliveryLicensingRow {
	readonly id: string;
	readonly status: string;
	readonly blocker: string | null;
}

export const PLATFORM_DELIVERY_LICENSING_ROWS: readonly PlatformDeliveryLicensingRow[] = Object.freeze([
	Object.freeze({
		id: "codec-encode-hevc-mp4-main10-hdr10",
		status: "blocked",
		blocker: "No encoder implementation or build flag is selected, no HEVC pool review is recorded, and HDR10, payload, and five-target evidence is absent.",
	}),
	Object.freeze({
		id: "codec-encode-hevc-mp4-main10-sdr",
		status: "blocked",
		blocker: "No encoder implementation or build flag is selected, no HEVC pool review is recorded, and 10-bit SDR, payload, and five-target evidence is absent.",
	}),
	Object.freeze({
		id: "codec-native-ffmpeg-current-set",
		status: "blocked",
		blocker: "ffmpeg-enabled-library-corresponding-source and ffmpeg-enabled-codec-patent-review remain blocked for the shipped runtime, while the native FFmpeg 9.0.1 candidate has no reviewed build payload, exact codec/container clearance, signature, or target evidence.",
	}),
	Object.freeze({
		id: "codec-hardware-acceleration",
		status: "blocked",
		blocker: "No jurisdiction-specific patent review is recorded for any hardware-accelerated codec path; enablement waits on the native-codecs gate.",
	}),
	Object.freeze({
		id: "codec-encode-prores-mov-422-hq",
		status: "blocked",
		blocker: "The recipe names the encoder and muxer, but 422 HQ interoperability, payload, signing, and five-target reviews remain incomplete.",
	}),
	Object.freeze({
		id: "codec-encode-prores-mov-4444",
		status: "blocked",
		blocker: "The recipe names the encoder and muxer, but 4444 alpha interoperability, payload, signing, and five-target reviews remain incomplete.",
	}),
	Object.freeze({
		id: "codec-encode-png-image-sequence",
		status: "blocked",
		blocker: "PNG encode is disabled in the native recipe; alpha, sequence, payload, and five-target reviews remain incomplete.",
	}),]);

/** The same rows in the shape the availability resolver reads a matrix in. */
export const PLATFORM_DELIVERY_LICENSING_SNAPSHOT: Readonly<Record<string, unknown>> = Object.freeze({
	recordedRows: PLATFORM_DELIVERY_LICENSING_ROWS,
});
