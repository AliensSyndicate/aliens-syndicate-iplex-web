# Arquitetura do iPlex Web

## Visão geral

```
iPlex Player (Tizen, AVPlay) ──iframe + ponte iplex-bridge v1──▶ iPlex Web (este repositório)
                                                                   │
                                     HTTPS (Auth + App Check)      ├──▶ callable `manager` (backend do Gestor)
                                                                   ├──▶ Firestore (leitura da biblioteca do perfil)
                                                                   └──▶ /api/tmdb/* → Function iplexWebTmdb (codebase iplex-web) → TMDB
```

- O Web é toda a interface e a orquestração. Não decide acesso: dispositivo,
  assinatura, perfil, permissões e sessões são validados pelo backend.
- O TMDB é fonte de **metadados**. A disponibilidade de reprodução vem só do
  catálogo IPTV autorizado (`readSourceCatalog`/`resolveSourceStream`).

## Estrutura

```
src/
  app/            App, layout, rotas, providers (plataforma, backend, sessão)
  components/     ui (Design System), navigation, catalog, player, feedback, dialogs
  features/       startup, pairing, profiles, my-iplex, search, live-tv, catalog,
                  movies, series, details, playback, settings
  services/       api (tipos, erros, contrato Backend), firebase, catalog, tmdb,
                  session (lease), library
  platform/       bridge (protocolo copiado do Player + cliente), playback
                  (adaptadores AVPlay/Clappr), keys, environment
  navigation/     navegação espacial por controle remoto
  dev/mock/       dados de demonstração (somente `vite dev`)
  styles/         tokens, base, componentes, layout
functions/        Cloud Function iplexWebTmdb (codebase "iplex-web") + núcleo TMDB
server/           middleware do Vite para /api/tmdb em desenvolvimento
scripts/          hosting-config (firebase.json), verify-build
```

## Inicialização (SessionProvider)

1. **Plataforma**: dentro de iframe, handshake `app.ready` (ponte v1) → `PlatformInfo`
   (capacidades, teclas, installationId). Fora: navegador. Falha do handshake =
   "Falha na comunicação com a TV" (não "sem internet").
2. **Dispositivo**: Firebase Auth persistido; exige claims `deviceId`/`familyId` e
   uid `tv_<deviceId>`. Sem credencial → vinculação.
3. **Perfis**: `listPlayerProfiles`. `device-revoked` → volta à vinculação.
4. **Decisão** (`profileRules.decideStartupProfile`): único perfil → entra;
   último perfil infantil → entra; demais → seleção. Adulto com perfil
   infantil na família → PIN (validado no backend).
5. **Sessão**: `acquireSession` (valida assinatura, limite de 3 dispositivos e 1
   por perfil). Heartbeat a cada 30 s (lease de 90 s).
6. **Fontes**: `listProfileSpaces`. Falha da fonte não bloqueia o app e nunca é
   apresentada como assinatura.

## Vinculação

`beginDevicePair` → código `XXX-XXX` + QR `iplex://pair?token=…` (gerado
localmente) → confirmação no Gestor (`linkDevice`) → a TV consulta
`finishDevicePair` com recuo exponencial (3 s → 15 s) → custom token →
`signInWithCustomToken`. As regras do Firestore não permitem ler a sessão de
pareamento, por isso não há listener.

## Catálogo

`readSourceCatalog` devolve 30 itens por página, em ordem alfabética, sem
filtro por tipo. O `CatalogStore` carrega páginas iniciais (6 por fonte) e mais
sob demanda, filtra tipo/categoria no cliente e limita a memória (60 páginas).
Detalhes e player sempre relêem o item do backend (URL direta para conteúdo
bloqueado resulta em "Conteúdo indisponível").

## TMDB

- Núcleo em `functions/src/tmdb/` (busca, correspondência, detalhes, temporadas,
  cache LRU com TTL), usado pela Function e pelo middleware de dev.
- Endpoints fechados: `/api/tmdb/match`, `/movie/:id`, `/tv/:id`, `/tv/:id/season/:n`.
- Correspondência (`matching.ts`): limpa o nome da fonte (qualidade, idioma,
  prefixos, episódio), considera ano e título original, recusa baixa confiança
  (< 0,82) e empates (margem < 0,08) como `ambiguous`. O nome original da fonte
  é preservado na resposta (`sourceTitle`).
- Produção: a Function exige ID token de dispositivo pareado e App Check.

## Reprodução

Um único adaptador por vez (`createPlaybackAdapter`):

- **Shell Samsung** (capacidade `nativePlayer`): ponte → AVPlay (`player.open`,
  eventos `player.*`). Durante a reprodução, `html.is-native-playback` deixa os
  fundos transparentes (o AVPlay desenha atrás da camada web).
- **Navegador**: Clappr (`@clappr/player`, carregado sob demanda), sem interface
  própria (`chromeless`), hls.js sem worker (CSP).

Controles iPlex: play/pausa, ±10 s e linha do tempo (só VOD), faixas de áudio e
legendas quando existirem; ao vivo sem avanço/retrocesso. Teclas de mídia só
quando o shell as registra. Progresso: perfis com biblioteca, VOD, a cada 30 s
com deslocamento mínimo de 10 s, e na pausa/saída.

## Ponte com o shell

`src/platform/bridge/protocol.ts` é cópia fiel do Player (teste compara).
O cliente valida fonte (`window.parent`), origem (lista `VITE_IPLEX_SHELL_ORIGINS`),
envelope/versão, ids pendentes (duplicadas descartadas), eventos conhecidos,
timeouts por método e desconexão (3 timeouts seguidos).

## Compatibilidade Tizen

- `@vitejs/plugin-legacy` (`chrome >= 56`): chunks SystemJS + polyfills core-js,
  mantendo o carregamento sob demanda. Os 4 scripts inline do plugin entram
  na CSP por hash (`scripts/hosting-config.mjs`).
- CSS sem `gap`, `inset`, `aspect-ratio`, grid (teste estático).
- `cssMinify: false` para preservar os tokens exatos.
