#!/usr/bin/env python3
"""Quick check: connect, send WAV + process (or done), expect at least one JSON message within 5s."""
import asyncio
import json
import struct
import sys

try:
    import websockets
except ImportError:
    print("Install: pip install websockets")
    sys.exit(1)


def make_minimal_wav(sample_count: int = 1600) -> bytes:
    sample_rate = 16000
    num_channels = 1
    bits_per_sample = 16
    block_align = num_channels * (bits_per_sample // 8)
    byte_rate = sample_rate * block_align
    data_size = sample_count * block_align
    header = (
        b"RIFF"
        + struct.pack("<I", 36 + data_size)
        + b"WAVE"
        + b"fmt "
        + struct.pack("<IHHIIHH", 16, 1, num_channels, sample_rate, byte_rate, block_align, bits_per_sample)
        + b"data"
        + struct.pack("<I", data_size)
    )
    samples = b"\x00" * data_size
    return header + samples


async def main(ws_url: str = "ws://localhost:8000/ws/audio") -> None:
    print(f"Connect {ws_url} -> send WAV -> send done -> wait 5s for first message ...")
    try:
        async with websockets.connect(ws_url, close_timeout=3) as ws:
            wav = make_minimal_wav()
            await ws.send(wav)
            await ws.send(json.dumps({"done": True}))
            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
            if isinstance(msg, bytes):
                print("OK: received binary (ignored)")
            else:
                data = json.loads(msg)
                print("OK: received JSON:", json.dumps(data, indent=2)[:500])
            return
    except asyncio.TimeoutError:
        print("FAIL: no message from backend within 5s")
        sys.exit(1)
    except Exception as e:
        print("FAIL:", e)
        sys.exit(1)


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "ws://localhost:8000/ws/audio"
    asyncio.run(main(url))
