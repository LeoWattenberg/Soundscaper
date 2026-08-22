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
		id: "codec-hevc-and-av1",
		status: "blocked",
		blocker: "No HEVC pool review and no AV1 patent-licence review are recorded, and enabling either decoder enlarges the FFmpeg enabled set that ffmpeg-enabled-library-corresponding-source and ffmpeg-enabled-codec-patent-review already gate.",
	}),
	Object.freeze({
		id: "codec-hardware-acceleration",
		status: "blocked",
		blocker: "No jurisdiction-specific patent review is recorded for any hardware-accelerated codec path; enablement waits on the native-codecs gate.",
	}),
	Object.freeze({
		id: "codec-mezzanine-and-longform",
		status: "blocked",
		blocker: "No per-format inventory exists; every milestone-5B decode/encode tier lands its own row against the native-codecs gate before it is buildable.",
	}),
	Object.freeze({
		id: "container-mov-mxf-matroska",
		status: "blocked",
		blocker: "Enabling the MOV, MXF, and Matroska muxers enlarges the FFmpeg enabled set that ffmpeg-enabled-library-corresponding-source gates, and no notices or corresponding-source inventory has been written for the enlarged set.",
	}),
	Object.freeze({
		id: "codec-image-sequence-still-formats",
		status: "blocked",
		blocker: "The source candidate contains gated FFmpeg 9.0.1 internal PNG, TIFF, and EXR adapter code, but the closed release recipe enables none of those decoders or encoders; corresponding-source, interoperability, payload, and target review remain incomplete.",
	}),]);

/** The same rows in the shape the availability resolver reads a matrix in. */
export const PLATFORM_DELIVERY_LICENSING_SNAPSHOT: Readonly<Record<string, unknown>> = Object.freeze({
	recordedRows: PLATFORM_DELIVERY_LICENSING_ROWS,
});
