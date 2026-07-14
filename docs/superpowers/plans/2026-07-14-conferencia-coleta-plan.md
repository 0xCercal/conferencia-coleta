# Conferência de Coleta — Plano de Implementação

Spec: `docs/superpowers/specs/2026-07-14-conferencia-coleta-design.md`

## Stack

- App web estático, sem build: HTML + CSS + JS (ES modules).
- Leitura de código de barras: `html5-qrcode` 2.3.8 (via cdnjs) — compatível com iOS Safari.
- Leitura de planilhas (.xlsx/.csv): SheetJS `xlsx` 0.18.5 (via cdnjs).
- Persistência: `localStorage` (chaves `cc_catalogo`, `cc_conferencia`, `cc_historico`).
- Testes: `node --test` para parser e lógica de bipagem (módulos puros, sem DOM).

## Estrutura de arquivos

```
conferencia-coleta/
  index.html          # shell do app, 4 telas + modais
  css/style.css       # mobile-first, safe areas do iPhone
  js/parser.js        # parser da lista do WhatsApp (puro)
  js/logic.js         # lógica de conferência/bipagem (pura)
  js/app.js           # UI, storage, scanner, importação
  manifest.webmanifest
  sw.js               # cache do shell para resiliência offline
  tests/*.test.mjs
  package.json        # type: module + script de teste
```

## Etapas

1. Parser da lista (`parser.js`) + testes com a mensagem real de exemplo.
2. Lógica de bipagem (`logic.js`) + testes dos 7 cenários da spec.
3. Shell do app (`index.html` + `style.css`): navegação inferior, 4 telas.
4. Tela Nova conferência (colar → parsear → revisar não reconhecidos → iniciar).
5. Tela Conferência: abas por empresa, lista, marcação manual (+1/−1/tudo/zerar), feedback visual/sonoro.
6. Scanner com câmera (html5-qrcode), debounce de 2,5 s, diálogo de código desconhecido.
7. Tela Cadastro: importar .xlsx/.csv com mapeamento de colunas + colar texto SKU/EAN; mesclagem preservando associações manuais.
8. Resumo + salvar no Histórico; tela Histórico.
9. PWA mínimo: manifest + service worker.
10. Verificação no navegador (parser, checklist, entrada manual de código, resumo, histórico).
11. Hospedagem HTTPS: decidir com o usuário (GitHub Pages ou Vercel) — necessário para a câmera no iPhone.
