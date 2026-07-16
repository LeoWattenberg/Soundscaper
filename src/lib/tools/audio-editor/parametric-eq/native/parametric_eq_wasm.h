/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_PARAMETRIC_EQ_WASM_H
#define SOUNDSCAPER_PARAMETRIC_EQ_WASM_H

#ifdef __cplusplus
extern "C" {
#endif

enum PeqStatus {
    PEQ_OK = 0,
    PEQ_ERROR_NOT_INITIALIZED = -1,
    PEQ_ERROR_INVALID_ARGUMENT = -2,
    PEQ_ERROR_BUSY = -3,
    PEQ_ERROR_INVALID_CONFIGURATION = -4,
    PEQ_ERROR_NONFINITE_AUDIO = -5,
    PEQ_ERROR_NO_ACTIVE_CONFIGURATION = -6
};

enum PeqCommitMode {
    PEQ_COMMIT_IMMEDIATE = 0,
    PEQ_COMMIT_SMOOTH = 1,
    PEQ_COMMIT_CROSSFADE = 2
};

enum PeqConfigurationSelector {
    PEQ_CONFIGURATION_ACTIVE = 0,
    PEQ_CONFIGURATION_STAGING = 1
};

enum PeqBandType {
    PEQ_BAND_PEAKING = 0,
    PEQ_BAND_LOWSHELF = 1,
    PEQ_BAND_HIGHSHELF = 2,
    PEQ_BAND_HIGHPASS = 3,
    PEQ_BAND_LOWPASS = 4,
    PEQ_BAND_NOTCH = 5,
    PEQ_BAND_AUDITION_BANDPASS = 6
};

int peq_abi_version(void);
int peq_maximum_block_size(void);
int peq_maximum_channels(void);
int peq_maximum_bands(void);
int peq_maximum_sections(void);
int peq_linear_memory_bytes(void);

/* One WASM instance owns one processor. Coefficients are sample-rate-specific. */
int peq_initialize(int sample_rate, int channels);
int peq_channel_count(void);
int peq_sample_rate(void);

/* Fixed Float32 planar transfer buffers, each peq_maximum_block_size() frames. */
float* peq_input_pointer(int channel);
float* peq_output_pointer(int channel);

/*
 * Build the inactive configuration transactionally. Bands must describe
 * contiguous, non-overlapping ranges which cover every section exactly once.
 */
int peq_begin_configuration(int band_count, int section_count, double output_gain_db);
int peq_set_band(int band, int first_section, int section_count, double wet);
int peq_set_section(
    int section,
    double g,
    double k,
    double m0,
    double m1,
    double m2);

/*
 * Production configuration path. The native core derives the matched SOS/TPT
 * sections so semantic parameters can be one-pole smoothed and redesigned at
 * a fixed 16-sample cadence without allocating in the audio callback.
 */
int peq_begin_semantic_configuration(int band_count, double output_gain_db);
int peq_set_semantic_band(
    int band,
    int type,
    int slope_db_per_octave,
    double frequency_hz,
    double gain_db,
    double q,
    double wet);

/*
 * IMMEDIATE replaces the active bank and clears state. SMOOTH requires the
 * same topology and preserves state while applying a 5 ms semantic one-pole
 * in log2(frequency), log(Q), gain dB, and output dB. Matched coefficients are
 * redesigned every 16 samples and only TPT values are interpolated. Band wet
 * changes use independent 10 ms raised-cosine ramps.
 * CROSSFADE clears the new bank and runs both complete cascades in parallel.
 */
int peq_commit_configuration(int mode, int transition_frames);
int peq_is_transitioning(void);

/* Process 1..maximum_block_size frames from the fixed input to output buffers. */
int peq_process(int frames);
int peq_reset(void);

/* Evaluate the active or completely-built staging cascade at frequency_hz. */
double peq_response_db(int configuration, double frequency_hz);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* SOUNDSCAPER_PARAMETRIC_EQ_WASM_H */
