/* SPDX-License-Identifier: AGPL-3.0-only */

#include <cassert>
#include <cerrno>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

struct AVRational final { int num; int den; };
struct AVCodecContext final { AVRational time_base; };
struct AVStream final { AVRational time_base; int index; };
struct AVFormatContext final {};
struct AVPacket final { int stream_index{}; };

constexpr int AVERROR_EOF = -541478725;
#define AVERROR(error) (-(error))

namespace {
std::vector<std::string> events;
std::vector<int> statuses;
std::size_t next_status{};
int write_status{};
bool allocation_failure{};
int freed{};
int unreferenced{};

void reset(const std::vector<int> next) {
	events.clear(); statuses = next; next_status = 0;
	write_status = 0; allocation_failure = false; freed = 0; unreferenced = 0;
}
}

AVPacket* av_packet_alloc() {
	events.emplace_back("allocate");
	return allocation_failure ? nullptr : new AVPacket{};
}

int avcodec_receive_packet(AVCodecContext*, AVPacket*) {
	events.emplace_back("receive");
	return statuses.at(next_status++);
}

void av_packet_rescale_ts(AVPacket*, AVRational source, AVRational target) {
	assert(source.num == 1 && source.den == 24);
	assert(target.num == 1 && target.den == 1'000);
	events.emplace_back("rescale");
}

int av_interleaved_write_frame(AVFormatContext*, AVPacket* packet) {
	assert(packet->stream_index == 4);
	events.emplace_back("write");
	return write_status;
}

void av_packet_unref(AVPacket*) { ++unreferenced; events.emplace_back("unref"); }
void av_packet_free(AVPacket** packet) {
	++freed; events.emplace_back("free"); delete *packet; *packet = nullptr;
}

#include "ffmpeg_encoded_packet_drain.hpp"

namespace {
struct adapter_error final : std::runtime_error { using std::runtime_error::runtime_error; };

void drain(const bool cancel = false) {
	AVCodecContext codec{{1, 24}};
	AVStream stream{{1, 1'000}, 4};
	AVFormatContext format;
	framescaper::media::drain_encoded_packets(codec, stream, format,
		[cancel]() {
			events.emplace_back("check");
			if (cancel) throw adapter_error("cancelled");
		},
		[](const int status, const std::string_view action) {
			if (status < 0) throw adapter_error(std::string{action});
		},
		[] { throw adapter_error("allocation"); },
		"receive error", "write error");
}
}

int main() {
	reset({0, 0, AVERROR(EAGAIN)});
	drain();
	assert((events == std::vector<std::string>{
		"allocate", "check", "receive", "rescale", "write", "unref",
		"check", "receive", "rescale", "write", "unref", "check", "receive", "free",
	}));
	assert(freed == 1 && unreferenced == 2);

	reset({AVERROR_EOF}); drain();
	assert(freed == 1 && unreferenced == 0);

	reset({}); allocation_failure = true;
	try { drain(); assert(false); } catch (const adapter_error& error) { assert(std::string{error.what()} == "allocation"); }
	assert(freed == 0);

	reset({-42});
	try { drain(); assert(false); } catch (const adapter_error& error) { assert(std::string{error.what()} == "receive error"); }
	assert(freed == 1 && unreferenced == 0);

	reset({0}); write_status = -21;
	try { drain(); assert(false); } catch (const adapter_error& error) { assert(std::string{error.what()} == "write error"); }
	assert(freed == 1 && unreferenced == 0);

	reset({0});
	try { drain(true); assert(false); } catch (const adapter_error& error) { assert(std::string{error.what()} == "cancelled"); }
	assert(freed == 1 && unreferenced == 0 && next_status == 0);
}
