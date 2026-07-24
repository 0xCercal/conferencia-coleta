"""Lista os anúncios da conta com SKU e código de barras (GTIN).

Mostra, para cada anúncio: ID, título, preço, estoque, SKU e GTIN — puxando
o SKU do atributo SELLER_SKU e o código de barras do atributo GTIN.

Uso: python scripts/list_items.py teste
"""
from __future__ import annotations

import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from meli import MeliClient, TokenStore  # noqa: E402


def _attr(item: dict, attr_id: str) -> str:
    for a in item.get("attributes", []):
        if a.get("id") == attr_id:
            return a.get("value_name") or ""
    return ""


def main() -> None:
    account = sys.argv[1] if len(sys.argv) > 1 else "teste"
    client = MeliClient(TokenStore(), account)

    ids = client.list_item_ids()
    if not ids:
        print("Nenhum anúncio nesta conta ainda.")
        return

    items = client.get_items(ids, attributes="id,title,price,available_quantity,attributes,seller_custom_field")
    print(f"{'ID':<16}{'SKU':<16}{'GTIN':<16}{'R$':>9}  título")
    print("-" * 80)
    for it in items:
        sku = _attr(it, "SELLER_SKU") or it.get("seller_custom_field") or ""
        gtin = _attr(it, "GTIN")
        print(f"{it['id']:<16}{sku:<16}{gtin:<16}{it.get('price', 0):>9}  {it.get('title', '')[:40]}")


if __name__ == "__main__":
    main()
