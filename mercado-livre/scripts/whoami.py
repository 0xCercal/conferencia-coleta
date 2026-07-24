"""Mostra a conta dona do token (teste rápido de que o login funcionou).

Uso: python scripts/whoami.py teste
"""
from __future__ import annotations

import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from meli import MeliClient, TokenStore  # noqa: E402


def main() -> None:
    account = sys.argv[1] if len(sys.argv) > 1 else "teste"
    me = MeliClient(TokenStore(), account).me()
    print(f"id={me['id']}  nickname={me.get('nickname')}  site={me.get('site_id')}")
    print(f"nome={me.get('first_name', '')} {me.get('last_name', '')}".strip())
    print(f"tipo={me.get('user_type')}  reputação={me.get('seller_reputation', {}).get('level_id')}")


if __name__ == "__main__":
    main()
