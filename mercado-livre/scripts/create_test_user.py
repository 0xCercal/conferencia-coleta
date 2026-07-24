"""Cria um usuário de teste usando o token de uma conta real já logada.

Fluxo:
    1) python scripts/login.py dev        # logue com SUA conta real (dev)
    2) python scripts/create_test_user.py dev

Anote o nickname/senha impressos: com eles você faz
    python scripts/login.py teste
(logando no navegador como o usuário de teste) para operar a "loja de teste".
"""
from __future__ import annotations

import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from meli import MeliClient, TokenStore, create_test_user  # noqa: E402


def main() -> None:
    account = sys.argv[1] if len(sys.argv) > 1 else "dev"
    client = MeliClient(TokenStore(), account)
    user = create_test_user(client)
    print("Usuário de teste criado — ANOTE (a senha só aparece agora):\n")
    for key in ("id", "nickname", "password", "email", "site_status"):
        if key in user:
            print(f"  {key:12}: {user[key]}")
    print("\nAgora rode: python scripts/login.py teste  e logue com esse nickname/senha.")


if __name__ == "__main__":
    main()
