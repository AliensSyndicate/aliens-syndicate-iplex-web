# Pendências

Atualizado em 20/10/2026 após a integração Control ↔ Web ↔ App
([INTEGRACAO-2026-10-20.md](INTEGRACAO-2026-10-20.md)). Contratos v1:
`aliens_syndicate_iplex_control/docs/CONTRACTS.md`. Nada foi publicado.

## Situação em produção (20/10/2026, inalterada por esta etapa)

| Item | Estado |
|---|---|
| Hosting `https://iplex-2c8fc.web.app/` | Publicado, mas **anterior** ao código local (sem pedidos do Control, sem PIN real, sem EPG) |
| Callable `player` | **Não publicada**: o Web publicado mostra "Servidor do iPlex desatualizado" na TV |
| Callable `manager` | Publicada em 18/10/2026 (geração anterior: sem `listPlayerProfiles`, `listProfileSpaces`, tipos de perfil, PIN parental, pedidos de reprodução) |
| Function `iplexWebTmdb` | Publicada (versão anterior à delegação para `player.authorizeMetadata`) |
| App Check | Não usado pelo Web (incompatível com Tizen 5.5); obrigatório no `manager` |

Publicar exige autorização explícita e a ordem do plano de implantação
coordenada (relatório de integração, seção "Implantação").

## Resolvido nesta etapa (local, validado)

- PIN parental validado no backend (antes: adultos bloqueados por falta de validação).
- EPG para TVs (`readSourceEpg` na `player`).
- Pedidos de reprodução do iPlex Control (busca no celular → TV).
- Desvinculação refletida na TV em ~1 s (antes: até 30 s, no heartbeat).
- Tela de erro do Clappr não fica mais no DOM por baixo da do iPlex.

## Backend (repositório do Control/Gestor)

| # | Pendência | Efeito atual no Web |
|---|---|---|
| 1 | `readSourceCatalog` sem filtro por tipo/categoria e sem lookup por id | Filtragem no cliente; detalhes localizam o item pela busca de título |
| 2 | Logotipos/pôsteres da fonte: o catálogo guarda só hash da imagem | Canais com iniciais; filmes/séries dependem do TMDB |
| 3 | Fontes protegidas por PIN: `verifySourcePin` não atende dispositivos | "Fonte protegida" na TV; pedidos do Control recusados com `source-protected` |
| 4 | Plataforma `web` no `pairingSessionInputSchema` e no Gestor | Navegador pareia como `web` |
| 5 | Endpoint de direito de acesso (entitlement) para leitura | Assinatura só é conhecida em `acquireSession`/`heartbeat` |
| 6 | Favoritos/progresso guardam só contentId e título | Itens de outros dispositivos sem índice local não aparecem nas fileiras |
| 7 | Data de inclusão / audiência no catálogo | Sem "Adicionados recentemente" / "Em alta" |
| 8 | `issuedAt` ±2 min nas ações sensíveis | TV com relógio errado recebe `request-expired` (TVs Samsung sincronizam por rede; monitorar) |

## Shell Samsung

- Formatos: o AVPlay do Tizen 5.5 recusou o HLS do Sintel (Bitmovin, vários
  grupos de áudio/legenda) — `format-unsupported`, reportado ao celular.
  Mux e Apple bipbop tocam. Sem fallback para Clappr na Samsung (decisão vigente).
- Bundle legado: validado em Tizen 5.5 (M69); Tizen 4.0 (M56) sem aparelho.
- Teclas de mídia físicas e confirmação "Assistir agora" pelo controle remoto
  não foram pressionadas nesta etapa (sem pessoa na TV); validadas no navegador.

## Produção

1. Revisar termos/atribuição do TMDB para uso comercial (a atribuição já aparece nos detalhes).
2. Streams `http://` não tocam no navegador (página HTTPS); na TV, AVPlay.
3. As credenciais TMDB foram compartilhadas em conversa: considere gerar novas no painel do TMDB antes de produção.
4. O bundle do ouvinte Firestore (~136 KB gzip) só carrega após o pareamento; monitorar memória em TVs antigas.
