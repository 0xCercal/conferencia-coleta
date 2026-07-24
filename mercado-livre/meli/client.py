"""Cliente da API do Mercado Livre.

Cuida do chato pra você:
- injeta o `Authorization: Bearer <token>` em toda chamada;
- renova o token sozinho quando está perto de expirar (e salva o novo);
- trata rate limit (HTTP 429) com espera progressiva.

Uso típico:
    store = TokenStore()
    cli = MeliClient(store, account="teste")
    eu = cli.me()
"""
from __future__ import annotations

import time
from typing import Any, Optional

import requests

from .auth import Token, TokenStore, refresh_access_token, AuthError
from .config import config


class MeliClient:
    def __init__(
        self,
        store: TokenStore,
        account: str,
        *,
        session: Optional[requests.Session] = None,
        max_retries: int = 4,
    ) -> None:
        self.store = store
        self.account = account
        self.http = session or requests.Session()
        self.max_retries = max_retries

    # -- token -------------------------------------------------------------- #
    def _token(self) -> Token:
        token = self.store.get(self.account)
        if token is None:
            raise AuthError(
                f"Conta '{self.account}' não tem token salvo. Rode antes: "
                f"python scripts/login.py {self.account}"
            )
        if token.is_expired():
            token = refresh_access_token(token.refresh_token, session=self.http)
            self.store.set(self.account, token)  # salva o refresh_token NOVO
        return token

    # -- request base ------------------------------------------------------- #
    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = path if path.startswith("http") else f"{config.API_BASE}{path}"
        for attempt in range(self.max_retries + 1):
            token = self._token()
            headers = {"Authorization": f"Bearer {token.access_token}", "Accept": "application/json"}
            headers.update(kwargs.pop("headers", {}))
            resp = self.http.request(method, url, headers=headers, timeout=30, **kwargs)

            # Rate limit: espera e tenta de novo (respeitando Retry-After).
            if resp.status_code == 429 and attempt < self.max_retries:
                wait = float(resp.headers.get("Retry-After", 2 ** attempt))
                time.sleep(wait)
                continue

            # Token invalidado no servidor: força refresh e repete uma vez.
            if resp.status_code == 401 and attempt < self.max_retries:
                fresh = refresh_access_token(self._token().refresh_token, session=self.http)
                self.store.set(self.account, fresh)
                continue

            if resp.status_code >= 400:
                raise ApiError(f"{method} {url} -> {resp.status_code}: {resp.text}", resp.status_code)
            if not resp.content:
                return None
            return resp.json()
        raise ApiError(f"{method} {url}: esgotou tentativas", 0)

    # -- atalhos ------------------------------------------------------------ #
    def get(self, path: str, **kwargs: Any) -> Any:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, json: Any = None, **kwargs: Any) -> Any:
        return self.request("POST", path, json=json, **kwargs)

    def put(self, path: str, json: Any = None, **kwargs: Any) -> Any:
        return self.request("PUT", path, json=json, **kwargs)

    # -- conveniências de negócio ------------------------------------------ #
    def me(self) -> dict:
        """Dados da conta dona do token."""
        return self.get("/users/me")

    def list_item_ids(self, limit: int = 50) -> list[str]:
        """IDs dos anúncios da conta (ex.: MLB123...). Paginado por offset."""
        user_id = self.me()["id"]
        ids: list[str] = []
        offset = 0
        while True:
            page = self.get(f"/users/{user_id}/items/search", params={"limit": limit, "offset": offset})
            results = page.get("results", [])
            ids.extend(results)
            offset += limit
            if offset >= page.get("paging", {}).get("total", 0) or not results:
                break
        return ids

    def get_items(self, ids: list[str], attributes: Optional[str] = None) -> list[dict]:
        """Detalhe de vários anúncios (multiget, até 20 por chamada)."""
        out: list[dict] = []
        for i in range(0, len(ids), 20):
            chunk = ids[i : i + 20]
            params = {"ids": ",".join(chunk)}
            if attributes:
                params["attributes"] = attributes
            resp = self.get("/items", params=params)
            out.extend(entry["body"] for entry in resp if entry.get("code") == 200)
        return out

    def search_orders(self, *, status: Optional[str] = None, **params: Any) -> dict:
        """Pedidos/vendas da conta. Ex.: status='paid'."""
        user_id = self.me()["id"]
        query = {"seller": user_id, **params}
        if status:
            query["order.status"] = status
        return self.get("/orders/search", params=query)

    def list_questions(self, *, status: str = "UNANSWERED") -> dict:
        """Perguntas feitas nos seus anúncios (por padrão, as não respondidas)."""
        user_id = self.me()["id"]
        return self.get("/my/received_questions/search", params={"status": status, "seller_id": user_id})

    def answer_question(self, question_id: int, text: str) -> dict:
        """Responde uma pergunta de comprador."""
        return self.post("/answers", json={"question_id": question_id, "text": text})


class ApiError(RuntimeError):
    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status = status
