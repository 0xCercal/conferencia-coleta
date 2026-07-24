"""Lista as vendas pagas da conta (base para automação de pós-venda / coleta).

Uso: python scripts/orders_today.py teste
"""
from __future__ import annotations

import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from meli import MeliClient, TokenStore  # noqa: E402


def main() -> None:
    account = sys.argv[1] if len(sys.argv) > 1 else "teste"
    client = MeliClient(TokenStore(), account)

    data = client.search_orders(status="paid", sort="date_desc", limit=20)
    results = data.get("results", [])
    if not results:
        print("Nenhuma venda paga encontrada.")
        return

    print(f"{len(results)} venda(s):\n")
    for o in results:
        buyer = o.get("buyer", {}).get("nickname", "?")
        total = o.get("total_amount")
        print(f"Pedido {o['id']}  |  R$ {total}  |  comprador: {buyer}  |  {o.get('date_created', '')[:10]}")
        for it in o.get("order_items", []):
            item = it.get("item", {})
            print(f"    - {it.get('quantity')}x  {item.get('title')}  (SKU: {item.get('seller_sku') or '-'})")


if __name__ == "__main__":
    main()
