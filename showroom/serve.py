"""Open the local showroom using its Node server and persistent dealer profile."""
from pathlib import Path
import os
import subprocess
import threading
import webbrowser

root = Path(__file__).resolve().parent
env = {**os.environ, "SHOWROOM_DATA": str(root / ".local-state"), "PORT": "8184", "BIND_ADDRESS": "127.0.0.1"}
if __name__ == "__main__":
    timer = threading.Timer(1, webbrowser.open, args=["http://127.0.0.1:8184/"])
    timer.start()
    try:
        subprocess.run(["node", "worker/node-server.mjs"], cwd=root, env=env, check=True)
    except KeyboardInterrupt:
        pass
    finally:
        timer.cancel()
