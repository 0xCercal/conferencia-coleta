"""Testes das partes puras (sem rede) do OAuth e do armazenamento de token.

Rodam offline: PKCE, montagem do link de autorização, cálculo de expiração e
o TokenStore. As chamadas de rede (troca de code, refresh) não são testadas
aqui — dependem do servidor do Mercado Livre.
"""
import base64
import hashlib
import time
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from meli.auth import (  # noqa: E402
    Token,
    TokenStore,
    build_authorization_url,
    generate_pkce,
)


class PkceTests(unittest.TestCase):
    def test_challenge_is_s256_of_verifier(self):
        verifier, challenge = generate_pkce()
        expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        self.assertEqual(challenge, expected)

    def test_verifier_is_unreserved_and_long_enough(self):
        verifier, _ = generate_pkce()
        # RFC 7636: 43..128 chars, sem padding "="
        self.assertGreaterEqual(len(verifier), 43)
        self.assertNotIn("=", verifier)


class AuthUrlTests(unittest.TestCase):
    def test_url_has_required_params(self):
        url = build_authorization_url(
            client_id="123",
            redirect_uri="http://localhost:8080/callback",
            code_challenge="abc",
            state="teste",
        )
        parsed = urlparse(url)
        q = parse_qs(parsed.query)
        self.assertTrue(url.startswith("https://auth.mercadolivre.com.br/authorization?"))
        self.assertEqual(q["response_type"], ["code"])
        self.assertEqual(q["client_id"], ["123"])
        self.assertEqual(q["redirect_uri"], ["http://localhost:8080/callback"])
        self.assertEqual(q["code_challenge"], ["abc"])
        self.assertEqual(q["code_challenge_method"], ["S256"])
        self.assertEqual(q["state"], ["teste"])

    def test_no_pkce_omits_challenge(self):
        url = build_authorization_url(client_id="1", redirect_uri="http://x/cb")
        self.assertNotIn("code_challenge", url)


class TokenTests(unittest.TestCase):
    def test_from_response_computes_expiry(self):
        before = time.time()
        tok = Token.from_response(
            {"access_token": "AT", "refresh_token": "RT", "user_id": 7, "expires_in": 21600, "scope": "read"}
        )
        self.assertEqual(tok.access_token, "AT")
        self.assertEqual(tok.user_id, 7)
        self.assertGreaterEqual(tok.expires_at, before + 21600 - 1)

    def test_is_expired_respects_skew(self):
        tok = Token(access_token="AT", refresh_token="RT", user_id=1, expires_at=time.time() + 60)
        self.assertTrue(tok.is_expired(skew=120))   # expira em 60s, margem 120s -> "expirado"
        self.assertFalse(tok.is_expired(skew=10))   # margem 10s -> ainda válido


class TokenStoreTests(unittest.TestCase):
    def test_roundtrip_per_account(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "tokens.json"
            store = TokenStore(path)
            tok = Token(access_token="AT", refresh_token="RT", user_id=99, expires_at=123.0)
            store.set("teste", tok)

            reloaded = TokenStore(path)  # relê do disco
            got = reloaded.get("teste")
            self.assertIsNotNone(got)
            self.assertEqual(got.access_token, "AT")
            self.assertEqual(got.user_id, 99)
            self.assertEqual(reloaded.accounts(), ["teste"])
            self.assertIsNone(reloaded.get("inexistente"))


if __name__ == "__main__":
    unittest.main()
