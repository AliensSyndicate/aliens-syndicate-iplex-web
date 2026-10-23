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

## PIN parental

`listPlayerProfiles` informa `pinRequired` por perfil (adulto + perfil infantil
na família). A `PinDialog` envia o PIN a `verifyProfilePin` (backend: scrypt,
5 tentativas, bloqueio de 15 min por TV) e mostra tentativas restantes. O
`acquireSession` seguinte só passa para aquele perfil. Multitarefa usa
`releaseSession {suspend: true}` e mantém a liberação; trocar de perfil ou sair
bloqueia de novo. Sem PIN definido no Control: perfil adulto bloqueado
("PIN parental não configurado").

## Pedidos de reprodução do iPlex Control

`features/remote/PlayRequestCoordinator.tsx` (contrato v1, ver
`aliens_syndicate_iplex_control/docs/CONTRACTS.md`):

1. Ouvinte Firestore somente leitura de `devices/{did}/play_requests`
   (`status in [pending, revoked]`, chunk carregado sob demanda); reserva pelo
   ponteiro devolvido no heartbeat.
2. `claimPlayRequest` (uma vez, antes de expirar, revalidando o perfil ativo).
3. Sem reprodução em andamento → abre o player (`/assistir?...&pr=<id>`); com
   reprodução em andamento (`isPlaybackActive`) → "Pedido de reprodução" com
   "Assistir agora"/"Continuar assistindo" (40 s → `no-answer`). Na seleção de
   perfis, aviso e espera pela escolha.
4. `updatePlayRequest`: `started` só quando o adaptador (AVPlay/Clappr) emite
   `playing`; falhas com código do contrato.
5. Marcador `revoked` (desvinculação) → `checkDevice()` → heartbeat →
   `device-revoked` → vinculação.

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
- **Navegador**: `<video>` nativo + hls.js (carregado sob demanda, sem worker: CSP).

Player de filmes e séries (`features/playback/PlayerScreen.tsx`, regras puras em
`playerRules.ts`, temporizador em `useOverlayTimer.ts`, visual em
`components/player/`):

- **Overlay 1** (`PlayerOverlay`): título; séries com `T1:E3` + nome do episódio
  (TMDB, senão o da fonte); tempo decorrido — barra — duração (tempos reais);
  selos só com dado confiável (resolução decodificada pelo `<video>` → SD/HD/
  Full HD/4K; "Legendado" só por marcação explícita da fonte IPTV). Aparece ao
  iniciar e some após 5 s sem interação (fade, sem tocar no vídeo/áudio).
- **OK/Enter** abre o modo interativo: −10 s, reproduzir/pausar (estado real do
  player), +10 s, barra navegável. Setas só agem com o overlay interativo
  aberto; fechado, Esquerda/Direita não fazem seek. OK passa pela pilha de
  teclas do `FocusProvider` antes do clique nativo.
- **Seek** sempre limitado à duração/posição válida e só exibido quando o player
  confirma (`createSeekGate`: evento de tempo, `seeked` do `<video>` ou o status
  devolvido por `player.seek` no AVPlay); sem confirmação em 10 s, desiste.
  Barra: Esquerda/Direita movem uma prévia, OK confirma, Voltar descarta; passo
  configurável em `PLAYER.scrubStep` (PROPOSTA).
- **Próximo episódio** (`NextEpisodeCard`): só séries, só se a fonte IPTV lista
  um próximo episódio (`readSeries`, nunca o TMDB); aparece nos últimos 30 s e a
  contagem é o tempo restante real da mídia (pausa congela). Ao escolher ou ao
  chegar a zero: grava o episódio atual como concluído e abre o próximo do zero.
  O painel do overlay reserva o canto do cartão (sem sobreposição).
- **Saída**: Voltar salva, encerra o adaptador e abre os detalhes (pelo
  histórico quando veio dos detalhes; senão substitui o player pelos detalhes).
  Fim natural: conclui e volta à origem. Fim muito antes da duração = erro com
  nova tentativa (não conclui). Ao vivo mantém o comportamento anterior.
- **Progresso**: perfis com biblioteca, VOD, a cada 30 s com deslocamento mínimo
  de 10 s, e na pausa/saída/seek confirmado (`progressSession` + backend
  `decideProgressWrite`). Conclusão = posição igual à duração na mesma sessão;
  o backend marca "Assistidos" (≥ 90%) e a retomada deixa de valer (≥ 95%).

Detalhes (`features/details/DetailsScreen.tsx`) mostram o conteúdo do Control
(título original, classificação e motivos, gêneros, avaliação, elenco/equipe,
informações, temporadas/episódios, recomendações) e nunca resolvem mídia.
Pessoas (`/pessoa/:id?s=&i=`) usam `/api/tmdb/person/:id` escopado ao título
autorizado (a pessoa precisa estar creditada nele); títulos da filmografia e
recomendações só abrem se existirem no catálogo IPTV (`tmdbAvailability.ts`).

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
