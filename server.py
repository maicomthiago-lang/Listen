"""Small local proxy for AudD, keeping the API token out of the browser."""
import os
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder=None)
ROOT = Path(__file__).resolve().parent


@app.get("/")
def home():
    return send_from_directory(ROOT, "index.html")


@app.post("/api/recognize")
def recognize():
    token = os.environ.get("AUDD_API_TOKEN")
    if not token:
        return jsonify(error="Recognition is not configured"), 503
    clip = request.files.get("audio")
    if not clip:
        return jsonify(error="Missing audio sample"), 400
    try:
        response = requests.post(
            "https://api.audd.io/",
            data={"api_token": token, "return": "spotify"},
            files={"file": (clip.filename or "sample.webm", clip.stream, clip.mimetype)},
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("status") != "success":
            return jsonify(error="Recognition provider returned an error"), 502
        song = payload.get("result") or {}
        return jsonify(
            title=song.get("title"),
            artist=song.get("artist"),
            album=song.get("album"),
            release_date=song.get("release_date"),
            links=song.get("song_link"),
        )
    except requests.RequestException:
        return jsonify(error="Recognition provider is unavailable"), 502


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=False)
