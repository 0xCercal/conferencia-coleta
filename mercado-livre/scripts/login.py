"""Login OAuth de uma conta (real ou de teste).

Sobe um servidor local em http://localhost:8080/callback só para capturar o
`code` que o Mercado Livre devolve depois de você autorizar no navegador.
Em seguida troca o code por token e salva em tokens.json sob o apelido que
você escolher.

Uso:
    python scripts/login.py teste          # apelido da conta
    python scripts/login.py fercris

Pré-requisitos:
    - .env preenchido (ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI)
    - a Redirect URI do app apontando para http://localhost:8080/callback
"""
from __future__ import annotations

import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

# Permite rodar como "python scripts/login.py" (adiciona a raiz ao path).
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from meli import (  # noqa: E402
    TokenStore,
    build_authorization_url,
    exchange_code_for_token,
    generate_pkce,
)
from meli.config import config  # noqa: E402

_received: dict[str, str] = {}


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        query = parse_qs(urlparse(self.path).query)
        if "code" in query:
            _received["code"] = query["code"][0]
            body = "<h2>Pode fechar esta aba e voltar ao terminal.</h2>"
        else:
            body = "<h2>Sem 'code' na URL. Verifique a Redirect URI do app.</h2>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def log_message(self, *_):  # silencia o log do servidor
        return


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python scripts/login.py <apelido-da-conta>")
    account = sys.argv[1]
    config.require_app_credentials()

    verifier, challenge = generate_pkce()
    url = build_authorization_url(code_challenge=challenge, state=account)

    # host/porta da redirect_uri (ex.: localhost:8080)
    parsed = urlparse(config.REDIRECT_URI)
    server = HTTPServer((parsed.hostname or "localhost", parsed.port or 80), _Handler)
    threading.Thread(target=server.handle_request, daemon=True).start()

    print("Abra este link no navegador e autorize (login na conta desejada):\n")
    print(url, "\n")
    try:
        webbrowser.open(url)
    except Exception:
        pass

    print("Aguardando o redirecionamento em", config.REDIRECT_URI, "...")
    while "code" not in _received:
        pass

    token = exchange_code_for_token(_received["code"], code_verifier=verifier)
    TokenStore().set(account, token)
    print(f"\nToken salvo para a conta '{account}' (user_id={token.user_id}).")
    print("Escopo:", token.scope or "(não informado)")


if __name__ == "__main__":
    main()
