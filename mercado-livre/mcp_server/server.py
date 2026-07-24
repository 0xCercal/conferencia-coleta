"""MCP próprio da loja no Mercado Livre.

Expõe as operações da loja como FERRAMENTAS que um assistente (o Claude, no
Claude Code / Desktop) pode chamar em linguagem natural: "me mostra as vendas",
"responde a pergunta 123", "lista meus anúncios".

Por baixo, cada ferramenta usa o mesmo `MeliClient` dos scripts — ou seja, o
refresh de token e o rate limit já vêm resolvidos.

Como rodar:
    pip install "mcp[cli]"
    python mcp_server/server.py            # transporte stdio (para Claude Desktop/Code)

A conta usada vem da variável de ambiente MELI_MCP_ACCOUNT (padrão: "teste").
Registre no cliente MCP (ex.: Claude Desktop) apontando para este arquivo.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mcp.server.fastmcp import FastMCP  # noqa: E402

from meli import MeliClient, TokenStore, create_test_user  # noqa: E402

ACCOUNT = os.environ.get("MELI_MCP_ACCOUNT", "teste")
mcp = FastMCP("mercado-livre")


def _client() -> MeliClient:
    return MeliClient(TokenStore(), ACCOUNT)


@mcp.tool()
def whoami() -> dict:
    """Retorna os dados da conta conectada (id, apelido, reputação)."""
    me = _client().me()
    return {
        "id": me.get("id"),
        "nickname": me.get("nickname"),
        "site_id": me.get("site_id"),
        "reputation": me.get("seller_reputation", {}).get("level_id"),
    }


@mcp.tool()
def list_items(limit: int = 20) -> list[dict]:
    """Lista os anúncios da conta com SKU, GTIN, preço e estoque."""
    cli = _client()
    ids = cli.list_item_ids(limit=limit)[:limit]
    items = cli.get_items(ids, attributes="id,title,price,available_quantity,attributes")

    def attr(it: dict, key: str) -> str:
        return next((a.get("value_name", "") for a in it.get("attributes", []) if a.get("id") == key), "")

    return [
        {
            "id": it["id"],
            "title": it.get("title"),
            "price": it.get("price"),
            "stock": it.get("available_quantity"),
            "sku": attr(it, "SELLER_SKU"),
            "gtin": attr(it, "GTIN"),
        }
        for it in items
    ]


@mcp.tool()
def list_orders(status: str = "paid", limit: int = 10) -> list[dict]:
    """Lista as vendas da conta (por padrão as pagas)."""
    data = _client().search_orders(status=status, sort="date_desc", limit=limit)
    return [
        {
            "id": o["id"],
            "total": o.get("total_amount"),
            "date": o.get("date_created", "")[:10],
            "buyer": o.get("buyer", {}).get("nickname"),
            "items": [
                {"qty": i.get("quantity"), "title": i.get("item", {}).get("title"), "sku": i.get("item", {}).get("seller_sku")}
                for i in o.get("order_items", [])
            ],
        }
        for o in data.get("results", [])
    ]


@mcp.tool()
def list_questions() -> list[dict]:
    """Lista as perguntas de compradores ainda não respondidas."""
    data = _client().list_questions(status="UNANSWERED")
    return [{"id": q["id"], "item_id": q.get("item_id"), "text": q.get("text")} for q in data.get("questions", [])]


@mcp.tool()
def answer_question(question_id: int, text: str) -> dict:
    """Responde uma pergunta de comprador pelo id."""
    _client().answer_question(question_id, text)
    return {"answered": question_id}


@mcp.tool()
def create_sandbox_test_user() -> dict:
    """Cria um usuário de teste (sandbox). Requer a conta atual ser real/dev."""
    return create_test_user(_client())


if __name__ == "__main__":
    mcp.run()
