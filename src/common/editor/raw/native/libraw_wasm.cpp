/* SPDX-License-Identifier: AGPL-3.0-only */

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <new>
#include "libraw/libraw.h"

// One private decoder job per Wasm instance. No filename, filesystem, network,
// caller-supplied processing option or borrowed output allocation crosses ABI1.
namespace {
constexpr uint32_t MAX_INPUT = 64u * 1024u * 1024u;
constexpr uint32_t MAX_PREVIEW = 16u * 1024u * 1024u;
constexpr uint32_t MAX_SIDE = 8192u;
constexpr uint64_t MAX_PIXELS = 16777216u;
constexpr uint64_t MAX_MEMORY = 512u * 1024u * 1024u;
constexpr int BAD_STATE = -100001, BAD_BOUNDS = -100002;
constexpr int NO_MEMORY = -100003, BAD_OUTPUT = -100004, NATIVE_EXCEPTION = -100005;
LibRaw *decoder = nullptr;
unsigned char *input = nullptr;
uint32_t input_length = 0;
libraw_processed_image_t *output = nullptr, *preview = nullptr;
uint32_t preview_width = 0, preview_height = 0, preview_channels = 0, preview_bits = 0;
uint32_t original_flip = 0;
bool opened = false, unpacked = false;

void wipe(void *pointer, size_t bytes) {
	volatile unsigned char *cursor = static_cast<volatile unsigned char *>(pointer);
	while (bytes--) *cursor++ = 0;
}
void clear_image(libraw_processed_image_t *&image) {
	if (!image) return;
	wipe(image->data, image->data_size);
	LibRaw::dcraw_clear_mem(image); image = nullptr;
}
bool dimensions(uint32_t width, uint32_t height) {
	return width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE
		&& uint64_t(width) * height <= MAX_PIXELS;
}
void fixed_parameters() {
	auto &p = decoder->imgdata.params;
	p.output_bps = 16; p.output_color = 1; p.gamm[0] = 1.0; p.gamm[1] = 1.0;
	p.no_auto_bright = 1; p.bright = 1.f; p.user_qual = 3; p.user_flip = -1;
	p.use_auto_wb = 0; p.use_camera_wb = 0; p.no_auto_scale = 0;
	p.output_profile = nullptr; p.camera_profile = nullptr; p.bad_pixels = nullptr; p.dark_frame = nullptr;
	decoder->imgdata.rawparams.max_raw_memory_mb = 256;
	decoder->imgdata.rawparams.use_rawspeed = 0; decoder->imgdata.rawparams.use_dngsdk = 0;
}
bool source_bounds() {
	const auto &s = decoder->imgdata.sizes;
	if (!dimensions(s.raw_width, s.raw_height) || !dimensions(s.width, s.height)) return false;
	// Raw samples, two four-channel processing planes and RGB16 output are
	// charged before unpack; the fixed Wasm memory maximum also bounds native
	// codec/demosaic scratch and rejects allocation exhaustion without fallback.
	return input_length + uint64_t(s.raw_width) * s.raw_height * 18u
		+ uint64_t(s.width) * s.height * 6u <= MAX_MEMORY;
}
bool jpeg_header(const unsigned char *bytes, uint32_t length) {
	if (length < 4 || bytes[0] != 0xff || bytes[1] != 0xd8) return false;
	uint32_t at = 2;
	while (at + 4 <= length) {
		if (bytes[at++] != 0xff) return false;
		while (at < length && bytes[at] == 0xff) ++at;
		if (at >= length) return false;
		const unsigned marker = bytes[at++];
		if (marker == 0xd9 || marker == 0xda) return false;
		if (marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
		if (at + 2 > length) return false;
		const uint32_t size = (uint32_t(bytes[at]) << 8u) | bytes[at + 1];
		if (size < 2 || size > length - at) return false;
		if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
			|| (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
			if (size < 8) return false;
			preview_bits = bytes[at + 2]; preview_height = (uint32_t(bytes[at + 3]) << 8u) | bytes[at + 4];
			preview_width = (uint32_t(bytes[at + 5]) << 8u) | bytes[at + 6]; preview_channels = bytes[at + 7];
			return dimensions(preview_width, preview_height) && preview_bits == 8
				&& (preview_channels == 1 || preview_channels == 3) && size == 8u + 3u * preview_channels;
		}
		at += size;
	}
	return false;
}
} // namespace

extern "C" {
// Emscripten 3.1.64's standalone mktime/localtime_r retain musl's internal
// __secs_to_zone calls, while __tz.c excludes that definition under Emscripten
// in favour of JS timezone services. This decoder has no host timezone authority:
// supply the exact musl hook with deterministic UTC for camera metadata only.
void __secs_to_zone(long long, int, int *isdst, long *offset, long *opposite_offset, const char **zone) {
	static const char utc[] = "UTC";
	if (isdst) *isdst = 0;
	if (offset) *offset = 0;
	if (opposite_offset) *opposite_offset = 0;
	if (zone) *zone = utc;
}
uint32_t raw_abi_version() { return 1; }
uint32_t raw_input_alloc(uint32_t length) {
	if (input || decoder || length == 0 || length > MAX_INPUT) return 0;
	input = static_cast<unsigned char *>(std::calloc(length, 1));
	if (!input) return 0;
	input_length = length; return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(input));
}
int raw_open() {
	if (!input || !input_length || decoder) return BAD_STATE;
	try {
		decoder = new LibRaw(); fixed_parameters();
		const int status = decoder->open_buffer(input, input_length);
		if (status) return status;
		if (!source_bounds()) return BAD_BOUNDS;
		const int flip = decoder->imgdata.sizes.flip;
		if (flip < 0 || flip > 7) return BAD_OUTPUT;
		original_flip = uint32_t(flip); opened = true; return 0;
	} catch (const std::bad_alloc &) { return NO_MEMORY; } catch (...) { return NATIVE_EXCEPTION; }
}
int raw_decode() {
	if (!opened || !decoder || output || unpacked) return BAD_STATE;
	try {
		if (!source_bounds()) return BAD_BOUNDS;
		clear_image(preview); preview_width = preview_height = preview_channels = preview_bits = 0;
		fixed_parameters(); unpacked = true;
		int status = decoder->unpack(); if (status) return status;
		status = decoder->dcraw_process(); if (status) return status;
		int width = 0, height = 0, channels = 0, bits = 0;
		decoder->get_mem_image_format(&width, &height, &channels, &bits);
		if (!dimensions(uint32_t(width), uint32_t(height)) || channels != 3 || bits != 16) return BAD_OUTPUT;
		if (input_length + uint64_t(width) * height * 24u > MAX_MEMORY) return BAD_BOUNDS;
		int error = 0; output = decoder->dcraw_make_mem_image(&error);
		if (!output) return error ? error : NO_MEMORY;
		if (error || output->type != LIBRAW_IMAGE_BITMAP || output->width != width || output->height != height
			|| output->colors != 3 || output->bits != 16 || output->data_size != uint64_t(width) * height * 6u) {
			clear_image(output); return error ? error : BAD_OUTPUT;
		}
		return 0;
	} catch (const std::bad_alloc &) { clear_image(output); return NO_MEMORY; } catch (...) { clear_image(output); return NATIVE_EXCEPTION; }
}
int raw_preview() {
	if (!opened || !decoder || preview || unpacked) return BAD_STATE;
	try {
		const auto &t = decoder->imgdata.thumbnail;
		if (t.tlength > MAX_PREVIEW || (t.twidth && t.theight && !dimensions(t.twidth, t.theight))) return BAD_BOUNDS;
		int status = decoder->unpack_thumb(); if (status) return status;
		if (decoder->imgdata.thumbnail.tlength > MAX_PREVIEW) return BAD_BOUNDS;
		int error = 0; preview = decoder->dcraw_make_mem_thumb(&error);
		if (!preview) return error ? error : NO_MEMORY;
		bool valid = !error && preview->data_size > 0 && preview->data_size <= MAX_PREVIEW;
		if (valid && preview->type == LIBRAW_IMAGE_JPEG) valid = jpeg_header(preview->data, preview->data_size);
		else if (valid && preview->type == LIBRAW_IMAGE_BITMAP) {
			preview_width = preview->width; preview_height = preview->height; preview_channels = preview->colors; preview_bits = preview->bits;
			valid = dimensions(preview_width, preview_height) && (preview_channels == 1 || preview_channels == 3)
				&& (preview_bits == 8 || preview_bits == 16) && preview->data_size == uint64_t(preview_width) * preview_height * preview_channels * (preview_bits / 8u);
		} else valid = false;
		if (!valid) { clear_image(preview); preview_width = preview_height = preview_channels = preview_bits = 0; return error ? error : BAD_OUTPUT; }
		return 0;
	} catch (const std::bad_alloc &) { clear_image(preview); return NO_MEMORY; } catch (...) { clear_image(preview); return NATIVE_EXCEPTION; }
}
uint32_t raw_output_ptr() { return output ? static_cast<uint32_t>(reinterpret_cast<uintptr_t>(output->data)) : 0; }
uint32_t raw_output_bytes() { return output ? output->data_size : 0; }
uint32_t raw_output_width() { return output ? output->width : 0; }
uint32_t raw_output_height() { return output ? output->height : 0; }
uint32_t raw_output_channels() { return output ? output->colors : 0; }
uint32_t raw_output_bits() { return output ? output->bits : 0; }
uint32_t raw_preview_ptr() { return preview ? static_cast<uint32_t>(reinterpret_cast<uintptr_t>(preview->data)) : 0; }
uint32_t raw_preview_bytes() { return preview ? preview->data_size : 0; }
uint32_t raw_preview_type() { return preview ? uint32_t(preview->type) : 0; }
uint32_t raw_preview_width() { return preview ? preview_width : 0; }
uint32_t raw_preview_height() { return preview ? preview_height : 0; }
uint32_t raw_preview_channels() { return preview ? preview_channels : 0; }
uint32_t raw_preview_bits() { return preview ? preview_bits : 0; }
uint32_t raw_flip() { return opened ? original_flip : 0; }
void raw_destroy() {
	// Native internal scratch is reclaimed by LibRaw. The worker must also wipe
	// the complete Wasm memory after this call and before closing its instance.
	clear_image(output); clear_image(preview);
	if (decoder) { delete decoder; decoder = nullptr; }
	if (input) { wipe(input, input_length); std::free(input); input = nullptr; }
	input_length = 0; original_flip = 0; opened = false; unpacked = false;
	preview_width = preview_height = preview_channels = preview_bits = 0;
}
}
