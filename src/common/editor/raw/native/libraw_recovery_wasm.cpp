/* SPDX-License-Identifier: AGPL-3.0-only */

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <limits>
#include <new>
#include "libraw/libraw.h"

// ABI2 is a separate fixed-profile decoder. It neither changes ABI1's native
// bytes nor accepts filenames, external profiles or arbitrary process options.
namespace {
constexpr uint32_t MAX_INPUT = 64u * 1024u * 1024u;
constexpr uint32_t MIN_SIDE = 16u, MAX_SIDE = 8192u;
constexpr uint64_t MAX_PIXELS = 16777216u;
constexpr uint64_t MAX_MEMORY = 512u * 1024u * 1024u;
constexpr uint64_t METADATA_RESERVE = 32u * 1024u * 1024u;
constexpr uint64_t AHD_SCRATCH = 6815744u; // 26 * LIBRAW_AHD_TILE(512)^2.
constexpr uint64_t HISTOGRAM_AND_PROFILE = 4u * 8192u * 4u + 1024u;
constexpr int BAD_STATE = -100001, BAD_BOUNDS = -100002;
constexpr int NO_MEMORY = -100003, BAD_OUTPUT = -100004, NATIVE_EXCEPTION = -100005;
constexpr int UNSUPPORTED_PROFILE = -100006;
struct NativeFailure { int status; };

unsigned char *input = nullptr;
uint32_t input_length = 0, original_flip = 0, requested_mode = 0;
float *output = nullptr;
uint32_t output_length = 0, output_width = 0, output_height = 0;
double exposure_scale = 0;
bool opened = false, attempted = false, captured = false, completed = false;

void wipe(void *pointer, size_t bytes) {
	volatile unsigned char *cursor = static_cast<volatile unsigned char *>(pointer);
	while (bytes--) *cursor++ = 0;
}
void clear_output() {
	if (output) { wipe(output, output_length); std::free(output); output = nullptr; }
	output_length = output_width = output_height = 0;
	exposure_scale = 0; captured = completed = false;
}
bool dimensions(uint32_t width, uint32_t height) {
	return width >= MIN_SIDE && height >= MIN_SIDE && width <= MAX_SIDE && height <= MAX_SIDE
		&& uint64_t(width) * height <= MAX_PIXELS;
}
uint64_t larger(uint64_t left, uint64_t right) { return left > right ? left : right; }

class RecoveryDecoder final : public LibRaw {
public:
	bool supported_layout(bool unpacked) {
		const auto &s = imgdata.sizes;
		const auto &id = imgdata.idata;
		const auto &internal = libraw_internal_data;
		if (!dimensions(s.raw_width, s.raw_height) || !dimensions(s.width, s.height)
			|| uint64_t(s.left_margin) + s.width > s.raw_width || uint64_t(s.top_margin) + s.height > s.raw_height
			|| !std::isfinite(s.pixel_aspect) || s.pixel_aspect != 1.0
			|| s.flip < 0 || s.flip > 7 || id.colors != 3 || id.is_foveon || id.filters <= 1000
			|| id.cdesc[0] != 'R' || id.cdesc[1] != 'G' || id.cdesc[2] != 'B' || (id.cdesc[3] != 'G' && id.cdesc[3] != '\0')
			|| internal.internal_output_params.fuji_width || internal.unpacker_data.fuji_layout
			|| internal.internal_output_params.shrink || imgdata.params.half_size || imgdata.params.four_color_rgb
			|| is_floating_point() || is_sraw()) return false;
		if (s.raw_pitch && uint64_t(s.raw_pitch) != uint64_t(s.raw_width) * 2u) return false;
		static const unsigned char tiles[4][4] = { {0, 1, 1, 2}, {2, 1, 1, 0}, {1, 0, 2, 1}, {1, 2, 0, 1} };
		bool regular = false;
		for (unsigned tile = 0; tile < 4; ++tile) {
			bool matches = true;
			for (int row = 0; row < 8; ++row) for (int col = 0; col < 2; ++col) {
				const int channel = FC(row, col), canonical = channel == 3 ? 1 : channel;
				if (canonical != tiles[tile][(row % 2) * 2 + col]) matches = false;
			}
			regular = regular || matches;
		}
		if (!regular) return false;
		if (unpacked) {
			const auto &r = imgdata.rawdata;
			if (!r.raw_image || r.color3_image || r.color4_image || r.float_image || r.float3_image || r.float4_image
				|| have_fpdata() || uint64_t(s.raw_pitch) != uint64_t(s.raw_width) * 2u) return false;
		}
		return true;
	}

	bool working_bounds() const {
		const auto &s = imgdata.sizes;
		if (!dimensions(s.raw_width, s.raw_height) || !dimensions(s.width, s.height)) return false;
		const uint64_t raw_bytes = uint64_t(s.raw_width) * (uint64_t(s.raw_height) + 8u) * 2u;
		const uint64_t image_bytes = (uint64_t(s.width) + 2u) * (uint64_t(s.height) + 2u) * 8u;
		const uint64_t recovery_map = uint64_t(s.width / 4u) * (s.height / 4u) * 4u;
		const uint64_t float_output = uint64_t(s.width) * s.height * 12u;
		// AHD and the recovery map retire before the RGB conversion callback.
		// This reserve plus the hard heap ceiling also bounds decoder metadata
		// and format-specific allocation; exhaustion refuses without fallback.
		const uint64_t phase = larger(AHD_SCRATCH, larger(recovery_map, float_output + HISTOGRAM_AND_PROFILE));
		return uint64_t(input_length) + raw_bytes + image_bytes + METADATA_RESERVE
			+ uint64_t(libraw_internal_data.unpacker_data.meta_length) + phase <= MAX_MEMORY;
	}

protected:
	void convert_to_rgb_loop(float matrix[3][4]) override {
		if (captured || output || !supported_layout(true) || !working_bounds()
			|| libraw_internal_data.internal_output_params.raw_color || !imgdata.image
			|| imgdata.idata.colors != 3 || imgdata.sizes.flip != int(original_flip)
			|| imgdata.sizes.iwidth != imgdata.sizes.width || imgdata.sizes.iheight != imgdata.sizes.height
			|| imgdata.color.maximum == 0) throw NativeFailure{UNSUPPORTED_PROFILE};
		double minimum = 2.0;
		for (unsigned c = 0; c < 4; ++c) {
			const float q = imgdata.color.pre_mul[c];
			if (!std::isfinite(q) || q <= 0 || q > 1.000001f) throw NativeFailure{UNSUPPORTED_PROFILE};
			if (c < 3 && int(32000.f * q) < 1) throw NativeFailure{UNSUPPORTED_PROFILE};
			if (double(q) < minimum) minimum = q;
		}
		const double scale = 1.0 / minimum;
		if (!std::isfinite(scale) || scale < 1.0 || scale > 65536.0) throw NativeFailure{UNSUPPORTED_PROFILE};
		for (unsigned channel = 0; channel < 3; ++channel) for (unsigned camera = 0; camera < 4; ++camera) {
			if (!std::isfinite(matrix[channel][camera])) throw NativeFailure{BAD_OUTPUT};
		}
		const uint32_t width = imgdata.sizes.width, height = imgdata.sizes.height;
		const uint32_t oriented_width = original_flip & 4u ? height : width;
		const uint32_t oriented_height = original_flip & 4u ? width : height;
		const uint64_t bytes = uint64_t(oriented_width) * oriented_height * 12u;
		if (!dimensions(oriented_width, oriented_height) || bytes > MAX_PIXELS * 12u || !working_bounds()) {
			throw NativeFailure{BAD_BOUNDS};
		}
		output = static_cast<float *>(std::calloc(size_t(bytes), 1));
		if (!output) throw std::bad_alloc();
		output_length = uint32_t(bytes);
		// Exactly the upstream flip_index transform, without changing LibRaw's
		// sizes or allocating an unoriented Float32 intermediate.
		for (uint32_t row = 0; row < oriented_height; ++row) for (uint32_t col = 0; col < oriented_width; ++col) {
			uint32_t source_row = row, source_col = col;
			if (original_flip & 4u) { const uint32_t temporary = source_row; source_row = source_col; source_col = temporary; }
			if (original_flip & 2u) source_row = height - 1u - source_row;
			if (original_flip & 1u) source_col = width - 1u - source_col;
			const auto *camera = imgdata.image[uint64_t(source_row) * width + source_col];
			const uint64_t to = (uint64_t(row) * oriented_width + col) * 3u;
			for (unsigned channel = 0; channel < 3; ++channel) {
				const double value = (double(matrix[channel][0]) * camera[0] + double(matrix[channel][1]) * camera[1]
					+ double(matrix[channel][2]) * camera[2]) * scale / 65535.0;
				if (!std::isfinite(value) || std::fabs(value) > double(std::numeric_limits<float>::max())) throw NativeFailure{BAD_OUTPUT};
				const float stored = float(value);
				if (!std::isfinite(stored)) throw NativeFailure{BAD_OUTPUT};
				output[to + channel] = stored;
			}
		}
		output_width = oriented_width; output_height = oriented_height;
		exposure_scale = scale; captured = true;
		// No base call: its RGB ushort CLIP, histogram and memory-image gamma
		// curve are deliberately outside this signed Float32 capture profile.
	}
};
RecoveryDecoder *decoder = nullptr;

void fixed_parameters(uint32_t mode) {
	auto &p = decoder->imgdata.params;
	p.output_bps = 16; p.output_color = 1; p.gamm[0] = 1.0; p.gamm[1] = 1.0;
	p.no_auto_bright = 1; p.bright = 1.f; p.user_qual = 3; p.user_flip = -1;
	p.use_auto_wb = 0; p.use_camera_wb = 0; p.use_camera_matrix = 1; p.no_auto_scale = 0;
	p.highlight = int(mode); p.adjust_maximum_thr = .75f;
	p.half_size = 0; p.four_color_rgb = 0; p.threshold = 0; p.no_interpolation = 0;
	p.green_matching = 0; p.med_passes = 0; p.exp_correc = 0; p.use_fuji_rotate = 1;
	p.output_profile = nullptr; p.camera_profile = nullptr; p.bad_pixels = nullptr; p.dark_frame = nullptr;
	p.user_black = -1; p.user_sat = -1;
	for (unsigned c = 0; c < 4; ++c) { p.user_mul[c] = 0; p.user_cblack[c] = -1000001; p.aber[c] = 1.0; }
	p.cropbox[0] = p.cropbox[1] = 0; p.cropbox[2] = p.cropbox[3] = std::numeric_limits<unsigned>::max();
	decoder->imgdata.rawparams.max_raw_memory_mb = 256;
	decoder->imgdata.rawparams.use_rawspeed = 0; decoder->imgdata.rawparams.use_dngsdk = 0;
	decoder->imgdata.rawparams.options = 0; // Floating RAW is refused, never silently quantized to integer.
}
} // namespace

extern "C" {
// Standalone Emscripten's musl timezone hook has no host timezone authority.
// Keep deterministic UTC metadata handling without adding JS/WASI imports.
void __secs_to_zone(long long, int, int *isdst, long *offset, long *opposite_offset, const char **zone) {
	static const char utc[] = "UTC";
	if (isdst) *isdst = 0;
	if (offset) *offset = 0;
	if (opposite_offset) *opposite_offset = 0;
	if (zone) *zone = utc;
}
uint32_t raw_abi_version() { return 2; }
uint32_t raw_profile_version() { return 1; }
uint32_t raw_input_alloc(uint32_t length) {
	if (input || decoder || length == 0 || length > MAX_INPUT) return 0;
	input = static_cast<unsigned char *>(std::calloc(length, 1));
	if (!input) return 0;
	input_length = length; return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(input));
}
int raw_open() {
	if (!input || !input_length || decoder) return BAD_STATE;
	try {
		decoder = new RecoveryDecoder(); fixed_parameters(1);
		const int status = decoder->open_buffer(input, input_length);
		if (status) return status;
		if (!decoder->supported_layout(false)) return UNSUPPORTED_PROFILE;
		if (!decoder->working_bounds()) return BAD_BOUNDS;
		original_flip = uint32_t(decoder->imgdata.sizes.flip); opened = true; return 0;
	} catch (const std::bad_alloc &) { return NO_MEMORY; } catch (...) { return NATIVE_EXCEPTION; }
}
int raw_decode(uint32_t mode) {
	if (mode != 1 && mode != 3) return UNSUPPORTED_PROFILE;
	if (!opened || !decoder || attempted || output) return BAD_STATE;
	attempted = true; requested_mode = mode;
	try {
		fixed_parameters(mode);
		if (!decoder->supported_layout(false)) return UNSUPPORTED_PROFILE;
		if (!decoder->working_bounds()) return BAD_BOUNDS;
		int status = decoder->unpack(); if (status) return status;
		if (!decoder->supported_layout(true)) return UNSUPPORTED_PROFILE;
		if (!decoder->working_bounds()) return BAD_BOUNDS;
		status = decoder->dcraw_process();
		if (status) { clear_output(); return status; }
		const auto &sizes = decoder->imgdata.sizes;
		const uint32_t width = original_flip & 4u ? sizes.height : sizes.width;
		const uint32_t height = original_flip & 4u ? sizes.width : sizes.height;
		if (!captured || !output || !output_length || !decoder->supported_layout(true)
			|| sizes.flip != int(original_flip) || output_width != width || output_height != height
			|| uint64_t(output_length) != uint64_t(width) * height * 12u) { clear_output(); return BAD_OUTPUT; }
		completed = true; return 0;
	} catch (const NativeFailure &error) { clear_output(); return error.status; }
	catch (const std::bad_alloc &) { clear_output(); return NO_MEMORY; }
	catch (...) { clear_output(); return NATIVE_EXCEPTION; }
}
uint32_t raw_output_ptr() { return completed ? static_cast<uint32_t>(reinterpret_cast<uintptr_t>(output)) : 0; }
uint32_t raw_output_bytes() { return completed ? output_length : 0; }
uint32_t raw_output_width() { return completed ? output_width : 0; }
uint32_t raw_output_height() { return completed ? output_height : 0; }
uint32_t raw_output_channels() { return completed ? 3 : 0; }
uint32_t raw_output_bits() { return completed ? 32 : 0; }
uint32_t raw_flip() { return opened ? original_flip : 0; }
uint32_t raw_highlight_mode() { return completed ? requested_mode : 0; }
double raw_exposure_scale() { return completed ? exposure_scale : 0; }
void raw_destroy() {
	clear_output();
	RecoveryDecoder *retiring = decoder; decoder = nullptr;
	bool failed = false;
	try { delete retiring; } catch (...) { failed = true; }
	if (input) { wipe(input, input_length); std::free(input); input = nullptr; }
	input_length = original_flip = requested_mode = 0;
	opened = attempted = captured = completed = false; exposure_scale = 0;
	// The worker additionally wipes the complete Wasm heap before publishing
	// its owned copy. Cleanup must not hide a native destructor failure.
	if (failed) throw NativeFailure{NATIVE_EXCEPTION};
}
}
