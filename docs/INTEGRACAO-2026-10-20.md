# Integração iPlex Control ↔ Web ↔ App — 20/10/2026

Escopo: os três repositórios (`aliens_syndicate_iplex_control`,
`aliens-syndicate-iplex-web`, `aliens-syndicate-iplex-app`) e o backend
Firebase `iplex-2c8fc` (código no Control). **Nada foi publicado, commitado ou
enviado (push).** Contratos v1: `aliens_syndicate_iplex_control/docs/CONTRACTS.md`.

## 1. Diagnóstico inicial (auditoria)

| Ponto | Encontrado |
|---|---|
| Produção | `manager` de 18/10 (geração anterior); **sem `player`**; `iplexWebTmdb` e Hosting publicados. O Web publicado depende da `player` → na TV mostra "Servidor desatualizado" |
| Backend local (Control) | Já tinha `player` sem App Check, `credentialVersion`, anti-repetição, cotas (trabalho não commitado de sessão anterior, preservado) |
| PIN de perfil | Inexistente no backend: adultos bloqueados na TV com perfil infantil (falha fechada) |
| Control | Tinha **controle remoto** (setas/OK/voltar/play-pausa) — contraria a regra do produto; não havia "assistir na TV" |
| Desvinculação | TV só percebia no heartbeat (até 30 s); token não era revogado |
| EPG | Recusado para TVs |
| Bugs | Favoritar pelo Control sempre rejeitado (sem `generation`); primeira família aceita não virava contexto ativo |
| Linha de base | Web 146, App 85, backend 79 + 13 regras + 57 integração, Flutter 231 — todos verdes |

## 2. Matriz final

| Área | Control | Web | App | Status |
|---|---|---|---|---|
| Autenticação | Google/Apple implementados; nesta etapa só login de teste do emulador | Credencial de dispositivo (custom token, `checkRevoked`, `credentialVersion`) | Só dica (`installationId`) | **Parcial** — TV validada; OAuth real do Control não executado (conta/aparelho reais) |
| Pareamento | Código manual/QR (`inspectPairingSession`/`linkDevice`) | Código + QR, expiração, novo código | Ponte entrega modelo | **Concluído e validado** — navegador e Samsung física |
| Perfis | Gestão (inalterada) | Único→direto, último infantil→direto, último adulto→seleção | — | **Concluído e validado** — navegador; visitante por testes de integração |
| Controle parental | Tela Família › Controle parental (definir/alterar/remover PIN) | PIN validado no backend, tentativas restantes, bloqueio | — | **Concluído e validado** — backend + TV no navegador; tela do Control em teste de widget |
| Assinaturas | Direito de reprodução (checkout desligado por decisão) | "Assinatura inativa" distinta de IPTV; retomada | — | **Concluído e validado** — expirada→bloqueio em 4 s, trial→retomada; celular recebe `subscription-required` |
| IPTV | Fontes (CRUD já existente) | Catálogo, categorias, canais/filmes/séries | AVPlay | **Parcial** — cadeia validada com M3U de streams públicos pelo pipeline real; provedor IPTV real/Xtream sem fonte autorizada disponível |
| TMDB | — | Metadados pt-BR, pôster/backdrop, elenco | — | **Concluído e validado** — `iplexWebTmdb` → `authorizeMetadata`: match Sintel (2010) pt-BR; troca de id 403; sem token 401; canal 403 |
| Busca | Home: busca por fonte | Busca (testes) | — | **Concluído e validado** |
| Iniciar na TV pelo celular | "Assistir na TV": TV, episódio, status ao vivo | Ouvinte + claim + confirmação + resultado | AVPlay pela ponte | **Concluído e validado** — Control no simulador → TV no navegador; script → Samsung física |
| Reprodução | — | Clappr (navegador) | AVPlay (Samsung) | **Concluído e validado** — Clappr/hls.js avançando; AVPlay `player.open` + `started`; Sintel/Bitmovin `format-unsupported` no AVPlay |
| Sessões simultâneas | — | Lease 90 s/heartbeat 30 s | — | **Concluído e validado** — testes de integração (3 por família, 1 por perfil); `profile-in-use` observado no E2E; expiração do lease após fechar a TV observada |
| Desvinculação | `deleteDevice` + revogação | Volta à vinculação | `player.stop` | **Concluído e validado** — navegador ~3 s; Samsung com AVPlay tocando: 0,9 s |
| Recuperação de erros | Mensagens específicas por código | Estados próprios | Telas T1–T9 | **Parcial** — validados: fonte offline, assinatura vencida/retomada, lease expirado, app reiniciado, credencial revogada. Só por testes unitários: sem internet, Firebase/TMDB indisponíveis |
| Identidade visual | Componentes existentes do Control | Novos aviso e diálogo usam tokens oficiais | Inalterado | **Parcial** — sem nova medição tipográfica na TV nesta etapa (a anterior mediu escala idêntica) |
| Compatibilidade Samsung | — | Bundle legado + ouvinte Firestore no Chromium 69 | Tizen 5.5 | **Concluído e validado** (UN65TU7020GXZD, Tizen 5.5). Tizen 4.0: sem aparelho |

## 3. Evidências do E2E (emuladores com as duas codebases)

Ambiente: Firebase Emulators (`manager`, `player`, gatilhos IPTV,
`iplexWebTmdb`), fonte M3U processada pelo pipeline real, Web em
`vite --mode emulator` (navegador 1920×1080) e build legado na Samsung,
"celular" pelo script `functions/scripts/e2e_tv.ts` (callable real + regras)
e pelo **Control no iPhone 17 Pro Simulator**.

| Fluxo | Resultado medido |
|---|---|
| A — Primeiro acesso | TV pediu código → `link` → credencial → perfis da `player` (navegador e Samsung) |
| B — IPTV | `saveSource` (M3U, 5–6 itens) → sync pelo gatilho → catálogo na TV → reprodução |
| C — TMDB | Destaque com imagem TMDB; Function protegida: 200/403/401 como esperado |
| D — Infantil | PIN errado: "Restam 4 tentativas"; certo: entra. Perfil infantil vê só "Big Buck Bunny" (L); pedido adulto do celular → `content-not-allowed`, nada chega à TV |
| E — Celular → TV | `delivered` 0,1 s → `started` 1,8 s (navegador) / 3,0 s (Samsung, AVPlay). Com reprodução: `confirming` → "Continuar" = `declined/busy`; "Assistir agora" = `started`; sem resposta = `declined/no-answer` (Samsung, 40 s). Control (UI): "Reproduzindo em iPlex Web (navegador)."; TV sem perfil → "Abra o iPlex na TV e escolha um perfil…" |
| F — Assinatura | Vencida → "Assinatura inativa" (4,3 s); trial → "Verificar novamente" retoma sem pedir PIN de novo |
| G — Sessões | `profile-in-use` ao excluir perfil em uso; lease liberado sozinho após fechar a TV |
| H — Desvinculação | Navegador: 24 s antes da correção → ~3 s depois; Samsung tocando: `player.stop` + novo código em 0,9 s |
| I — Recuperação | Fonte offline → `failed/playback-failed` em 0,9 s no celular; reload/reabertura mantém credencial; adulto pede PIN após sair |

## 4. Problemas corrigidos nesta etapa

1. PIN parental validado no backend (antes inexistente).
2. Controle remoto removido do Control (contrariava o produto).
3. "Assistir na TV" ponta a ponta (backend, Control, Web).
4. Desvinculação refletida na TV em ~1 s (marcador + revogação de token).
5. EPG liberado para TVs.
6. Favorito pelo Control enviava sem `generation` (sempre rejeitado).
7. Primeira família aceita não virava contexto ativo; o Control também não a listava (conta presa).
8. Tela de erro do Clappr ficava no DOM por baixo da do iPlex.
9. Pedido do celular com o player em erro exigia confirmação (agora só com reprodução real).
10. `claimPlayRequest`/`updatePlayRequest` passaram a exigir a credencial atual dentro da transação.

## 5. Arquivos alterados

**Control** — backend: `functions/src/{parental.ts (novo), play_requests.ts (novo), service.ts, iptv_catalog_access.ts, iptv_sources.ts, family_membership.ts}`; preservados e mantidos da sessão anterior: `player.ts`, `index.ts`; `firestore.rules`, `firestore.indexes.json`; testes `functions/test/{parental_play_requests.integration.ts (novo), security.rules.ts, flows.integration.ts, free_manager.integration.ts, player.test.ts}`; ferramenta `functions/scripts/e2e_tv.ts` (nova). App: `lib/features/watch_on_tv/watch_on_tv_sheet.dart` (novo), `lib/features/manager/{parental_control_page.dart (novo), catalog_page.dart, users_page.dart, family_page.dart, detail_page.dart}`, `lib/features/devices/presentation/pages/device_detail_page.dart`, `lib/app/router.dart`, `lib/core/{domain/models.dart, data/firebase_repository.dart, design_system/feedback/failure_feedback.dart}`, `lib/l10n/*` (pt/en/es), removidos `lib/features/remote_control/*`; testes `test/watch_on_tv_test.dart` (novo), `test/{widget_test,visual_test}.dart`. Docs: `docs/CONTRACTS.md` (novo), `docs/STATUS.md`, skill `iplex-e2e-validation`.

**Web** — `src/services/api/{types,backend,errors,validation (novo)}.ts`, `src/services/firebase/{firebaseBackend.ts, playRequestListener.ts (novo)}`, `src/services/session/leaseManager.ts`, `src/app/{App.tsx, providers/SessionProvider.tsx}`, `src/features/remote/{PlayRequestCoordinator.tsx, playRequestReport.ts}` (novos), `src/features/playback/PlayerScreen.tsx`, `src/features/profiles/profileRules.ts`, `src/components/{dialogs/PinDialog.tsx, feedback/errorCopy.ts}`, `src/platform/playback/clapprAdapter.ts`, `src/dev/mock/mockBackend.ts`, `src/styles/app.css`; testes `src/test/remote.test.tsx`, `src/services/api/validation.test.ts` (novos), `leaseManager.test.ts`, `profileRules.test.ts`; `.claude/launch.json`; docs `ARQUITETURA.md`, `DECISOES.md`, `PENDENCIAS.md`, este relatório.

**App** — só `docs/TIZEN.md` (resultados na Samsung). Shell e ponte sem alteração.

Não alterados por esta sessão (alterações de outra sessão, preservadas):
Control `lib/app/bottom_navigation.dart`, `test/payments_checkout_test.dart`,
`docs/screenshots/*.png`; App `CLAUDE.md`, `docs/DESIGN-SYSTEM.md`.

## 6. Testes e builds

| Projeto | Execução final |
|---|---|
| Backend | `npm run check`: 79 ok · regras: 14 ok · integração: 62 ok (emuladores) |
| Control | `flutter analyze`: sem problemas · `flutter test`: 235 ok · `flutter run` no iPhone 17 Pro Simulator (debug, emuladores) |
| Web | `vitest`: 163 ok · `tsc -b` · ESLint 0 erros · `npm run build` + `verify-build` ok (CSP inalterada) · build legado `--mode emulator` |
| App | `vitest`: 85 ok · `tsc -b` · `.wgt` assinado `iplex-tv` (development, depois production reinstalado) |

## 7. Pendências

Ver `PENDENCIAS.md`. Principais: publicação (exige autorização), provedor
IPTV real/Xtream, OAuth real do Control, fontes protegidas por PIN na TV,
teclas físicas e confirmação pelo controle remoto na Samsung, Tizen 4.0,
falhas de infraestrutura só cobertas por testes unitários, formatos HLS com
múltiplos grupos de mídia no AVPlay.

## 8. Riscos de produção

1. **Famílias com perfil infantil**: após publicar o backend, adultos só
   entram na TV com PIN parental — o administrador precisa do Control novo
   para definir o PIN. Publicar o Control antes (ou junto).
2. `manager`/`player` passam de 256 MiB para 1 GiB (custo por instância).
3. `issuedAt` ±2 min: TV com relógio errado não executa ações sensíveis.
4. Ouvinte Firestore na TV: +1 conexão por TV pareada (custo de leituras
   baixo — só pedidos pendentes) e chunk de ~136 KB gzip.
5. Regras: leitura direta de perfis/biblioteca pela TV foi fechada (o Web novo
   usa a `player`); Webs antigos em cache deixam de ler esses dados.
6. Controle remoto removido: builds antigos do Control recebem `invalid-action`
   ao usar a tela de controle.
7. Política de transição e PIN único por família são propostas (DECISOES.md).

## 9. Implantação coordenada (somente com autorização)

0. Backup: `gcloud firestore export gs://<bucket>/backup-AAAAMMDD --project iplex-2c8fc`; anotar versões (`firebase functions:list`, release atual do Hosting); commit/tag dos três repositórios.
1. Control para testadores (Play interno) com a tela de PIN parental.
2. Firestore (Control): `firebase deploy --only firestore --project iplex-2c8fc` (regras + índices + TTL de `play_requests`, sessões, códigos, `player_requests`).
3. Functions (Control): `firebase deploy --only functions:iplex-gestor --project iplex-2c8fc` (`manager`, `player`, gatilhos; segredo `IPTV_CREDENTIAL_KEY` já existe).
4. Function do Web: `firebase deploy --only functions:iplex-web --project iplex-2c8fc`.
5. Hosting: `firebase hosting:channel:deploy preview --expires 7d` → `npm run tv -- --target <url do preview>` na Samsung → `firebase deploy --only hosting`.
6. Validar na Samsung (`npm run tv`) e acompanhar logs (`player`, `requestPlayback`, `verifyProfilePin`).

## 10. Rollback

- Hosting: `firebase hosting:rollback --project iplex-2c8fc` (volta ao release anterior).
- Functions: redeploy do commit anterior do Control (`0063dd6`) com `--only functions:iplex-gestor`; a `player` não existia — remover com `firebase functions:delete player --region us-central1` se necessário. `iplexWebTmdb`: redeploy do commit `8ace0cb` do Web.
- Regras/índices: redeploy dos arquivos do commit anterior (`--only firestore`). Políticas de TTL podem permanecer.
- Dados: tudo aditivo (`parental`, `private/parental`, `play_requests`, `pinUnlock`/`pinSession`, `pendingPlayRequest`); código anterior ignora esses campos. Nenhuma migração.
