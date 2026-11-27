"""Local Flask proxy for AudD music recognition, keeping the API token on the server."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import requests
from flask import Flask, Response, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent
AUDD_ENDPOINT = "https://api.audd.io/"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
AUDD_TIMEOUT_SECONDS = 20


def load_dotenv(env_path: Path | None = None) -> None:
    """Load key=value pairs from a local .env file without overriding existing env vars."""
    path = env_path or (ROOT / ".env")
    if not path.is_file():
        return
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            if key:
                os.environ.setdefault(key, value)
    except OSError:
        pass


load_dotenv()

app = Flask(__name__, static_folder=str(ROOT / "static"), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES


def _extract_song_payload(song: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize AudD recognition response into a consistent JSON payload."""
    if not song:
        return {
            "found": False,
            "title": None,
            "artist": None,
            "album": None,
            "release_date": None,
            "label": None,
            "timecode": None,
            "links": None,
            "spotify_url": None,
            "apple_music_url": None,
            "cover_url": None,
            "preview_url": None,
            "duration_ms": None,
        }

    spotify = song.get("spotify") or {}
    spotify_album = spotify.get("album") or {}
    spotify_images = spotify_album.get("images") or []
    spotify_cover = spotify_images[0].get("url") if spotify_images and isinstance(spotify_images[0], dict) else None
    spotify_url = (spotify.get("external_urls") or {}).get("spotify")

    apple_music = song.get("apple_music") or {}
    apple_artwork = (apple_music.get("artwork") or {}).get("url")
    if isinstance(apple_artwork, str):
        apple_artwork = apple_artwork.replace("{w}", "300").replace("{h}", "300")
    apple_music_url = apple_music.get("url")
    apple_previews = apple_music.get("previews") or []
    apple_preview = apple_previews[0].get("url") if apple_previews and isinstance(apple_previews[0], dict) else None

    return {
        "found": bool(song.get("title")),
        "title": song.get("title"),
        "artist": song.get("artist"),
        "album": song.get("album") or spotify_album.get("name"),
        "release_date": song.get("release_date") or spotify_album.get("release_date"),
        "label": song.get("label"),
        "timecode": song.get("timecode"),
        "links": song.get("song_link"),
        "spotify_url": spotify_url,
        "apple_music_url": apple_music_url,
        "cover_url": spotify_cover or apple_artwork,
        "preview_url": spotify.get("preview_url") or apple_preview,
        "duration_ms": spotify.get("duration_ms") or apple_music.get("durationInMillis"),
    }


@app.after_request
def add_security_headers(response: Response) -> Response:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


@app.get("/")
def home():
    return send_from_directory(ROOT, "index.html")


@app.get("/api/status")
def status():
    token = (os.environ.get("AUDD_API_TOKEN") or "").strip()
    return jsonify(
        ok=True,
        configured=bool(token),
        demo_mode=token == "test",
        max_upload_mb=MAX_UPLOAD_BYTES // (1024 * 1024),
    )


@app.post("/api/recognize")
def recognize():
    token = (os.environ.get("AUDD_API_TOKEN") or "").strip()
    if not token:
        token = (request.headers.get("X-AudD-Token") or "").strip()
    if not token:
        return jsonify(
            error="Reconhecimento não configurado. Defina AUDD_API_TOKEN no servidor/Vercel ou informe um token na interface.",
            code="missing_token",
        ), 503

    clip = request.files.get("audio")
    if not clip:
        return jsonify(error="Nenhuma amostra de áudio enviada.", code="missing_audio"), 400

    audio_bytes = clip.read()
    if not audio_bytes:
        return jsonify(error="O arquivo de áudio enviado está vazio.", code="empty_audio"), 400

    filename = clip.filename or "sample.wav"
    mimetype = clip.mimetype or "audio/wav"

    try:
        response = requests.post(
            AUDD_ENDPOINT,
            data={"api_token": token, "return": "apple_music,spotify"},
            files={"file": (filename, audio_bytes, mimetype)},
            timeout=AUDD_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.Timeout:
        return jsonify(error="O serviço de reconhecimento demorou muito para responder.", code="provider_timeout"), 504
    except (requests.RequestException, ValueError):
        return jsonify(error="Serviço de reconhecimento indisponível no momento.", code="provider_unavailable"), 502

    if payload.get("status") != "success":
        detail = payload.get("error") or {}
        message = (
            detail.get("error_message")
            or detail.get("message")
            or "O provedor de reconhecimento retornou um erro."
        )
        return jsonify(error=message, code="provider_error"), 502

    return jsonify(_extract_song_payload(payload.get("result")))


@app.errorhandler(413)
def upload_too_large(_error):
    limit_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
    return jsonify(error=f"Amostra de áudio muito grande (máximo de {limit_mb} MB).", code="payload_too_large"), 413


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    app.run(host=host, port=port, debug=False)
