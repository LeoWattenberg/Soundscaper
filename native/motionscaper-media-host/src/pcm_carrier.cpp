/* SPDX-License-Identifier: AGPL-3.0-only */
#include "pcm_carrier.hpp"
#include "../../framescaper-media-host/src/strict_json.hpp"
#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <stdexcept>
#include <string_view>
namespace motionscaper::media {
namespace {
namespace json = framescaper::media::json;
constexpr std::string_view magic = "motionscaper-interleaved-pcm-pack-v1\n";
[[noreturn]] void invalid(const std::string_view reason) { throw std::runtime_error("Invalid Motionscaper PCM carrier: " + std::string{reason}); }
void bytes(std::istream& input, char* target, const std::size_t size) { input.read(target, static_cast<std::streamsize>(size)); if (input.gcount() != static_cast<std::streamsize>(size)) invalid("truncated bytes"); }
std::uint32_t word(std::istream& input) { std::array<unsigned char, 4> data{}; bytes(input, reinterpret_cast<char*>(data.data()), data.size()); return data[0] | static_cast<std::uint32_t>(data[1]) << 8U | static_cast<std::uint32_t>(data[2]) << 16U | static_cast<std::uint32_t>(data[3]) << 24U; }
std::uint64_t number(const json::value& value, const std::string_view field) { const auto result = json::integer(json::member(value, field), field); if (result < 0) invalid(field); return static_cast<std::uint64_t>(result); }
void literal(const json::value& value, const std::string_view field, const std::string_view expected) { if (json::string(json::member(value, field), field) != expected) invalid(field); }
}
pcm_carrier::pcm_carrier(std::istream& input, const std::uint64_t authenticated_length, const frame_header& frames) : input_{input} {
	std::string observed(magic.size(), '\0'); bytes(input_, observed.data(), observed.size()); if (observed != magic) invalid("magic");
	const auto length = word(input_); if (length < 1 || length > 65536) invalid("header bound");
	std::string text(length, '\0'); bytes(input_, text.data(), text.size()); const auto value = json::parse(text);
	json::require_exact_keys(value, {"identity", "frameRate", "firstFrame", "frameCount", "sampleRate", "channels", "sampleCount", "format", "version", "sampleFormat"});
	literal(value, "format", "motionscaper-interleaved-pcm-pack"); literal(value, "sampleFormat", "f32le"); if (number(value, "version") != 1) invalid("version");
	const auto& identity = json::member(value, "identity"); json::require_exact_keys(identity, {"projectId", "revisionDigest", "compositionId"});
	literal(identity, "projectId", frames.identity.project_id); literal(identity, "revisionDigest", frames.identity.revision_digest); literal(identity, "compositionId", frames.identity.composition_id);
	const auto& rate = json::member(value, "frameRate"); json::require_exact_keys(rate, {"num", "den"});
	if (number(rate, "num") != frames.rate_num || number(rate, "den") != frames.rate_den || number(value, "firstFrame") != frames.first_frame
		|| number(value, "frameCount") != frames.frame_count || frames.frame_count > 32768) invalid("pinned frame cadence");
	const auto sample_rate = number(value, "sampleRate"); const auto channels = number(value, "channels");
	if (sample_rate < 8000 || sample_rate > 192000 || channels < 1 || channels > 2) invalid("audio format");
	header_ = {static_cast<std::uint32_t>(sample_rate), static_cast<std::uint32_t>(channels), number(value, "sampleCount")};
	const auto numerator = frames.frame_count * sample_rate * frames.rate_den;
	if (header_.sample_count != (numerator + frames.rate_num - 1) / frames.rate_num || header_.sample_count > pcm_maximum_samples) invalid("bounded sample index");
	if (authenticated_length != magic.size() + 4 + length + header_.sample_count * channels * 4) invalid("exact length");
}
std::vector<std::uint8_t> pcm_carrier::read(const std::uint64_t sample_offset) {
	if (sample_offset != next_ || next_ >= header_.sample_count) invalid("sequential sample position");
	const auto count = std::min(pcm_packet_samples, header_.sample_count - next_);
	std::vector<std::uint8_t> result(static_cast<std::size_t>(count * header_.channels * 3));
	for (std::size_t offset = 0; offset < result.size(); offset += 3) {
		const auto value = std::bit_cast<float>(word(input_)); if (!std::isfinite(value)) invalid("finite sample");
		const auto sample = static_cast<std::int32_t>(std::clamp(std::llround(std::clamp(static_cast<double>(value), -1.0, 1.0) * 8388608), -8388608LL, 8388607LL));
		const auto encoded = static_cast<std::uint32_t>(sample);
		for (std::size_t byte = 0; byte < 3; ++byte) result[offset + byte] = static_cast<std::uint8_t>((encoded >> (byte * 8U)) & 255U);
	}
	next_ += count; return result;
}
}
