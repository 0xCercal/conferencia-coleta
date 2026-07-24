"""Pacote de integração com a API do Mercado Livre.

Módulos:
- config     -> credenciais e endpoints (lidos do ambiente / .env)
- auth       -> OAuth 2.0: link de autorização, troca de code, refresh, storage
- client     -> cliente HTTP com refresh automático e tratamento de rate limit
- testusers  -> criação de usuários de teste (sandbox sem CNPJ)
"""
from .auth import (
    AuthError,
    Token,
    TokenStore,
    build_authorization_url,
    exchange_code_for_token,
    generate_pkce,
    refresh_access_token,
)
from .client import ApiError, MeliClient
from .config import config
from .testusers import create_test_user

__all__ = [
    "AuthError",
    "Token",
    "TokenStore",
    "build_authorization_url",
    "exchange_code_for_token",
    "generate_pkce",
    "refresh_access_token",
    "ApiError",
    "MeliClient",
    "config",
    "create_test_user",
]
