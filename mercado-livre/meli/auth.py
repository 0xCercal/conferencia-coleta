"""OAuth 2.0 do Mercado Livre: gerar o link de autorização, trocar o `code`
por token, renovar o token e guardar tudo por conta.

Pontos que a gente conversou, refletidos aqui:
- access_token dura ~6h; refresh_token dura ~6 meses e é de USO ÚNICO
  (cada renovação devolve um refresh_token novo — por isso a gente salva
  sempre o novo, senão perde o acesso).
- PKCE é opcional; se o app tiver PKCE ligado, mande code_challenge no link e
  code_verifier na troca do code.

As funções "puras" (montar link, gerar PKCE, calcular expiração) não tocam a
rede — dá para testá-las offline.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode

import requests

from .config import config

# Margem de segurança: renova antes de o token realmente expirar.
_EXPIRY_SKEW_SECONDS = 120


# --------------------------------------------------------------------------- #
# PKCE
# --------------------------------------------------------------------------- #
def generate_pkce() -> tuple[str, str]:
    """Gera (code_verifier, code_challenge) no método S256.

    O verifier é o segredo; o challenge (hash) é o que vai no link. Só o dono
    do verifier consegue trocar o code — protege o fluxo em apps públicos.
    """
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("=")
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return verifier, challenge


# --------------------------------------------------------------------------- #
# Montagem do link de autorização
# --------------------------------------------------------------------------- #
def build_authorization_url(
    *,
    client_id: Optional[str] = None,
    redirect_uri: Optional[str] = None,
    state: Optional[str] = None,
    code_challenge: Optional[str] = None,
    auth_domain: Optional[str] = None,
) -> str:
    """Monta a URL para a qual você (ou o dono da conta) vai no navegador para
    autorizar o app. Depois de autorizar, o ML redireciona para a redirect_uri
    com `?code=TG-...` (o code de uso único)."""
    params = {
        "response_type": "code",
        "client_id": client_id or config.CLIENT_ID,
        "redirect_uri": redirect_uri or config.REDIRECT_URI,
    }
    if state:
        params["state"] = state
    if code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"
    base = auth_domain or config.AUTH_DOMAIN
    return f"{base}/authorization?{urlencode(params)}"


# --------------------------------------------------------------------------- #
# Token: modelo, expiração e persistência
# --------------------------------------------------------------------------- #
@dataclass
class Token:
    access_token: str
    refresh_token: str
    user_id: int
    token_type: str = "bearer"
    scope: str = ""
    expires_at: float = 0.0  # epoch em segundos (calculado a partir de expires_in)

    def is_expired(self, skew: int = _EXPIRY_SKEW_SECONDS) -> bool:
        return time.time() >= (self.expires_at - skew)

    @classmethod
    def from_response(cls, data: dict) -> "Token":
        """Constrói um Token a partir da resposta JSON do /oauth/token,
        convertendo expires_in (duração) em expires_at (instante absoluto)."""
        return cls(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token", ""),
            user_id=int(data.get("user_id", 0)),
            token_type=data.get("token_type", "bearer"),
            scope=data.get("scope", ""),
            expires_at=time.time() + float(data.get("expires_in", 0)),
        )


class TokenStore:
    """Guarda um Token por conta (chave = apelido que você escolher, ex.:
    'teste', 'fercris', 'cercal') num JSON local, fora do Git."""

    def __init__(self, path: Optional[Path] = None) -> None:
        self.path = Path(path) if path else config.TOKENS_PATH
        self._data: dict[str, dict] = {}
        self._load()

    def _load(self) -> None:
        if self.path.exists():
            self._data = json.loads(self.path.read_text(encoding="utf-8"))

    def _flush(self) -> None:
        self.path.write_text(json.dumps(self._data, indent=2, ensure_ascii=False), encoding="utf-8")

    def get(self, account: str) -> Optional[Token]:
        raw = self._data.get(account)
        return Token(**raw) if raw else None

    def set(self, account: str, token: Token) -> None:
        self._data[account] = asdict(token)
        self._flush()

    def accounts(self) -> list[str]:
        return list(self._data.keys())


# --------------------------------------------------------------------------- #
# Chamadas de rede ao /oauth/token
# --------------------------------------------------------------------------- #
def exchange_code_for_token(
    code: str,
    *,
    code_verifier: Optional[str] = None,
    session: Optional[requests.Session] = None,
) -> Token:
    """Troca o `code` (recebido na redirect) por access_token + refresh_token."""
    config.require_app_credentials()
    payload = {
        "grant_type": "authorization_code",
        "client_id": config.CLIENT_ID,
        "client_secret": config.CLIENT_SECRET,
        "code": code,
        "redirect_uri": config.REDIRECT_URI,
    }
    if code_verifier:
        payload["code_verifier"] = code_verifier
    return _post_token(payload, session=session)


def refresh_access_token(
    refresh_token: str,
    *,
    session: Optional[requests.Session] = None,
) -> Token:
    """Usa o refresh_token para obter um access_token novo.

    Atenção: o ML devolve um refresh_token NOVO aqui — quem chama precisa
    salvar o Token retornado por inteiro."""
    config.require_app_credentials()
    payload = {
        "grant_type": "refresh_token",
        "client_id": config.CLIENT_ID,
        "client_secret": config.CLIENT_SECRET,
        "refresh_token": refresh_token,
    }
    return _post_token(payload, session=session)


def _post_token(payload: dict, *, session: Optional[requests.Session] = None) -> Token:
    http = session or requests
    resp = http.post(
        f"{config.API_BASE}/oauth/token",
        data=payload,
        headers={"accept": "application/json", "content-type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    if resp.status_code >= 400:
        raise AuthError(f"/oauth/token retornou {resp.status_code}: {resp.text}")
    return Token.from_response(resp.json())


class AuthError(RuntimeError):
    pass
