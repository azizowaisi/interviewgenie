#!/usr/bin/env python3
"""End-to-end test: connect to ws/audio, send minimal WAV + done, expect STAR JSON."""
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
    """Minimal valid WAV: 16 kHz mono 16-bit (0.1 sec silence)."""
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


async def run_test(ws_url: str = "ws://localhost:8000/ws/audio") -> None:
    print(f"Connecting to {ws_url} ...")
    async with websockets.connect(ws_url, close_timeout=5) as ws:
        print("Sending minimal WAV + done ...")
        wav = make_minimal_wav()
        await ws.send(wav)
        await ws.send(json.dumps({"done": True}))
        print("Waiting for response ...")
        while True:
            msg = await asyncio.wait_for(ws.recv(), timeout=200.0)
            if isinstance(msg, bytes):
                continue
            data = json.loads(msg)
            if "error" in data or "situation" in data:
                response = msg
                break
            if data.get("status") == "processing":
                print("  (processing ...)")
                continue
    data = json.loads(response)
    if "error" in data:
        print(f"ERROR: {data['error']}")
        sys.exit(1)
    if "situation" in data:
        print("STAR answer received:")
        for key in ("situation", "task", "action", "result"):
            val = data.get(key, "")
            print(f"  {key}: {val[:80]}{'...' if len(val) > 80 else ''}")
        print("\nFull app test: PASSED")
    else:
        print("Unexpected response:", data)
        sys.exit(1)


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "ws://localhost:8000/ws/audio"
    asyncio.run(run_test(url))
