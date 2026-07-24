"""Cria um anúncio de teste (use com uma conta de TESTE, nunca a real sem querer).

Monta o corpo mínimo de um anúncio. Cada categoria do ML exige atributos
diferentes; se a API reclamar de atributo faltando, o erro traz o que falta —
a gente ajusta o dicionário `attributes` abaixo.

Uso:
    python scripts/create_item.py teste "Camiseta Teste Automação" 79.90
"""
from __future__ import annotations

import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from meli import ApiError, MeliClient, TokenStore  # noqa: E402


def main() -> None:
    if len(sys.argv) < 4:
        raise SystemExit('Uso: python scripts/create_item.py <conta> "<título>" <preço>')
    account, title, price = sys.argv[1], sys.argv[2], float(sys.argv[3])
    client = MeliClient(TokenStore(), account)

    from meli.config import config

    try:
        hits = client.get(f"/sites/{config.SITE_ID}/domain_discovery/search", params={"q": title})
        category_id = hits[0]["category_id"] if hits else "MLB3530"
        print("categoria sugerida:", category_id, hits[0]["domain_name"] if hits else "(padrão)")
    except ApiError:
        category_id = "MLB3530"  # fallback genérico

    body = {
        "title": title,
        "category_id": category_id,
        "price": price,
        "currency_id": "BRL",
        "available_quantity": 10,
        "buying_mode": "buy_it_now",
        "condition": "new",
        "listing_type_id": "gold_special",
        "description": {"plain_text": "Anúncio de TESTE criado via API. Não é uma venda real."},
        "pictures": [{"source": "https://http2.mlstatic.com/resources/frontend/statics/growth-sellers-landings/device-imgs/mobile/imagen1.png"}],
        "attributes": [
            {"id": "SELLER_SKU", "value_name": "SKU-TESTE-001"},
            {"id": "BRAND", "value_name": "Genérica"},
            {"id": "MODEL", "value_name": "Teste"},
            # GTIN: em muitas categorias é obrigatório; se a sua for isenta,
            # remova esta linha ou marque a exceção pedida no erro da API.
            # {"id": "GTIN", "value_name": "7891234567895"},
        ],
    }

    try:
        item = client.post("/items", json=body)
    except ApiError as e:
        print("Falhou ao criar. A API costuma dizer o atributo/campo que falta:\n")
        print(e)
        return
    print("Anúncio criado:", item["id"], "->", item.get("permalink"))


if __name__ == "__main__":
    main()
