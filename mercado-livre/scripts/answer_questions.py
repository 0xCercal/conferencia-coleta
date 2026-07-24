"""Lista perguntas não respondidas e (opcionalmente) responde.

Sem argumento de resposta, só LISTA (modo seguro). Com --answer, envia uma
resposta padrão — troque pela lógica/IA que você quiser.

Uso:
    python scripts/answer_questions.py teste                 # só lista
    python scripts/answer_questions.py teste --answer 123 "Olá! Sim, temos em estoque."
"""
from __future__ import annotations

import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from meli import MeliClient, TokenStore  # noqa: E402


def main() -> None:
    args = sys.argv[1:]
    account = args[0] if args else "teste"
    client = MeliClient(TokenStore(), account)

    if "--answer" in args:
        i = args.index("--answer")
        question_id = int(args[i + 1])
        text = args[i + 2]
        client.answer_question(question_id, text)
        print(f"Respondida a pergunta {question_id}.")
        return

    data = client.list_questions(status="UNANSWERED")
    perguntas = data.get("questions", [])
    if not perguntas:
        print("Nenhuma pergunta pendente.")
        return
    print(f"{len(perguntas)} pergunta(s) pendente(s):\n")
    for q in perguntas:
        print(f"  #{q['id']}  item {q.get('item_id')}")
        print(f"      P: {q.get('text')}")
    print("\nPara responder: python scripts/answer_questions.py", account, '--answer <id> "sua resposta"')


if __name__ == "__main__":
    main()
