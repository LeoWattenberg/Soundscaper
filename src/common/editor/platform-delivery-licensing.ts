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
 * Editing this file does not clear a row. It is a runtime-facing snapshot of
 * licensing state; preset visibility and execution never depend on it.
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
		blocker: "The distribution policy permits WebCodecs, operating-system providers, and user-installed FFmpeg but disables bundled FFmpeg and a redistributed native FFmpeg media host. Corresponding source, notices, payload, and target verification also remain incomplete. The authenticated native FFmpeg 9.0.1 recipe remains enabled for build and testing only.",
	}),
	Object.freeze({
		id: "codec-hardware-acceleration",
		status: "blocked",
		blocker: "No hardware codec route is part of the distributed package inventory; machine-complete paths remain enabled for testing.",
	}),
	Object.freeze({
		id: "codec-encode-prores-mov-422-hq",
		status: "blocked",
		blocker: "The recipe names the encoder and muxer, but 422 HQ interoperability, payload, and target verification remain incomplete.",
	}),
	Object.freeze({
		id: "codec-encode-prores-mov-4444",
		status: "blocked",
		blocker: "The recipe names the encoder and muxer, but 4444 alpha interoperability, payload, and target verification remain incomplete.",
	}),
	Object.freeze({
		id: "codec-encode-png-image-sequence",
		status: "blocked",
		blocker: "PNG encode is enabled for authenticated build and testing; distribution interoperability and target verification remain incomplete.",
	}),]);

/** The same rows in the shape the availability resolver reads a matrix in. */
export const PLATFORM_DELIVERY_LICENSING_SNAPSHOT: Readonly<Record<string, unknown>> = Object.freeze({
	recordedRows: PLATFORM_DELIVERY_LICENSING_ROWS,
});
