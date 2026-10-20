# Auditoria — App Check e o iPlex Web na TV (20/10/2026)

Escopo: por que o iPlex Web não funciona no Samsung Tizen 5.5 com App Check e
qual arquitetura permite ao Web na TV falar com o backend sem reCAPTCHA e sem
enfraquecer o App Check do iPlex Gestor. **Nenhum código foi alterado e nada
foi publicado a partir desta auditoria.**

## 0. Evidência na TV (UN65TU7020, Tizen 5.5, Chromium 69)

Coletada com o canal de diagnóstico (`?diag=1`, relatório do Player no Mac):

| Execução | Resultado |
|---|---|
| reCAPTCHA sem ajuste | `recaptcha__pt_br.js`: *Failed to execute 'postMessage' on 'Window': Invalid target origin '[object MessagePort]'* — o script usa `postMessage(msg, [porta])` (forma de objeto, Chromium 81+). Iframe do reCAPTCHA solto sobre a tela (estilos inline bloqueados pela CSP) e App Check sem token. |
| Shim global de `postMessage` | Quebra a ponte: no Chromium 69 a chamada do shell ao iframe passa pela função substituta e a resposta chega com a origem do próprio Web (`fromParent=false`) → "Falha na comunicação com a TV". |
| Shim só durante o carregamento do reCAPTCHA | Ponte OK, tela de vinculação OK, iframe do reCAPTCHA carregado — e o app inteiro fecha ~5 s depois (`launcher-visibility hidden` → `launcher-pagehide`). Sem reCAPTCHA o app permanece aberto. |

Conclusão: o reCAPTCHA Enterprise é incompatível com o Tizen 5.5 e não deve
ser inicializado na TV.

> Estado atual em produção: o Web publicado ainda inicializa o reCAPTCHA. Na
> TV isso fecha o app. Corrigir exige um novo deploy (não feito, aguardando
> autorização).

## 1. Serviços Firebase usados pelo Web e exigência de App Check

| Serviço | Uso pelo Web | App Check hoje |
|---|---|---|
| Cloud Functions — callable `manager` (Gestor) | Pareamento, perfis, sessão (lease), catálogo, stream, favoritos, progresso | **Exigido no código** (`enforceAppCheck: true`) |
| Cloud Functions — `iplexWebTmdb` (codebase `iplex-web`) | Metadados TMDB | **Exigido no código** (verificação manual do cabeçalho), além do ID token de dispositivo |
| Firebase Auth (Identity Toolkit / Secure Token) | `signInWithCustomToken`, renovação do ID token | `UNENFORCED` |
| Cloud Firestore (lite, leitura) | Biblioteca do perfil; perfis (fallback do backend antigo) | `UNENFORCED` (as regras exigem credencial de dispositivo) |
| Storage, Realtime Database, OAuth | Não usados pelo Web | `UNENFORCED` |
| Hosting | Entrega do Web | não se aplica |

As demais Functions do Gestor (`synchronizeCatalogs`, `processIptvSyncJobTrigger`
etc.) são agendadas/gatilhos, sem chamada do Web.

## 2. Chamadas do navegador Tizen

Diretas do navegador (sem Function intermediária):
- Auth: `identitytoolkit.googleapis.com` (custom token) e `securetoken.googleapis.com` (renovação);
- Firestore REST: `families/{fid}/profiles/{pid}` e subcoleções `favorites`, `watch_progress`, `watched`;
- streams IPTV (AVPlay pela ponte; URL obtida do backend);
- imagens TMDB (`image.tmdb.org`), públicas;
- App Check/reCAPTCHA (`content-firebaseappcheck.googleapis.com`, `www.google.com/recaptcha`) — a remover na TV.

Por Cloud Functions:
- `manager`: `beginDevicePair`, `finishDevicePair`, `listPlayerProfiles`*, `acquireSession`, `heartbeat`, `releaseSession`, `listProfileSpaces`*, `readSourceCatalog`, `readSourceSeries`, `resolveSourceStream`, `readSourceEpg`, `favorite`, `watchProgress`, `markWatched`* (*ausentes na versão publicada em 18/10);
- `/api/tmdb/*` → `iplexWebTmdb`.

## 3. O que pode ser protegido por credencial de dispositivo

| Operação | Credencial possível | Observação |
|---|---|---|
| Perfis, lease (acquire/heartbeat/release), catálogo, séries, stream, EPG, favoritos, progresso, assistidos | **ID token do dispositivo** (uid `tv_<deviceId>`, claims `deviceId`/`familyId`) + lease ativo + autorização por perfil no backend | Já é assim no `manager`: `player()` exige a credencial, o documento do dispositivo e a família não excluída. Revogação: excluir o dispositivo/usuário `tv_*` |
| Leitura da biblioteca (Firestore) | ID token do dispositivo + regras (`isFamilyPlayer`) | Já funciona sem App Check |
| TMDB | ID token do dispositivo (já exigido, com `checkRevoked`) | App Check é redundante para a TV |
| `beginDevicePair` | **Nenhuma** (o dispositivo ainda não tem credencial) | Só limitação de abuso (cotas, TTL curto, limpeza) |
| `finishDevicePair` | Token de pareamento de 256 bits, de uso único, válido 5 min, **só após confirmação do administrador autenticado no Gestor** | É a âncora de confiança do dispositivo |

Sessão curta: ID token de 1 h (renovação pelo refresh token), lease de 90 s
com heartbeat, revalidação de assinatura/permissões a cada chamada.

## 4. Fluxo TV → backend sem reCAPTCHA

Sim, é possível, **sem distribuir tokens de App Check**: a TV não usa App
Check. A confiança vem da credencial do dispositivo, emitida somente depois de
um administrador da família, autenticado no Gestor (que continua com App
Check), confirmar o pareamento. Para isso a TV precisa de um ponto de entrada
que **não** exija App Check, mas exija credencial de dispositivo:

```
TV (sem App Check)
 ├─ pareamento ──▶ callable `player` (enforceAppCheck: false)
 │                 · beginDevicePair: cotas e TTL; nenhum dado sensível
 │                 · finishDevicePair: token de 256 bits, uso único, confirmado no Gestor
 ├─ demais ações ─▶ callable `player`: SÓ ID token com claims de dispositivo,
 │                  lista fechada de ações de Player, mesma lógica do `manager`
 ├─ Firestore ───▶ regras atuais (isFamilyPlayer)
 └─ TMDB ────────▶ `iplexWebTmdb`: ID token de dispositivo; App Check opcional
Gestor (App Check obrigatório) ──▶ `manager` inalterado
```

## 5. Mudanças necessárias e impactos

**Repositório do Gestor (backend compartilhado — exige sua autorização):**
1. Nova callable `player` (`enforceAppCheck: false`) no codebase `iplex-gestor`,
   reutilizando `execute()` com uma **lista fechada** de ações de Player e
   recusando qualquer chamada sem claims `deviceId`/`familyId` (exceto
   `beginDevicePair`/`finishDevicePair`). Duplicar essa lógica no codebase
   `iplex-web` não é recomendado: seriam duas fontes de verdade para
   assinatura, lease e permissões infantis.
2. `beginDevicePair` na `player`: cotas por janela (global e por origem de rede
   apenas como **limitação**, não como prova), TTL de 5 min (já existe) e
   limpeza por TTL do Firestore.
3. `verifyIdToken(..., checkRevoked)` nas ações de Player (revogação imediata).
4. Testes no emulador: chamada sem credencial de dispositivo, credencial de
   pessoa, ação fora da lista, dispositivo revogado, pareamento expirado.

Impactos no Gestor: o app e a callable `manager` não mudam; a política de App
Check do projeto continua a mesma. **Atenção:** o código local do Gestor é
mais novo que o publicado (listagem de perfis/fontes, tipos de perfil). Publicar
o codebase `iplex-gestor` publica também essas mudanças: precisa de revisão do
responsável pelo Gestor.

**Repositório iplex-web (este):**
1. Não inicializar App Check/reCAPTCHA no Tizen/webOS; usar a `player`.
2. Decidir o navegador desktop: usar também a `player` (e remover o reCAPTCHA
   do projeto) ou manter reCAPTCHA + `manager` só no desktop.
3. `iplexWebTmdb`: aceitar ID token de dispositivo sem App Check na TV.
4. Diagnóstico `?diag=1`: manter (inerte sem o parâmetro) ou remover.

**Políticas de App Check:** nenhuma alteração. Firestore/Auth/Storage seguem
`UNENFORCED`. Se um dia forem impostos, as leituras diretas da TV (Auth e
Firestore) quebram — nesse caso a biblioteca passa a ser servida pela `player`.

## 6. Atestação no Samsung Tizen

Não foi encontrado mecanismo confiável de atestação remota disponível a apps
web de TV Tizen:
- **Knox Attestation** existe para o Knox SDK for Tizen (apps de gestão de
  dispositivos, API nativa `knox_attestation_get_attestation_blob` + servidor
  de atestação Samsung), não para apps web de Smart TV distribuídos na loja.
- **Assinatura do widget** (autor/distribuidor) é verificada localmente pela TV
  na instalação; não gera prova verificável pelo backend.
- **DUID, installationId, User-Agent, IP**: identificadores, não atestação
  (descartados, conforme pedido).
- **Firebase App Check custom provider** exige uma prova de autenticidade que o
  cliente não tem na TV; sem ela, viraria distribuição de tokens (descartado).

Recomendação: validar com o suporte de parceiros Samsung se existe atestação
para apps de TV da loja; até lá, a segurança da TV se apoia na credencial do
dispositivo emitida após confirmação humana no Gestor.

## Riscos

| Risco | Mitigação |
|---|---|
| Spam de `beginDevicePair` sem App Check | Cotas, TTL de 5 min, limpeza, monitoramento/alerta de volume |
| Pareamento por engenharia social (administrador lê QR de terceiro) | Já existente hoje; o Gestor mostra nome/modelo antes de confirmar |
| Furto da credencial do dispositivo (refresh token no armazenamento do iframe) | Revogação no Gestor (desvincular), `checkRevoked`, lease curto |
| Abuso de quem extrai o ID token de uma TV | Autorização por família/perfil/assinatura em cada chamada; limite de 3 sessões |
| Divergência de lógica entre `manager` e `player` | Mesmo `execute()`, lista fechada, testes |
| Publicar o backend local do Gestor junto | Revisão do responsável pelo Gestor antes do deploy |

## Plano de implementação (após aprovação)

1. **Mitigação imediata (deploy do Web):** não carregar reCAPTCHA no Tizen; a TV
   mostra "Servidor do iPlex precisa de atualização" em vez de fechar.
2. **Gestor (com autorização):** callable `player` + testes no emulador; revisão
   do responsável; deploy do codebase `iplex-gestor`.
3. **Web:** adaptador para a `player`; TMDB por credencial de dispositivo;
   decisão sobre o desktop; remoção do reCAPTCHA se aplicável.
4. **Validação na TV** (`npm run tv -- --env production`) e monitoramento.

Fontes: [Knox SDK for Tizen — Attestation](https://docs.samsungknox.com/dev/knox-tizen-sdk/tutorials/develop-mdm-app/attestation-feature/),
[Samsung Smart TV Web API References](https://developer.samsung.com/smarttv/develop/api-references/web-api-references.html),
[Firebase App Check — custom provider](https://firebase.google.com/docs/app-check/custom-provider).

---

# Implementação (local, 20/10/2026) — sem deploy, commit ou push

## Backend (repositório do Gestor)

- `functions/src/player.ts` (novo) + export `player` em `functions/src/index.ts`
  (`enforceAppCheck: false`). O `manager` não mudou de política (App Check
  continua obrigatório); só passou a usar o mesmo mapeamento de erros.
- Lista fechada: `beginDevicePair`/`finishDevicePair` (sem credencial, com cotas
  global e por rede, payload ≤ 4 KB) e ações de Player (credencial obrigatória).
- Credencial: ID token verificado no servidor com `verifyIdToken(…, true)`
  (revogação); identidade só das claims (`tv_<deviceId>`, `deviceId`,
  `familyId`, `credentialVersion`, provedor `custom`). Corpo da requisição nunca
  identifica a TV.
- Revogação: `credentialVersion` nova a cada `linkDevice`; desvincular ou
  re-parear invalida credenciais antigas na hora (`device-revoked`).
- Anti-repetição: ações que mudam estado exigem `requestId` (128 bits, uso
  único, `player_requests` com TTL) e `issuedAt` (±2 min).
- Cotas por dispositivo (600/min) e por rede no pré-pareamento (rede só reparte
  cotas; nunca é prova de identidade).
- Firestore: leituras diretas do Player fechadas nas regras; biblioteca e
  gerações servidas pela `player` (`readPlayerLibrary`, `readPlayerGenerations`)
  com filtro de itens visíveis ao perfil (controle parental).
- TMDB: `authorizeMetadata` só libera metadados de itens do catálogo visíveis ao
  perfil do lease; `iplexWebTmdb` delega essa autorização à `player` com a
  credencial da TV.
- TTL (Firestore) para sessões de pareamento, códigos, cotas e `player_requests`.

## iPlex Web

- Sem App Check/reCAPTCHA em nenhum ambiente; todas as chamadas pela `player`.
- CSP sem origens do Google; `frame-src 'none'`.
- Erros: `device-required`/`device-revoked` → dispositivo desvinculado;
  `player` ausente → "Servidor do iPlex desatualizado"; o sufixo `[400]` que o
  SDK do Firebase v13 acrescenta à mensagem é ignorado (bug encontrado na TV).
- Tipografia: escala única em `rem` (16px em 1920), valores da referência
  oficial; Google Sans carregada e verificada antes da montagem (sem FOUT).

## Evidência na Samsung UN65TU7020 (Tizen 5.5), contra os Emulators

| Cenário | Resultado |
|---|---|
| Abertura | Sem reCAPTCHA (`iframes=[]`), app aberto por mais de 2 min |
| Google Sans | `typography: ok` em 37–65 ms, antes da montagem |
| Pareamento | `beginDevicePair` → confirmação pelo Gestor (manager) → `finishDevicePair` → credencial |
| Perfis/sessão | `listPlayerProfiles`, `acquireSession`, `listProfileSpaces`, biblioteca, heartbeat OK |
| Assinatura inativa | Heartbeat → `subscription-required` → tela "Assinatura inativa" |
| Desvinculação | Heartbeat → `device-revoked` → volta à vinculação com novo código |
| Métricas 1920×1080 | Iguais ao navegador desktop (tamanhos, pesos, larguras) |

Não validado no aparelho: catálogo com fonte IPTV real, TMDB, reprodução AVPlay
com a `player` (emulador sem fontes), PIN de perfil adulto (backend ainda sem
validação de PIN: falha fechada) e o backend publicado de verdade.
