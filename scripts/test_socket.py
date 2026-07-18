"""
WP2 acceptance test for the WebSocket transport (src/api/socket.js), end-to-end
over real WS framing and the real built bundles — no browser required.

Runs a `websockets` server (the role the car-bench PromptDriveClient will play),
launches the headless sim harness (scripts/test-socket-sim.js) which connects
out, then checks: hello handshake, vehicle.set round-trip, read-back, live
vehicleState + tick events, unknown-op error, and reconnect after a server
restart (< 5 s).

Run: python scripts/test_socket.py   (exit 0 = pass). Requires `websockets`.
"""
import asyncio
import json
import os
import subprocess
import sys
import time

import websockets

HOST, PORT = "127.0.0.1", 8765
TOKEN = "test-token-123"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIM = os.path.join(ROOT, "scripts", "test-socket-sim.js")

failures = []


def check(name, cond):
    print(("  ok  : " if cond else "  FAIL: ") + name)
    if not cond:
        failures.append(name)


async def wait_res(state, req_id, timeout=3.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if req_id in state["res"]:
            return state["res"][req_id]
        await asyncio.sleep(0.02)
    return None


async def main():
    state = {"hellos": 0, "events": [], "res": {}, "ws": None, "hello_evt": asyncio.Event()}

    async def handler(ws):
        state["hellos"] += 1
        state["ws"] = ws
        state["hello_evt"].set()
        async for raw in ws:
            try:
                d = json.loads(raw)
            except Exception:
                continue
            if d.get("ns") != "promptdrive":
                continue
            if d.get("kind") == "res":
                state["res"][d["id"]] = d.get("result")
            elif d.get("kind") == "event":
                state["events"].append(d)

    # --- Phase 1: connect, round-trip, events -------------------------------
    server = await websockets.serve(handler, HOST, PORT)
    node = subprocess.Popen(
        ["node", SIM, f"ws://{HOST}:{PORT}", TOKEN],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    try:
        try:
            await asyncio.wait_for(state["hello_evt"].wait(), timeout=15)
        except asyncio.TimeoutError:
            pass
        check("sim connected + sent hello", state["hellos"] >= 1)

        await state["ws"].send(json.dumps({"ns": "promptdrive", "kind": "req", "id": 1,
                                           "op": "vehicle.set", "args": [{"fan_speed": 3}]}))
        res = await wait_res(state, 1)
        check("vehicle.set -> ok", bool(res) and res.get("ok") is True)
        check("vehicle.set changed fan_speed",
              bool(res) and "fan_speed" in (res.get("value", {}) or {}).get("changed", []))

        await state["ws"].send(json.dumps({"ns": "promptdrive", "kind": "req", "id": 2,
                                           "op": "vehicle.get", "args": [["fan_speed"]]}))
        res2 = await wait_res(state, 2)
        check("vehicle.get reflects the set", bool(res2) and (res2.get("value") or {}).get("fan_speed") == 3)

        await state["ws"].send(json.dumps({"ns": "promptdrive", "kind": "req", "id": 3,
                                           "op": "nope.nope", "args": []}))
        res3 = await wait_res(state, 3)
        check("unknown op -> ok:false", bool(res3) and res3.get("ok") is False)

        await asyncio.sleep(2.5)  # let events accumulate
        names = [e.get("event") for e in state["events"]]
        check("vehicleState event received", "vehicleState" in names)
        check("tick event received (~10 Hz)", "tick" in names)

        # --- Phase 2: reconnect after server restart ------------------------
        state["hello_evt"].clear()
        hellos_before = state["hellos"]
        server.close()
        await server.wait_closed()
        await asyncio.sleep(1.0)  # sim's reconnect backoff retries during this gap
        t0 = time.monotonic()
        server2 = await websockets.serve(handler, HOST, PORT)
        try:
            await asyncio.wait_for(state["hello_evt"].wait(), timeout=6)
            dt = time.monotonic() - t0
            check("sim reconnected after server restart", state["hellos"] > hellos_before)
            check(f"reconnect within 5 s (took {dt:.1f}s)", dt < 5.0)
        except asyncio.TimeoutError:
            check("sim reconnected after server restart", False)
        finally:
            server2.close()
            await server2.wait_closed()
    finally:
        node.terminate()
        try:
            out = node.communicate(timeout=5)[0]
        except Exception:
            node.kill()
            out = b""
        if failures and out:
            print("--- sim harness output ---")
            print(out.decode(errors="replace"))

    print("\nALL PASSED" if not failures else f"\n{len(failures)} FAILURE(S)")
    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    asyncio.run(main())
