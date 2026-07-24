"""Configuração central do projeto.

Lê as credenciais e endpoints das variáveis de ambiente (ou de um arquivo
`.env` na raiz de `mercado-livre/`). Nada de segredo fica no código: o
`client_secret` mora só no seu `.env`, que está no `.gitignore`.
"""
from __future__ import annotations

import os
from pathlib import Path

# Raiz do projeto (a pasta mercado-livre/).
ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Carrega um .env simples (KEY=VALOR por linha) sem depender de libs.

    Não sobrescreve variáveis que já existam no ambiente — o ambiente ganha.
    """
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv(ROOT / ".env")


class Config:
    """Configuração resolvida a partir do ambiente."""

    # Credenciais do app registrado no portal de devs do Mercado Livre.
    CLIENT_ID: str = os.environ.get("ML_CLIENT_ID", "")
    CLIENT_SECRET: str = os.environ.get("ML_CLIENT_SECRET", "")

    # Precisa ser IGUAL à Redirect URI cadastrada no app.
    REDIRECT_URI: str = os.environ.get("ML_REDIRECT_URI", "http://localhost:8080/callback")

    # Domínio de login (Brasil). Outros países mudam o sufixo (.com.ar, etc.).
    AUTH_DOMAIN: str = os.environ.get("ML_AUTH_DOMAIN", "https://auth.mercadolivre.com.br")

    # A API é a mesma para todos os países.
    API_BASE: str = os.environ.get("ML_API_BASE", "https://api.mercadolibre.com")

    # Site (marketplace). MLB = Brasil.
    SITE_ID: str = os.environ.get("ML_SITE_ID", "MLB")

    # Onde os tokens de cada conta ficam guardados (fora do Git).
    TOKENS_PATH: Path = Path(os.environ.get("ML_TOKENS_PATH", str(ROOT / "tokens.json")))

    @classmethod
    def require_app_credentials(cls) -> None:
        """Falha cedo, com mensagem clara, se faltar client_id/secret."""
        faltando = [
            nome
            for nome, valor in (("ML_CLIENT_ID", cls.CLIENT_ID), ("ML_CLIENT_SECRET", cls.CLIENT_SECRET))
            if not valor
        ]
        if faltando:
            raise SystemExit(
                "Faltam credenciais do app: "
                + ", ".join(faltando)
                + ".\nCopie .env.example para .env e preencha com os dados do seu app "
                "(portal de desenvolvedores do Mercado Livre)."
            )


config = Config()
