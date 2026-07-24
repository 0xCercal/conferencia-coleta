"""Usuários de teste do Mercado Livre.

Contas "de mentira" para desenvolver e simular vendas sem CNPJ, sem produto
físico e sem risco de suspender uma conta real. Criar um usuário de teste
exige um access_token de uma conta real (a sua conta de desenvolvedor).

Limite: o ML permite poucos usuários de teste por conta (na casa de ~10).
As credenciais (nickname/senha) só aparecem no momento da criação — anote.
"""
from __future__ import annotations

from .client import MeliClient
from .config import config


def create_test_user(client: MeliClient, site_id: str | None = None) -> dict:
    """Cria um usuário de teste no site informado (MLB = Brasil).

    Retorna algo como:
        {"id": 123, "nickname": "TESTUSER_...", "password": "...",
         "email": "test_user_...@testuser.com", "site_status": "active"}
    """
    return client.post("/users/test_user", json={"site_id": site_id or config.SITE_ID})
