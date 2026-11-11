import os
import subprocess
import sys
import time

import httpx


def test_real_server_console_and_graceful_shutdown(tmp_path):
    import socket

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = {
        **os.environ,
        "SANDBOX_ADMIN_TOKEN": "runtime-test-token-long-enough",
        "PYTHONUTF8": "1",
        "PYTHONUNBUFFERED": "1",
    }
    with (tmp_path / "runtime.log").open("w", encoding="utf-8") as output:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "sandbox_bot",
                "--api-only",
                "--data-dir",
                str(tmp_path / "data"),
                "--port",
                str(port),
            ],
            stdin=subprocess.PIPE,
            stdout=output,
            stderr=output,
            text=True,
            encoding="utf-8",
            env=env,
        )
        try:
            with httpx.Client(
                base_url=f"http://127.0.0.1:{port}",
                timeout=1,
                trust_env=False,
                headers={"Authorization": "Bearer runtime-test-token-long-enough"},
            ) as c:
                deadline = time.monotonic() + 15
                while True:
                    assert process.poll() is None, (tmp_path / "runtime.log").read_text(
                        encoding="utf-8"
                    )
                    try:
                        health = c.get("/api/v1/health")
                        break
                    except (httpx.ConnectError, httpx.ConnectTimeout):
                        if time.monotonic() > deadline:
                            raise
                        time.sleep(0.1)
                assert health.status_code == 200, (health.status_code, health.text)
                assert health.json() == {"ok": True, "telegram_connected": False}
                assert c.get("/api/v1/status").json()["status"] == "online"
                process.stdin.write('enable 42\nprofile 42 name "Марк"\nstatus busy\n')
                process.stdin.flush()
                deadline = time.monotonic() + 5
                while c.get("/api/v1/status").json()["status"] != "busy":
                    assert time.monotonic() < deadline
                    time.sleep(0.05)
                assert c.get("/api/v1/chats/42").json()["name"] == "Марк"
            process.stdin.write("quit\n")
            process.stdin.flush()
            assert process.wait(timeout=10) == 0
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            process.stdin.close()
