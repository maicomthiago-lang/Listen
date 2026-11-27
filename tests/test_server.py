import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

import server


class ServerTestCase(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self._orig_token = os.environ.get("AUDD_API_TOKEN")

    def tearDown(self):
        if self._orig_token is None:
            os.environ.pop("AUDD_API_TOKEN", None)
        else:
            os.environ["AUDD_API_TOKEN"] = self._orig_token

    def test_home_serves_html_and_security_headers(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/html", response.content_type)
        self.assertIn(b"/static/app.js", response.data)
        self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(response.headers.get("Referrer-Policy"), "no-referrer")

    def test_static_assets_are_served(self):
        css_resp = self.client.get("/static/styles.css")
        js_resp = self.client.get("/static/app.js")
        self.assertEqual(css_resp.status_code, 200)
        self.assertEqual(js_resp.status_code, 200)

    def test_status_without_token(self):
        os.environ.pop("AUDD_API_TOKEN", None)
        response = self.client.get("/api/status")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["ok"])
        self.assertFalse(data["configured"])
        self.assertFalse(data["demo_mode"])

    def test_status_with_demo_token(self):
        os.environ["AUDD_API_TOKEN"] = "test"
        response = self.client.get("/api/status")
        data = response.get_json()
        self.assertTrue(data["configured"])
        self.assertTrue(data["demo_mode"])

    def test_recognize_returns_503_when_token_missing(self):
        os.environ.pop("AUDD_API_TOKEN", None)
        response = self.client.post("/api/recognize")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["code"], "missing_token")

    @patch("server.requests.post")
    def test_recognize_accepts_session_header_token_when_env_missing(self, mock_post):
        os.environ.pop("AUDD_API_TOKEN", None)
        fake_response = MagicMock()
        fake_response.raise_for_status.return_value = None
        fake_response.json.return_value = {"status": "success", "result": None}
        mock_post.return_value = fake_response

        response = self.client.post(
            "/api/recognize",
            headers={"X-AudD-Token": "test"},
            data={"audio": (io.BytesIO(b"RIFF....WAVE"), "sample.wav")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()["found"])

    def test_recognize_returns_400_when_audio_missing(self):
        os.environ["AUDD_API_TOKEN"] = "test"
        response = self.client.post("/api/recognize")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["code"], "missing_audio")

    def test_recognize_returns_400_when_audio_empty(self):
        os.environ["AUDD_API_TOKEN"] = "test"
        response = self.client.post(
            "/api/recognize",
            data={"audio": (io.BytesIO(b""), "empty.wav")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["code"], "empty_audio")

    @patch("server.requests.post")
    def test_recognize_success_extracts_full_metadata(self, mock_post):
        os.environ["AUDD_API_TOKEN"] = "secret-token"
        fake_response = MagicMock()
        fake_response.raise_for_status.return_value = None
        fake_response.json.return_value = {
            "status": "success",
            "result": {
                "title": "Bohemian Rhapsody",
                "artist": "Queen",
                "album": "A Night at the Opera",
                "release_date": "1975-10-31",
                "label": "EMI",
                "timecode": "01:12",
                "song_link": "https://lis.tn/example",
                "spotify": {
                    "preview_url": "https://p.scdn.co/mp3-preview/example",
                    "duration_ms": 354320,
                    "external_urls": {"spotify": "https://open.spotify.com/track/123"},
                    "album": {
                        "name": "A Night at the Opera",
                        "images": [{"url": "https://i.scdn.co/image/cover.jpg"}],
                    },
                },
                "apple_music": {
                    "url": "https://music.apple.com/track/123",
                    "artwork": {"url": "https://is1-ssl.mzstatic.com/image/{w}x{h}bb.jpg"},
                },
            },
        }
        mock_post.return_value = fake_response

        response = self.client.post(
            "/api/recognize",
            data={"audio": (io.BytesIO(b"RIFF....WAVE"), "sample.wav")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["found"])
        self.assertEqual(data["title"], "Bohemian Rhapsody")
        self.assertEqual(data["artist"], "Queen")
        self.assertEqual(data["cover_url"], "https://i.scdn.co/image/cover.jpg")
        self.assertEqual(data["spotify_url"], "https://open.spotify.com/track/123")
        self.assertEqual(data["apple_music_url"], "https://music.apple.com/track/123")
        self.assertEqual(data["preview_url"], "https://p.scdn.co/mp3-preview/example")
        self.assertEqual(data["links"], "https://lis.tn/example")

    @patch("server.requests.post")
    def test_recognize_no_match(self, mock_post):
        os.environ["AUDD_API_TOKEN"] = "test"
        fake_response = MagicMock()
        fake_response.raise_for_status.return_value = None
        fake_response.json.return_value = {"status": "success", "result": None}
        mock_post.return_value = fake_response

        response = self.client.post(
            "/api/recognize",
            data={"audio": (io.BytesIO(b"RIFF....WAVE"), "sample.wav")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertFalse(data["found"])
        self.assertIsNone(data["title"])

    @patch("server.requests.post")
    def test_recognize_provider_error(self, mock_post):
        os.environ["AUDD_API_TOKEN"] = "test"
        fake_response = MagicMock()
        fake_response.raise_for_status.return_value = None
        fake_response.json.return_value = {
            "status": "error",
            "error": {"error_message": "API limit exceeded"},
        }
        mock_post.return_value = fake_response

        response = self.client.post(
            "/api/recognize",
            data={"audio": (io.BytesIO(b"RIFF....WAVE"), "sample.wav")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["error"], "API limit exceeded")

    @patch("server.requests.post", side_effect=requests.Timeout)
    def test_recognize_timeout_returns_504(self, _mock_post):
        os.environ["AUDD_API_TOKEN"] = "test"
        response = self.client.post(
            "/api/recognize",
            data={"audio": (io.BytesIO(b"RIFF....WAVE"), "sample.wav")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.get_json()["code"], "provider_timeout")

    def test_load_dotenv_does_not_override_existing_vars(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            env_file = Path(tmpdir) / ".env"
            env_file.write_text(
                '# comment\nLISTEN_TEST_A="from_file"\nLISTEN_TEST_B=from_file\n',
                encoding="utf-8",
            )
            os.environ["LISTEN_TEST_B"] = "already_set"
            try:
                server.load_dotenv(env_file)
                self.assertEqual(os.environ.get("LISTEN_TEST_A"), "from_file")
                self.assertEqual(os.environ.get("LISTEN_TEST_B"), "already_set")
            finally:
                os.environ.pop("LISTEN_TEST_A", None)
                os.environ.pop("LISTEN_TEST_B", None)


if __name__ == "__main__":
    unittest.main()
