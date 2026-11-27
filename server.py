"""Local Flask proxy for AudD music recognition and official YouTube Data API v3 playlists."""
from __future__ import annotations

import os
import secrets
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests
from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session, url_for

ROOT = Path(__file__).resolve().parent
AUDD_ENDPOINT = "https://api.audd.io/"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
AUDD_TIMEOUT_SECONDS = 20
YOUTUBE_TIMEOUT_SECONDS = 15


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
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


def _youtube_oauth_config() -> tuple[str, str]:
    client_id = (os.environ.get("GOOGLE_CLIENT_ID") or "").strip()
    client_secret = (os.environ.get("GOOGLE_CLIENT_SECRET") or "").strip()
    return client_id, client_secret


def _get_valid_youtube_token() -> str | None:
    """Return a valid YouTube OAuth access token from session, refreshing if needed."""
    access_token = session.get("yt_access_token")
    expires_at = float(session.get("yt_expires_at") or 0)
    if access_token and time.time() < expires_at - 30:
        return access_token

    refresh_token = session.get("yt_refresh_token")
    client_id, client_secret = _youtube_oauth_config()
    if not refresh_token or not client_id or not client_secret:
        return access_token if access_token and not expires_at else None

    try:
        resp = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=YOUTUBE_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        token_data = resp.json()
        new_token = token_data.get("access_token")
        if new_token:
            session["yt_access_token"] = new_token
            session["yt_expires_at"] = time.time() + int(token_data.get("expires_in", 3600))
            return new_token
    except (requests.RequestException, ValueError):
        return None
    return None


def _yt_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


def _find_or_create_playlist(token: str, playlist_name: str) -> dict[str, str]:
    """Find an existing user playlist by title or create a private one."""
    headers = _yt_headers(token)
    list_resp = requests.get(
        f"{YOUTUBE_API_BASE}/playlists",
        headers=headers,
        params={"part": "snippet", "mine": "true", "maxResults": 50},
        timeout=YOUTUBE_TIMEOUT_SECONDS,
    )
    list_resp.raise_for_status()
    items = (list_resp.json() or {}).get("items") or []
    target_lower = playlist_name.strip().lower()
    for item in items:
        title = ((item.get("snippet") or {}).get("title") or "").strip()
        if title.lower() == target_lower and item.get("id"):
            return {"id": item["id"], "title": title}

    create_resp = requests.post(
        f"{YOUTUBE_API_BASE}/playlists",
        headers=headers,
        params={"part": "snippet,status"},
        json={
            "snippet": {
                "title": playlist_name.strip(),
                "description": "Faixas identificadas automaticamente pelo Listen. Ative o Download offline no YouTube ou YouTube Music.",
            },
            "status": {"privacyStatus": "private"},
        },
        timeout=YOUTUBE_TIMEOUT_SECONDS,
    )
    create_resp.raise_for_status()
    created = create_resp.json()
    return {"id": created["id"], "title": playlist_name.strip()}


def _search_youtube_video(token: str, query: str, music_only: bool = False) -> dict[str, str] | None:
    params: dict[str, Any] = {
        "part": "snippet",
        "q": query,
        "type": "video",
        "maxResults": 1,
    }
    if music_only:
        params["videoCategoryId"] = "10"

    resp = requests.get(
        f"{YOUTUBE_API_BASE}/search",
        headers=_yt_headers(token),
        params=params,
        timeout=YOUTUBE_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    items = (resp.json() or {}).get("items") or []
    if not items:
        return None
    first = items[0]
    video_id = (first.get("id") or {}).get("videoId")
    if not video_id:
        return None
    title = (first.get("snippet") or {}).get("title") or query
    return {
        "video_id": video_id,
        "title": title,
        "url": f"https://www.youtube.com/watch?v={video_id}",
    }


def _add_video_to_playlist(token: str, playlist_id: str, video_id: str) -> None:
    resp = requests.post(
        f"{YOUTUBE_API_BASE}/playlistItems",
        headers=_yt_headers(token),
        params={"part": "snippet"},
        json={
            "snippet": {
                "playlistId": playlist_id,
                "resourceId": {
                    "kind": "youtube#video",
                    "videoId": video_id,
                },
            }
        },
        timeout=YOUTUBE_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()


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
    if "code" in request.args and "state" in request.args:
        return youtube_callback()
    if "error" in request.args and session.get("yt_oauth_state"):
        return youtube_callback()
    return send_from_directory(ROOT, "index.html")


@app.get("/api/status")
def status():
    token = (os.environ.get("AUDD_API_TOKEN") or "").strip()
    client_id, client_secret = _youtube_oauth_config()
    return jsonify(
        ok=True,
        configured=bool(token),
        demo_mode=token == "test",
        max_upload_mb=MAX_UPLOAD_BYTES // (1024 * 1024),
        youtube_configured=bool(client_id and client_secret),
        youtube_connected=bool(session.get("yt_access_token")),
    )


@app.get("/api/youtube/auth")
def youtube_auth():
    client_id, client_secret = _youtube_oauth_config()
    if not client_id or not client_secret:
        return jsonify(
            error="Integração YouTube não configurada. Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor.",
            code="youtube_not_configured",
        ), 503

    oauth_state = secrets.token_urlsafe(24)
    session["yt_oauth_state"] = oauth_state
    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI") or url_for("youtube_callback", _external=True)

    params = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": YOUTUBE_SCOPE,
            "access_type": "offline",
            "prompt": "consent",
            "state": oauth_state,
        }
    )
    return redirect(f"{GOOGLE_AUTH_URL}?{params}")


@app.get("/api/youtube/callback")
def youtube_callback():
    error = request.args.get("error")
    if error:
        return redirect("/?youtube=denied")

    expected_state = session.pop("yt_oauth_state", None)
    received_state = request.args.get("state")
    code = request.args.get("code")
    if not expected_state or expected_state != received_state or not code:
        return redirect("/?youtube=error")

    client_id, client_secret = _youtube_oauth_config()
    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI") or url_for("youtube_callback", _external=True)

    try:
        resp = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=YOUTUBE_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        token_data = resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            return redirect("/?youtube=error")
        session["yt_access_token"] = access_token
        if token_data.get("refresh_token"):
            session["yt_refresh_token"] = token_data["refresh_token"]
        session["yt_expires_at"] = time.time() + int(token_data.get("expires_in", 3600))
        return redirect("/?youtube=connected")
    except (requests.RequestException, ValueError):
        return redirect("/?youtube=error")


@app.post("/api/youtube/logout")
def youtube_logout():
    session.pop("yt_access_token", None)
    session.pop("yt_refresh_token", None)
    session.pop("yt_expires_at", None)
    return jsonify(ok=True)


@app.post("/api/youtube/add")
def youtube_add():
    token = _get_valid_youtube_token()
    if not token:
        return jsonify(
            error="Conecte sua conta do YouTube primeiro para adicionar faixas à playlist.",
            code="youtube_not_connected",
        ), 401

    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    artist = (body.get("artist") or "").strip()
    playlist_name = (body.get("playlist_name") or "Listen — Offline").strip() or "Listen — Offline"
    kind = (body.get("kind") or "audio").strip().lower()
    if kind not in {"audio", "video", "both"}:
        kind = "audio"

    if not title:
        return jsonify(error="Informe o título da faixa para buscar no YouTube.", code="missing_title"), 400

    base_query = f"{artist} {title}".strip()
    search_plan: list[tuple[str, str, bool]] = []
    if kind in {"audio", "both"}:
        search_plan.append(("audio", f"{base_query} official audio", True))
    if kind in {"video", "both"}:
        search_plan.append(("video", f"{base_query} official video", False))

    try:
        playlist = _find_or_create_playlist(token, playlist_name)
        added: list[dict[str, str]] = []
        seen_ids: set[str] = set()

        for item_kind, query, music_only in search_plan:
            match = _search_youtube_video(token, query, music_only=music_only)
            if not match:
                continue
            if match["video_id"] in seen_ids:
                continue
            _add_video_to_playlist(token, playlist["id"], match["video_id"])
            seen_ids.add(match["video_id"])
            added.append({"kind": item_kind, **match})

        if not added:
            return jsonify(
                error="Nenhum resultado encontrado no YouTube para esta faixa.",
                code="youtube_no_results",
            ), 404

        playlist_id = playlist["id"]
        return jsonify(
            ok=True,
            playlist_id=playlist_id,
            playlist_name=playlist["title"],
            playlist_url=f"https://www.youtube.com/playlist?list={playlist_id}",
            music_playlist_url=f"https://music.youtube.com/playlist?list={playlist_id}",
            added=added,
        )
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else 502
        if status_code == 401:
            session.pop("yt_access_token", None)
            return jsonify(error="Sessão do YouTube expirada. Conecte novamente.", code="youtube_token_expired"), 401
        return jsonify(error="Erro retornado pela API do YouTube.", code="youtube_api_error"), 502
    except (requests.RequestException, ValueError):
        return jsonify(error="API do YouTube indisponível no momento.", code="youtube_unavailable"), 502


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
