/* SPDX-License-Identifier: AGPL-3.0-only */
// Test-only sustained reference. Never shipped, linked or admitted to the app helper inventory.
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/pixdesc.h>
#include <libavutil/mem.h>
#include <libswscale/swscale.h>
}
#include <cstdint>
#include <bit>
#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
namespace {
void require(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
struct input {
	AVFormatContext* format{}; AVIOContext* io{}; AVPacket* packet{}; AVCodecContext* codec{}; AVFrame* frame{};
	std::ifstream source; std::int64_t size{}; int maximum_read{};
	~input() { av_packet_free(&packet); av_frame_free(&frame); avcodec_free_context(&codec); avformat_close_input(&format); if (io) av_freep(&io->buffer); avio_context_free(&io); }
	static int read(void* opaque, std::uint8_t* bytes, int requested) {
		auto& self = *static_cast<input*>(opaque); const int count = std::min(requested, 65536);
		if (count <= 0) return AVERROR(EINVAL);
		self.source.read(reinterpret_cast<char*>(bytes), count); const auto actual = self.source.gcount();
		self.maximum_read = std::max(self.maximum_read, static_cast<int>(actual));
		return actual > 0 ? static_cast<int>(actual) : self.source.eof() ? AVERROR_EOF : AVERROR(EIO);
	}
	static std::int64_t seek(void* opaque, std::int64_t offset, int whence) {
		auto& self = *static_cast<input*>(opaque); if (whence == AVSEEK_SIZE) return self.size;
		whence &= ~AVSEEK_FORCE;
		if (whence != SEEK_SET && whence != SEEK_CUR && whence != SEEK_END) return AVERROR(EINVAL);
		self.source.clear(); self.source.seekg(offset, whence == SEEK_SET ? std::ios::beg : whence == SEEK_CUR ? std::ios::cur : std::ios::end);
		const auto position = self.source.tellg(); return position >= 0 ? static_cast<std::int64_t>(position) : AVERROR(EIO);
	}
	void open(const char* path) {
		source.open(path, std::ios::binary); require(bool(source), "Reference input missing");
		source.seekg(0, std::ios::end); size = source.tellg(); source.seekg(0);
		require(size > 0 && size <= 512 * 1024 * 1024, "Reference input exceeds 512 MiB admission");
		auto* buffer = static_cast<std::uint8_t*>(av_malloc(65536)); require(buffer, "I/O window allocation failed");
		io = avio_alloc_context(buffer, 65536, 0, this, read, nullptr, seek);
		if (!io) { av_free(buffer); throw std::runtime_error("Reference I/O allocation failed"); }
		format = avformat_alloc_context(); require(format, "Reference format allocation failed"); format->pb = io; format->flags |= AVFMT_FLAG_CUSTOM_IO;
		require(avformat_open_input(&format, nullptr, nullptr, nullptr) >= 0 && avformat_find_stream_info(format, nullptr) >= 0, "Movie open failed");
	}
};
}
int main(int argc, char** argv) {
	try {
		require(argc == 5, "Expected movie, selected RGBA path, PCM path and 300/1200 frame count");
		const std::string count(argv[4]); require(count == "300" || count == "1200", "Unknown sustained duration");
		const int expected = count == "300" ? 300 : 1200;
		require(std::endian::native == std::endian::little, "Reference float/alpha output requires little endian host");
		input file; file.open(argv[1]);
		require(file.format->nb_streams == 2, "Sustained movie must retain picture and audio");
		const int vi = av_find_best_stream(file.format, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0);
		const int ai = av_find_best_stream(file.format, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
		require(vi >= 0 && ai >= 0, "Missing sustained picture/audio stream");
		auto* video = file.format->streams[vi]; auto* vp = video->codecpar;
		auto* audio = file.format->streams[ai]; auto* ap = audio->codecpar;
		require(video->time_base.num > 0 && video->time_base.den > 0 && audio->time_base.num > 0 && audio->time_base.den > 0, "Invalid positive stream time base");
		require(vp->codec_id == AV_CODEC_ID_PRORES && vp->profile == AV_PROFILE_PRORES_4444 && vp->width == 160 && vp->height == 90, "Unexpected picture codec/geometry");
		require(vp->color_primaries == AVCOL_PRI_BT709 && vp->color_trc == AVCOL_TRC_BT709 && vp->color_space == AVCOL_SPC_BT709, "Unexpected color tags");
		require(ap->codec_id == AV_CODEC_ID_PCM_S24LE && ap->sample_rate == 48000 && ap->ch_layout.nb_channels == 2, "Unexpected PCM contract");
		file.codec = avcodec_alloc_context3(avcodec_find_decoder(vp->codec_id)); require(file.codec, "Decoder missing");
		file.codec->thread_count = 1;
		require(avcodec_parameters_to_context(file.codec, vp) >= 0 && avcodec_open2(file.codec, nullptr, nullptr) >= 0, "Decoder open failed");
		file.frame = av_frame_alloc(); file.packet = av_packet_alloc(); require(file.frame && file.packet, "Reference allocation failed");
		std::ofstream rgba(argv[2], std::ios::binary | std::ios::trunc), pcm(argv[3], std::ios::binary | std::ios::trunc);
		require(rgba && pcm, "Reference output unavailable");
		int frames = 0, selected = 0, color_depth = 0, alpha_depth = 0, maximum_packet = 0; std::int64_t samples = 0;
		const auto picture = [&]() {
			auto& f = *file.frame;
			require(frames < expected && f.width == 160 && f.height == 90, "Picture count/geometry exceeded");
			require(f.best_effort_timestamp >= 0 && static_cast<__int128>(f.best_effort_timestamp) * video->time_base.num * 30 == static_cast<__int128>(frames) * video->time_base.den, "Non-exact picture timestamp");
			const auto* desc = av_pix_fmt_desc_get(static_cast<AVPixelFormat>(f.format));
			require(desc && desc->nb_components == 4 && (desc->flags & AV_PIX_FMT_FLAG_PLANAR) && !(desc->flags & AV_PIX_FMT_FLAG_BE)
				&& desc->comp[0].depth >= 10 && desc->comp[0].depth <= 16 && desc->comp[3].depth >= 10 && desc->comp[3].depth <= 16
				&& desc->comp[3].plane == 3 && desc->comp[3].step == 2 && desc->comp[3].offset == 0 && desc->comp[3].shift == 0
				&& f.data[3] && f.linesize[3] >= 160 * 2, "Missing admitted planar high precision color/alpha");
			color_depth = desc->comp[0].depth; alpha_depth = desc->comp[3].depth;
			if (frames == 0 || frames == expected / 2 || frames == expected - 1) {
				auto* sws = sws_getContext(160, 90, static_cast<AVPixelFormat>(f.format), 160, 90, AV_PIX_FMT_RGBA64, SWS_POINT | SWS_ACCURATE_RND | SWS_BITEXACT, nullptr, nullptr, nullptr);
				require(sws, "Reference converter unavailable"); const auto* matrix = sws_getCoefficients(SWS_CS_ITU709);
				const int configured = sws_setColorspaceDetails(sws, matrix, 0, matrix, 1, 0, 1 << 16, 1 << 16);
				if (configured < 0) { sws_freeContext(sws); throw std::runtime_error("Reference matrix unavailable"); }
				std::vector<std::uint16_t> pixels(160 * 90 * 4);
				std::uint8_t* output[] = {reinterpret_cast<std::uint8_t*>(pixels.data()), nullptr, nullptr, nullptr}; const int stride[] = {160 * 8, 0, 0, 0};
				const int rows = sws_scale(sws, f.data, f.linesize, 0, 90, output, stride); sws_freeContext(sws); require(rows == 90, "Incomplete reference picture");
				std::vector<float> row(160 * 4);
				for (int y = 0; y < 90; ++y) {
					const auto* alpha = reinterpret_cast<const std::uint16_t*>(f.data[3] + y * f.linesize[3]);
					for (int x = 0; x < 160; ++x) {
						for (int c = 0; c < 3; ++c) row[x * 4 + c] = pixels[(y * 160 + x) * 4 + c] / 65535.0F;
						row[x * 4 + 3] = alpha[x] / static_cast<float>((1U << alpha_depth) - 1);
					}
					rgba.write(reinterpret_cast<const char*>(row.data()), static_cast<std::streamsize>(row.size() * sizeof(float)));
				}
				require(bool(rgba), "Selected picture write failed"); ++selected;
			}
			++frames;
		};
		const auto sound = [&](const AVPacket& p) {
			require(p.size > 0 && p.size <= 65536 && p.size % 6 == 0, "PCM packet exceeds bounded read window");
			const int count_samples = p.size / 6;
			require(samples + count_samples <= static_cast<std::int64_t>(expected) * 1600, "PCM sample admission exceeded");
			require(p.pts >= 0 && static_cast<__int128>(p.pts) * audio->time_base.num * 48000 == static_cast<__int128>(samples) * audio->time_base.den, "PCM timestamps are not exact/contiguous");
			for (int offset = 0; offset < p.size; offset += 3) {
				const auto* bytes = p.data + offset; auto value = static_cast<std::int32_t>(bytes[0] | bytes[1] << 8 | bytes[2] << 16);
				if (value & 0x800000) value -= 0x1000000;
				const float scalar = static_cast<float>(value / 8388608.0); pcm.write(reinterpret_cast<const char*>(&scalar), sizeof(scalar));
			}
			require(bool(pcm), "PCM reference write failed"); samples += count_samples;
		};
		const auto drain = [&]() { int result; while ((result = avcodec_receive_frame(file.codec, file.frame)) >= 0) { picture(); av_frame_unref(file.frame); }
			require(result == AVERROR(EAGAIN) || result == AVERROR_EOF, "Reference decode failed"); };
		int result;
		while ((result = av_read_frame(file.format, file.packet)) >= 0) {
			auto& p = *file.packet; require(p.stream_index == vi || p.stream_index == ai, "Unexpected movie stream");
			require(p.size > 0 && p.size <= 1024 * 1024, "Demuxed packet exceeds one MiB before decode"); maximum_packet = std::max(maximum_packet, p.size);
			if (p.stream_index == vi) { require(avcodec_send_packet(file.codec, &p) >= 0, "Video packet refused"); drain(); } else sound(p);
			av_packet_unref(file.packet);
		}
		require(result == AVERROR_EOF, "Reference input read failed"); require(avcodec_send_packet(file.codec, nullptr) >= 0, "Video flush failed"); drain();
		require(frames == expected && selected == 3 && samples == static_cast<std::int64_t>(expected) * 1600, "Incomplete output");
		rgba.close(); pcm.close(); require(bool(rgba) && bool(pcm), "Reference close failed");
		std::cout << "{\"width\":160,\"height\":90,\"frameCount\":" << frames << ",\"selectedFrames\":[0," << frames / 2 << ',' << frames - 1
			<< "],\"firstTimestamp\":{\"num\":0,\"den\":30},\"lastTimestamp\":{\"num\":" << frames - 1
			<< ",\"den\":30},\"contiguousFrameTimes\":true,\"profile\":4,\"colorDepth\":" << color_depth << ",\"alphaDepth\":" << alpha_depth
			<< ",\"colorPrimaries\":1,\"colorTransfer\":1,\"colorSpace\":1,\"maximumReadBytes\":" << file.maximum_read << ",\"maximumPacketBytes\":" << maximum_packet
			<< ",\"audio\":{\"sampleRate\":48000,\"channels\":2,\"sampleCount\":" << samples << ",\"contiguous\":true}}\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
