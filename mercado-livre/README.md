# Loja automatizada no Mercado Livre — ambiente de teste

Projeto em Python para desenvolver e testar a automação de uma loja no Mercado
Livre **sem CNPJ e sem risco**, usando os *usuários de teste* (sandbox) da
própria API. Quando estiver redondo, o mesmo código funciona numa conta real.

> **Independente do app de conferência.** Esta pasta não depende de nada do
> resto do repositório; se um dia quiser, dá para movê-la para um repositório
> só dela.

## O que já vem pronto

- **OAuth 2.0 completo** (`meli/auth.py`): link de autorização, PKCE, troca do
  `code` por token, **refresh automático** (tratando o refresh_token de uso
  único) e armazenamento por conta em `tokens.json`.
- **Cliente da API** (`meli/client.py`): injeta o token, renova sozinho, trata
  rate limit (HTTP 429) e traz atalhos (anúncios, pedidos, perguntas).
- **Usuários de teste** (`meli/testusers.py`): cria contas de sandbox.
- **Scripts de linha de comando** (`scripts/`): login, criar usuário de teste,
  whoami, listar anúncios, criar anúncio, listar vendas, responder perguntas.
- **MCP próprio** (`mcp_server/server.py`): expõe a loja como ferramentas para
  um assistente operar em linguagem natural.
- **Testes** (`tests/`): validam as partes puras do OAuth (rodam offline).

## Estrutura

```
mercado-livre/
├── meli/            # pacote: config, auth, client, testusers
├── scripts/         # ferramentas de linha de comando
├── mcp_server/      # servidor MCP próprio
├── tests/           # testes unitários (offline)
├── .env.example     # modelo de credenciais (copie para .env)
└── requirements.txt
```

## Passo a passo (rode na sua máquina)

> ⚠️ **Ambiente web:** neste ambiente do Claude Code na web a saída de rede
> para `api.mercadolibre.com` está **bloqueada pela política do ambiente**.
> Por isso as chamadas ao vivo (login, criar usuário de teste, subir anúncio)
> precisam rodar **na sua máquina** (ou liberando esse host na política do
> ambiente). O código já está pronto e testado no que dá para testar offline.

### 1. Registrar um app no Mercado Livre (grátis, sem CNPJ)

1. Entre em <https://developers.mercadolivre.com.br/> com uma conta ML comum.
2. Crie uma aplicação. Anote o **App ID** (client_id) e a **Secret Key**.
3. Em **Redirect URI**, cadastre exatamente: `http://localhost:8080/callback`.
4. Marque o escopo **offline_access** (é o que libera o refresh_token), além de
   `read` e `write`. Se quiser, ative **PKCE** (o código já suporta).

### 2. Preparar o projeto

```bash
cd mercado-livre
python -m venv .venv && source .venv/bin/activate   # opcional
pip install -r requirements.txt
cp .env.example .env        # e preencha ML_CLIENT_ID e ML_CLIENT_SECRET
```

### 3. Logar com sua conta e criar o usuário de teste

```bash
python scripts/login.py dev              # abre o navegador; autorize
python scripts/create_test_user.py dev   # cria a "loja de teste" (ANOTE a senha)
```

### 4. Logar como o usuário de teste e operar

```bash
python scripts/login.py teste            # logue no navegador com o test user
python scripts/whoami.py teste
python scripts/create_item.py teste "Camiseta Teste" 79.90
python scripts/list_items.py teste
python scripts/orders_today.py teste
python scripts/answer_questions.py teste
```

### 5. (Opcional) Rodar o MCP para operar por conversa

```bash
pip install "mcp[cli]"
MELI_MCP_ACCOUNT=teste python mcp_server/server.py
```

Depois registre este servidor no seu cliente MCP (ex.: Claude Desktop/Code) e
peça em português: "liste meus anúncios", "quais vendas de hoje?", "responda a
pergunta 123 dizendo que temos em estoque".

## Rodar os testes

```bash
python -m unittest discover -s tests -v
```

---

## Como funcionam as três partes que você perguntou

### 🧾 Nota fiscal (NF-e)

- Para **CNPJ**, a NF-e é **obrigatória já na primeira venda** — é você (a
  empresa) o emissor, não o Mercado Livre.
- A API do ML **não emite** a nota; ela **transporta** os dados. O fluxo real:
  1. Venda cai (você recebe pela API, no `/orders`).
  2. Um **emissor de NF-e** gera a nota (o emissor integrado do próprio ML, ou
     um sistema fiscal/ERP via API, ou o sistema da prefeitura/SEFAZ).
  3. A nota (XML/DANFE) é **vinculada ao pedido** no ML — obrigatório para
     liberar o envio, principalmente no **Full**.
- **O que dá para automatizar:** montar os dados fiscais a partir do pedido
  (produto, valor, comprador, CFOP, NCM), disparar a emissão no seu emissor e
  anexar o resultado ao pedido. **O que não dá:** a responsabilidade tributária
  (CFOP/NCM/impostos corretos) é sua/do contador — a automação executa a regra,
  não decide o tributo. Recomendo definir isso com um contador antes do CNPJ.

### 🔌 MCP (Model Context Protocol)

- MCP é um padrão que deixa um assistente de IA **chamar ferramentas** suas.
  Aqui, cada operação da loja (listar anúncio, ler venda, responder pergunta)
  virou uma ferramenta em `mcp_server/server.py`.
- Existe um **MCP oficial do Mercado Livre** (`https://mcp.mercadolibre.com/mcp`),
  mas ele é voltado a *ajudar a desenvolver a integração* (gera código, traz a
  documentação). Para **operar a loja de verdade**, este MCP próprio é mais
  direto: ele faz exatamente as ações que você definiu, reutilizando o cliente
  com refresh de token e rate limit já resolvidos.
- Na prática: com o MCP ligado, você (ou eu) opera a loja conversando, sem
  rodar script por script.

### 💬 Atendimento ao cliente

- Dois canais na API: **perguntas** nos anúncios (`/questions`, `/answers`) e
  **mensagens pós-venda** (`/messages`). O script `answer_questions.py` já lê e
  responde perguntas.
- **Automação possível:** ler a pergunta, gerar a resposta (regra fixa ou IA
  com o contexto do anúncio) e responder — em segundos, o dia todo.
- **Cuidado real:** o ML avalia **qualidade e tempo de resposta** na reputação
  e proíbe spam/respostas fora de contexto. O caminho seguro é IA que responde
  o previsível (prazo, estoque, medidas) e **encaminha para você** o que for
  sensível (troca, defeito, reclamação). Comece com o assistente **sugerindo** a
  resposta e você aprovando; depois solte o que for repetitivo.
