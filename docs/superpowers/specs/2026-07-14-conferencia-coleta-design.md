# Conferência de Coleta — Especificação de Design

Data: 2026-07-14
Status: Aprovado pelo usuário

## Problema

O usuário faz cross docking: coleta produtos diariamente em dois fornecedores/marcas (FERCRIS e CERCAL). Recebe de uma funcionária, via WhatsApp, uma lista com quantidade + SKU + descrição dos produtos a coletar. Hoje confere manualmente item por item contra o que a expedição do fornecedor entrega. Objetivo: bipar o código de barras de cada produto com o celular e ter a conferência automática contra a lista.

## Contexto e restrições

- Celular: iPhone (Safari). Câmera via navegador exige HTTPS.
- Lista chega como texto de WhatsApp no formato:
  ```
  *FERCRIS*
  1 - SGR-0501 Sifão de Inox com Copo para Banheiro (Gran Grafite Fosco)
  2 - ARLN-0103 Acabamento para Registro Base Deca e Docol (Linea Cromado)

  *CERCAL*
  1 - LEMI-0501 Lixeira Embutida de Cozinha Inox Redonda 5 Litros (Mizu Grafite Fosca)
  ```
  Padrão de linha: `<quantidade> - <SKU> <descrição>`. Empresas delimitadas por `*NOME*`.
- O código de barras do produto (EAN) é DIFERENTE do SKU. O usuário consegue exportar da plataforma de e-commerce uma planilha com SKU + código de barras.
- Quantidades > 1 existem (cada unidade deve ser bipada individualmente).
- Internet estável no local, mas o app deve continuar funcionando se o sinal oscilar durante a conferência.
- Usuário único. Sem necessidade de login ou sincronização entre aparelhos (por ora).

## Abordagem escolhida

**Opção A — App web estático instalável (PWA-like) no iPhone.**
- 100% client-side: HTML/CSS/JS, sem backend.
- Hospedagem estática gratuita com HTTPS (ex: GitHub Pages ou Vercel).
- Dados persistidos em `localStorage` do navegador do celular (cadastro de produtos, conferência em andamento, histórico).
- Leitura de código de barras pela câmera com biblioteca compatível com iOS Safari (ex: `html5-qrcode` ou `zxing-js` via getUserMedia). Formatos: EAN-13, EAN-8, Code 128, Code 39, UPC.

Alternativas descartadas:
- Opção B (backend/nuvem): exagero para usuário único; possível evolução futura.
- Opção C (app pronto de mercado): não lê o formato do WhatsApp nem separa por empresa.

## Telas

1. **Nova conferência**: textarea para colar a mensagem do WhatsApp + botão "Montar checklist". Parser monta a lista agrupada por empresa.
2. **Conferência (principal)**:
   - Abas por empresa (ex: FERCRIS 4/13 | CERCAL 0/24) com progresso.
   - Área da câmera (scanner) ativável por botão.
   - Feedback por bipe: flash verde + som de confirmação (item ok) ou flash vermelho + som de erro. iOS Safari não suporta vibração via web — feedback é visual + sonoro.
   - Lista de itens abaixo do scanner: riscados quando completos, contador de unidades (ex: 1/2) quando parciais.
   - Toque no item permite marcar/desmarcar manualmente (fallback para etiqueta ilegível e para desfazer bipe errado).
3. **Resumo**: totais de conferidos/faltando, lista dos itens faltantes (com empresa e quantidade restante), itens bipados a mais, botão salvar no histórico.
4. **Cadastro** (configuração, uso esporádico): importar planilha/CSV com colunas SKU + código de barras. Importações subsequentes mesclam sem apagar associações manuais criadas em campo.
5. **Histórico**: lista de conferências passadas (data, empresa, totais, faltantes).

## Fluxo de bipagem (lógica)

1. Scanner lê código de barras → busca no cadastro EAN→SKU.
2. **EAN encontrado e SKU está na lista da aba ativa com unidades restantes** → decrementa 1 unidade, flash verde + som ok.
3. **EAN encontrado mas SKU está na lista da OUTRA empresa** → alerta com opção de marcar direto na empresa correta.
4. **EAN encontrado mas SKU já completou a quantidade** → flash vermelho, aviso "já conferiu todas as unidades deste item".
5. **EAN encontrado mas SKU não está na lista do dia** → flash vermelho, aviso "produto não está na lista de hoje".
6. **EAN não encontrado no cadastro** → diálogo "este código é de qual produto da lista?" com a lista de SKUs pendentes; ao selecionar, associa EAN↔SKU permanentemente no cadastro e marca a unidade.
7. Debounce: o mesmo código lido em sequência rápida (leituras duplicadas do scanner) conta uma vez só; nova contagem exige confirmação ou intervalo mínimo (~2s).

## Dados (localStorage)

- `catalogo`: mapa EAN → SKU (+ descrição opcional). Origem: importação de planilha + associações manuais.
- `conferenciaAtual`: lista do dia parseada, com estado por item (quantidade esperada, quantidade bipada, marcações manuais), agrupada por empresa. Persistida a cada bipe (sobrevive a fechar/reabrir o app).
- `historico`: array de conferências finalizadas (data, empresas, itens, resultado).

## Parser da lista do WhatsApp

- Linha `*NOME*` (ou variações com espaços) → inicia grupo de empresa.
- Linha `<n> - <SKU> <descrição>` → item: quantidade `n`, SKU = primeiro token após o hífen, resto = descrição.
- Linhas vazias ou não reconhecidas são ignoradas; itens não parseados são mostrados ao usuário para conferência antes de iniciar.
- Se o mesmo SKU repetir dentro da mesma empresa, as quantidades são somadas.

## Tratamento de erros

- Colagem sem nenhuma linha reconhecida → mensagem clara pedindo para verificar o texto.
- Permissão de câmera negada → instrução de como habilitar no Safari + fallback de digitação manual do código.
- Import de planilha sem colunas reconhecíveis → pedir para o usuário indicar quais colunas são SKU e código de barras.
- Iniciar nova conferência com uma em andamento → confirmar antes de descartar.

## Testes

- Testes unitários do parser (formato real fornecido pelo usuário, com acentos, parênteses, SKUs com hífen e sufixos como `AMAX-0601-DD`).
- Testes da lógica de bipagem (casos 2–7 acima).
- Teste manual no iPhone real: permissão de câmera, leitura de EAN-13 em etiqueta física, comportamento offline após carregado.

## Fora de escopo (por ora)

- Backend/sincronização em nuvem.
- Multiusuário/login.
- Envio automático do resumo por WhatsApp (o resumo fica na tela; compartilhar é manual).
- Integração direta com a plataforma de e-commerce.
