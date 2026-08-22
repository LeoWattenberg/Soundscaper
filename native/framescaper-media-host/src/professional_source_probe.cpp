// SPDX-License-Identifier: AGPL-3.0-only

#include "professional_source_probe.hpp"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/dict.h>
#include <libavutil/display.h>
#include <libavutil/mastering_display_metadata.h>
#include <libavutil/pixdesc.h>
}

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <numeric>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>

namespace framescaper::media {
namespace {

constexpr int maximum_dimension = 65'536;
constexpr int maximum_aspect_term = 1'000'000;
constexpr int maximum_audio_streams = 64;
constexpr int maximum_audio_channels = 64;
constexpr int maximum_audio_sample_rate = 768'000;
constexpr std::int64_t maximum_rational_term = 1'000'000'000;
constexpr unsigned maximum_light_level = 100'000;

struct pixel_facts final {
	std::optional<int> bit_depth;
	std::optional<std::string> pixel_format;
	std::optional<std::string> chroma_format;
	std::optional<bool> has_alpha;
};

[[nodiscard]] bool ascii_alnum(const char value) {
	return (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z')
		|| (value >= '0' && value <= '9');
}

[[nodiscard]] bool base_tag(const std::string_view value) {
	if (value.empty() || value.size() > 64 || !ascii_alnum(value.front())) return false;
	return std::all_of(value.begin() + 1, value.end(), [](const char character) {
		return ascii_alnum(character) || character == ' ' || character == '.'
			|| character == '_' || character == '+' || character == '/'
			|| character == '(' || character == ')' || character == '-';
	});
}

[[nodiscard]] bool professional_tag(const std::string_view value) {
	if (value.empty() || value.size() > 64 || !ascii_alnum(value.front())) return false;
	return std::all_of(value.begin() + 1, value.end(), [](const char character) {
		return ascii_alnum(character) || character == '.' || character == '_'
			|| character == '+' || character == '-';
	});
}

[[nodiscard]] bool language_tag(const std::string_view value) {
	if (value.size() < 2 || value.size() > 30) return false;
	std::size_t position = 0;
	while (position < value.size() && value[position] != '-') {
		const char character = value[position++];
		if (!((character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z'))) return false;
	}
	if (position < 2 || position > 3) return false;
	while (position < value.size()) {
		if (value[position++] != '-') return false;
		const auto start = position;
		while (position < value.size() && value[position] != '-') {
			if (!ascii_alnum(value[position++])) return false;
		}
		if (position - start < 1 || position - start > 8) return false;
	}
	return true;
}

[[nodiscard]] std::string escaped(const std::string_view value) {
	std::string result;
	for (const char character : value) {
		if (character == '\\' || character == '"') result += '\\';
		result += character;
	}
	return result;
}

[[nodiscard]] std::string optional_text(const std::optional<std::string>& value) {
	return value ? "\"" + escaped(*value) + "\"" : "null";
}

[[nodiscard]] std::string optional_integer(const std::optional<int>& value) {
	return value ? std::to_string(*value) : "null";
}

[[nodiscard]] std::string optional_boolean(const std::optional<bool>& value) {
	return value ? (*value ? "true" : "false") : "null";
}

[[nodiscard]] std::optional<std::string> admitted_base_name(const char* value) {
	if (value == nullptr || value == std::string_view{"none"}
		|| value == std::string_view{"unknown_codec"} || !base_tag(value)) return std::nullopt;
	return std::string{value};
}

[[nodiscard]] pixel_facts inspect_pixel_format(const AVCodecParameters& parameters) {
	pixel_facts result;
	const auto format = static_cast<AVPixelFormat>(parameters.format);
	const AVPixFmtDescriptor* descriptor = av_pix_fmt_desc_get(format);
	if (descriptor == nullptr) return result;
	if (descriptor->name != nullptr && professional_tag(descriptor->name)) {
		result.pixel_format = descriptor->name;
	}
	result.has_alpha = (descriptor->flags & AV_PIX_FMT_FLAG_ALPHA) != 0;
	int common_depth = descriptor->nb_components > 0 ? descriptor->comp[0].depth : 0;
	for (std::uint8_t index = 1; index < descriptor->nb_components; ++index) {
		if (descriptor->comp[index].depth != common_depth) common_depth = 0;
	}
	if (parameters.bits_per_raw_sample > 0) common_depth = parameters.bits_per_raw_sample;
	if (common_depth == 8 || common_depth == 10 || common_depth == 12
		|| common_depth == 16 || common_depth == 32) {
		result.bit_depth = common_depth;
	}
	if ((descriptor->flags & AV_PIX_FMT_FLAG_RGB) != 0) result.chroma_format = "4:4:4";
	else if (descriptor->nb_components <= 2 && (descriptor->flags & AV_PIX_FMT_FLAG_PAL) == 0) {
		result.chroma_format = "4:0:0";
	} else if (descriptor->nb_components >= 3) {
		if (descriptor->log2_chroma_w == 0 && descriptor->log2_chroma_h == 0) {
			result.chroma_format = "4:4:4";
		} else if (descriptor->log2_chroma_w == 1 && descriptor->log2_chroma_h == 0) {
			result.chroma_format = "4:2:2";
		} else if (descriptor->log2_chroma_w == 1 && descriptor->log2_chroma_h == 1) {
			result.chroma_format = "4:2:0";
		}
	}
	return result;
}

[[nodiscard]] std::optional<std::string> field_order(const AVFieldOrder value) {
	if (value == AV_FIELD_PROGRESSIVE) return "progressive";
	if (value == AV_FIELD_TT || value == AV_FIELD_BT) return "top-field-first";
	if (value == AV_FIELD_BB || value == AV_FIELD_TB) return "bottom-field-first";
	return std::nullopt;
}

[[nodiscard]] std::optional<std::string> colour_name(
	const char* value,
	const bool specified
) {
	if (!specified || value == nullptr || value == std::string_view{"unknown"}
		|| value == std::string_view{"reserved"} || !base_tag(value)) return std::nullopt;
	return std::string{value};
}

[[nodiscard]] std::optional<std::string> colour_range(const AVColorRange value) {
	if (value == AVCOL_RANGE_MPEG) return "limited";
	if (value == AVCOL_RANGE_JPEG) return "full";
	return std::nullopt;
}

[[nodiscard]] const AVPacketSideData* side_data(
	const AVCodecParameters& parameters,
	const AVPacketSideDataType type
) {
	return av_packet_side_data_get(
		parameters.coded_side_data, parameters.nb_coded_side_data, type
	);
}

[[nodiscard]] std::optional<int> rotation(const AVCodecParameters& parameters) {
	const auto* data = side_data(parameters, AV_PKT_DATA_DISPLAYMATRIX);
	if (data == nullptr || data->size != sizeof(std::int32_t) * 9U) return std::nullopt;
	std::array<std::int32_t, 9> matrix{};
	std::memcpy(matrix.data(), data->data, data->size);
	const double angle = av_display_rotation_get(matrix.data());
	if (!std::isfinite(angle)) return std::nullopt;
	const double clockwise = std::fmod(-angle + 360.0, 360.0);
	const int rounded = static_cast<int>(std::lround(clockwise)) % 360;
	if (std::abs(clockwise - static_cast<double>(rounded)) > 0.000001
		|| (rounded != 0 && rounded != 90 && rounded != 180 && rounded != 270)) {
		return std::nullopt;
	}
	return rounded;
}

[[nodiscard]] bool bounded_rational(const AVRational value) {
	return value.num >= 0 && value.den > 0
		&& value.num <= maximum_rational_term && value.den <= maximum_rational_term;
}

[[nodiscard]] std::string rational_json(const AVRational value) {
	return "{\"num\":" + std::to_string(value.num) + ",\"den\":"
		+ std::to_string(value.den) + '}';
}

[[nodiscard]] std::string chromaticity_json(const AVRational (&value)[2]) {
	return "{\"x\":" + rational_json(value[0]) + ",\"y\":" + rational_json(value[1]) + '}';
}

[[nodiscard]] std::string mastering_display_json(const AVCodecParameters& parameters) {
	const auto* data = side_data(parameters, AV_PKT_DATA_MASTERING_DISPLAY_METADATA);
	if (data == nullptr || data->size < sizeof(AVMasteringDisplayMetadata)) return "null";
	AVMasteringDisplayMetadata metadata{};
	std::memcpy(&metadata, data->data, sizeof(metadata));
	if (metadata.has_primaries == 0 || metadata.has_luminance == 0
		|| !bounded_rational(metadata.display_primaries[0][0])
		|| !bounded_rational(metadata.display_primaries[0][1])
		|| !bounded_rational(metadata.display_primaries[1][0])
		|| !bounded_rational(metadata.display_primaries[1][1])
		|| !bounded_rational(metadata.display_primaries[2][0])
		|| !bounded_rational(metadata.display_primaries[2][1])
		|| !bounded_rational(metadata.white_point[0]) || !bounded_rational(metadata.white_point[1])
		|| !bounded_rational(metadata.min_luminance) || !bounded_rational(metadata.max_luminance)
		|| static_cast<std::int64_t>(metadata.min_luminance.num) * metadata.max_luminance.den
			> static_cast<std::int64_t>(metadata.max_luminance.num) * metadata.min_luminance.den) {
		return "null";
	}
	return "{\"redPrimary\":" + chromaticity_json(metadata.display_primaries[0])
		+ ",\"greenPrimary\":" + chromaticity_json(metadata.display_primaries[1])
		+ ",\"bluePrimary\":" + chromaticity_json(metadata.display_primaries[2])
		+ ",\"whitePoint\":" + chromaticity_json(metadata.white_point)
		+ ",\"minimumLuminance\":" + rational_json(metadata.min_luminance)
		+ ",\"maximumLuminance\":" + rational_json(metadata.max_luminance) + '}';
}

[[nodiscard]] std::string content_light_json(const AVCodecParameters& parameters) {
	const auto* data = side_data(parameters, AV_PKT_DATA_CONTENT_LIGHT_LEVEL);
	if (data == nullptr || data->size < sizeof(AVContentLightMetadata)) return "null";
	AVContentLightMetadata metadata{};
	std::memcpy(&metadata, data->data, sizeof(metadata));
	if (metadata.MaxCLL > maximum_light_level || metadata.MaxFALL > metadata.MaxCLL) return "null";
	return "{\"maximumContentLightLevel\":" + std::to_string(metadata.MaxCLL)
		+ ",\"maximumFrameAverageLightLevel\":" + std::to_string(metadata.MaxFALL) + '}';
}

[[nodiscard]] std::string aspect_ratio_json(const AVRational value) {
	if (value.num <= 0 || value.den <= 0 || value.num > maximum_aspect_term
		|| value.den > maximum_aspect_term) return "null";
	const auto divisor = std::gcd(value.num, value.den);
	return "{\"num\":" + std::to_string(value.num / divisor) + ",\"den\":"
		+ std::to_string(value.den / divisor) + '}';
}

[[nodiscard]] std::string alpha_mode(
	const AVCodecParameters& parameters,
	const std::optional<bool> has_alpha
) {
	if (has_alpha != true) return "null";
	if (parameters.alpha_mode == AVALPHA_MODE_STRAIGHT) return "\"straight\"";
	if (parameters.alpha_mode == AVALPHA_MODE_PREMULTIPLIED) return "\"premultiplied\"";
	return "null";
}

[[nodiscard]] std::string audio_streams_json(const AVFormatContext& format) {
	std::ostringstream output;
	output << '[';
	int count = 0;
	for (unsigned index = 0; index < format.nb_streams; ++index) {
		const AVStream* stream = format.streams[index];
		if (stream == nullptr || stream->codecpar == nullptr
			|| stream->codecpar->codec_type != AVMEDIA_TYPE_AUDIO) continue;
		if (++count > maximum_audio_streams || stream->index < 0
			|| stream->index > maximum_audio_streams) return "null";
		if (count > 1) output << ',';
		const AVCodecParameters& parameters = *stream->codecpar;
		const auto codec = admitted_base_name(avcodec_get_name(parameters.codec_id));
		const auto channels = parameters.ch_layout.nb_channels > 0
			&& parameters.ch_layout.nb_channels <= maximum_audio_channels
			? std::optional<int>{parameters.ch_layout.nb_channels} : std::nullopt;
		const auto sample_rate = parameters.sample_rate > 0
			&& parameters.sample_rate <= maximum_audio_sample_rate
			? std::optional<int>{parameters.sample_rate} : std::nullopt;
		std::optional<std::string> language;
		const AVDictionaryEntry* entry = av_dict_get(stream->metadata, "language", nullptr, 0);
		if (entry != nullptr && entry->value != nullptr && entry->value != std::string_view{"und"}
			&& language_tag(entry->value)) language = entry->value;
		output << "{\"index\":" << stream->index << ",\"codec\":" << optional_text(codec)
			<< ",\"channelCount\":" << optional_integer(channels)
			<< ",\"sampleRate\":" << optional_integer(sample_rate)
			<< ",\"language\":" << optional_text(language) << '}';
	}
	output << ']';
	return output.str();
}

[[nodiscard]] bool attach_side_data(
	AVCodecParameters& parameters,
	const AVPacketSideDataType type,
	const void* value,
	const std::size_t size
) {
	AVPacketSideData* data = av_packet_side_data_new(
		&parameters.coded_side_data, &parameters.nb_coded_side_data, type, size, 0
	);
	if (data == nullptr) return false;
	std::memcpy(data->data, value, size);
	return true;
}

} // namespace

std::string professional_source_characteristics_json(
	const AVFormatContext& format,
	const int video_stream_index
) {
	if (video_stream_index < 0 || static_cast<unsigned>(video_stream_index) >= format.nb_streams
		|| format.streams[video_stream_index] == nullptr
		|| format.streams[video_stream_index]->codecpar == nullptr) return "null";
	const AVCodecParameters& parameters = *format.streams[video_stream_index]->codecpar;
	const auto pixels = inspect_pixel_format(parameters);
	const bool bounded_geometry = parameters.width > 0 && parameters.width <= maximum_dimension
		&& parameters.height > 0 && parameters.height <= maximum_dimension;
	const auto codec = admitted_base_name(avcodec_get_name(parameters.codec_id));
	const auto primaries = colour_name(
		av_color_primaries_name(parameters.color_primaries),
		parameters.color_primaries != AVCOL_PRI_UNSPECIFIED
	);
	const auto transfer = colour_name(
		av_color_transfer_name(parameters.color_trc),
		parameters.color_trc != AVCOL_TRC_UNSPECIFIED
	);
	const auto matrix = colour_name(
		av_color_space_name(parameters.color_space),
		parameters.color_space != AVCOL_SPC_UNSPECIFIED
	);
	const auto fields = field_order(parameters.field_order);
	const auto rotated = rotation(parameters);
	std::ostringstream output;
	output << "{\"backend\":\"framescaper-media-host\",\"codedWidth\":"
		<< (bounded_geometry ? std::to_string(parameters.width) : "null")
		<< ",\"codedHeight\":" << (bounded_geometry ? std::to_string(parameters.height) : "null")
		<< ",\"rotationDegrees\":" << optional_integer(rotated)
		<< ",\"pixelAspectRatio\":" << aspect_ratio_json(parameters.sample_aspect_ratio)
		<< ",\"fieldOrder\":" << optional_text(fields)
		<< ",\"hasAlpha\":" << optional_boolean(pixels.has_alpha)
		<< ",\"videoCodec\":" << optional_text(codec)
		<< ",\"colour\":{\"primaries\":" << optional_text(primaries)
		<< ",\"transfer\":" << optional_text(transfer)
		<< ",\"matrix\":" << optional_text(matrix)
		<< ",\"range\":" << optional_text(colour_range(parameters.color_range))
		<< ",\"masteringDisplay\":" << mastering_display_json(parameters)
		<< ",\"contentLight\":" << content_light_json(parameters) << '}'
		<< ",\"audioStreams\":" << audio_streams_json(format)
		<< ",\"extractedAudioStreamIndex\":null,\"startTimecode\":null"
		<< ",\"bitDepth\":" << optional_integer(pixels.bit_depth)
		<< ",\"pixelFormat\":" << optional_text(pixels.pixel_format)
		<< ",\"chromaFormat\":" << optional_text(pixels.chroma_format)
		<< ",\"alphaMode\":" << alpha_mode(parameters, pixels.has_alpha)
		<< ",\"alphaInterpretation\":null}";
	return output.str();
}

bool professional_source_characteristics_self_test() {
	AVFormatContext* format = avformat_alloc_context();
	if (format == nullptr) return false;
	AVStream* video = avformat_new_stream(format, nullptr);
	AVStream* audio = avformat_new_stream(format, nullptr);
	if (video == nullptr || audio == nullptr) { avformat_free_context(format); return false; }
	video->codecpar->codec_type = AVMEDIA_TYPE_VIDEO;
	video->codecpar->codec_id = AV_CODEC_ID_PRORES;
	video->codecpar->width = 3840;
	video->codecpar->height = 2160;
	video->codecpar->sample_aspect_ratio = AVRational{1, 1};
	video->codecpar->field_order = AV_FIELD_PROGRESSIVE;
	video->codecpar->color_range = AVCOL_RANGE_MPEG;
	video->codecpar->color_primaries = AVCOL_PRI_BT2020;
	video->codecpar->color_trc = AVCOL_TRC_SMPTE2084;
	video->codecpar->color_space = AVCOL_SPC_BT2020_NCL;
	video->codecpar->format = AV_PIX_FMT_YUVA444P10LE;
	video->codecpar->alpha_mode = AVALPHA_MODE_STRAIGHT;
	AVMasteringDisplayMetadata mastering{};
	mastering.display_primaries[0][0] = AVRational{34'000, 50'000};
	mastering.display_primaries[0][1] = AVRational{16'000, 50'000};
	mastering.display_primaries[1][0] = AVRational{13'250, 50'000};
	mastering.display_primaries[1][1] = AVRational{34'500, 50'000};
	mastering.display_primaries[2][0] = AVRational{7'500, 50'000};
	mastering.display_primaries[2][1] = AVRational{3'000, 50'000};
	mastering.white_point[0] = AVRational{15'635, 50'000};
	mastering.white_point[1] = AVRational{16'450, 50'000};
	mastering.min_luminance = AVRational{50, 10'000};
	mastering.max_luminance = AVRational{10'000'000, 10'000};
	mastering.has_primaries = 1;
	mastering.has_luminance = 1;
	const AVContentLightMetadata content{1'000, 400};
	audio->codecpar->codec_type = AVMEDIA_TYPE_AUDIO;
	audio->codecpar->codec_id = AV_CODEC_ID_AAC;
	av_channel_layout_default(&audio->codecpar->ch_layout, 2);
	audio->codecpar->sample_rate = 48'000;
	const bool prepared = av_dict_set(&audio->metadata, "language", "eng", 0) >= 0
		&& attach_side_data(*video->codecpar, AV_PKT_DATA_MASTERING_DISPLAY_METADATA,
			&mastering, sizeof(mastering))
		&& attach_side_data(*video->codecpar, AV_PKT_DATA_CONTENT_LIGHT_LEVEL, &content, sizeof(content));
	const std::string expected =
		"{\"backend\":\"framescaper-media-host\",\"codedWidth\":3840,\"codedHeight\":2160,"
		"\"rotationDegrees\":null,\"pixelAspectRatio\":{\"num\":1,\"den\":1},"
		"\"fieldOrder\":\"progressive\",\"hasAlpha\":true,\"videoCodec\":\"prores\","
		"\"colour\":{\"primaries\":\"bt2020\",\"transfer\":\"smpte2084\","
		"\"matrix\":\"bt2020nc\",\"range\":\"limited\",\"masteringDisplay\":{"
		"\"redPrimary\":{\"x\":{\"num\":34000,\"den\":50000},\"y\":{\"num\":16000,\"den\":50000}},"
		"\"greenPrimary\":{\"x\":{\"num\":13250,\"den\":50000},\"y\":{\"num\":34500,\"den\":50000}},"
		"\"bluePrimary\":{\"x\":{\"num\":7500,\"den\":50000},\"y\":{\"num\":3000,\"den\":50000}},"
		"\"whitePoint\":{\"x\":{\"num\":15635,\"den\":50000},\"y\":{\"num\":16450,\"den\":50000}},"
		"\"minimumLuminance\":{\"num\":50,\"den\":10000},"
		"\"maximumLuminance\":{\"num\":10000000,\"den\":10000}},"
		"\"contentLight\":{\"maximumContentLightLevel\":1000,\"maximumFrameAverageLightLevel\":400}},"
		"\"audioStreams\":[{\"index\":1,\"codec\":\"aac\",\"channelCount\":2,"
		"\"sampleRate\":48000,\"language\":\"eng\"}],\"extractedAudioStreamIndex\":null,"
		"\"startTimecode\":null,\"bitDepth\":10,\"pixelFormat\":\"yuva444p10le\","
		"\"chromaFormat\":\"4:4:4\",\"alphaMode\":\"straight\",\"alphaInterpretation\":null}";
	const bool matched = prepared
		&& professional_source_characteristics_json(*format, video->index) == expected;
	avformat_free_context(format);
	return matched;
}

} // namespace framescaper::media
