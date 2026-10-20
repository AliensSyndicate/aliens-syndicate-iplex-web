# Pendências

## Situação em produção (20/10/2026)

| Item | Estado |
|---|---|
| Hosting `https://iplex-2c8fc.web.app/` | **Publicado** (`--only hosting`) |
| App web Firebase "iPlex Web" | Registrado: `1:59148444884:web:60eab9d900779226f20741` |
| App Check | reCAPTCHA Enterprise (chave "iPlex Web (App Check)", token 1 h, pontuação mínima 0,5); aceito pela callable `manager` |
| Function `iplexWebTmdb` (codebase `iplex-web`) | **Publicada**; segredo `TMDB_READ_ACCESS_TOKEN` no Secret Manager; exige dispositivo pareado |
| Vinculação | Funciona contra o backend publicado (somente QR: ver abaixo) |
| Player (`aliens-syndicate-iplex-app`) | Rota do webview de produção = `https://iplex-2c8fc.web.app/` (verificação do Player aprovada) |

## Bloqueio principal: backend publicado é anterior ao código do Gestor

As Functions em produção (`manager`, atualizada em 18/10/2026) são de uma
geração anterior ao repositório local do Gestor:

| No repositório do Gestor | Em produção | Efeito no Web |
|---|---|---|
| `beginDevicePair` com código de 6 dígitos | só token | Vinculação apenas por QR Code |
| `listPlayerProfiles` | ausente | Web lê os perfis no Firestore (regras permitem); todos viram "regular" |
| Tipos de perfil (infantil, visitante) e filtros por perfil | ausentes | Sem restrição infantil real no servidor |
| `listProfileSpaces` | ausente; regras não deixam a TV ler as fontes | **TV não descobre as fontes IPTV** → "Servidor do iPlex desatualizado" |
| `markWatched`, gerações de biblioteca | ausentes | Progresso/favoritos gravam; limpeza por geração não se aplica |

Publicar as Functions do Gestor (`firebase deploy --only functions:iplex-gestor`
no repositório do Gestor) resolve isso, mas altera o backend de produção do
Gestor e depende de autorização explícita.

## Backend (repositório do Gestor — não alterado aqui)

| # | Pendência | Efeito atual no Web |
|---|---|---|
| 1 | Validação de PIN de perfil (`verifyProfilePin`) com limite de tentativas | Adultos bloqueados na TV quando há perfil infantil (falha fechada) |
| 2 | `readSourceEpg` recusa dispositivos (`iptvWorkspace`) | Sem programação na TV; canais aparecem normalmente |
| 3 | `readSourceCatalog` sem filtro por tipo/categoria e sem lookup por id | Filtragem no cliente; detalhes localizam o item pela busca de título |
| 4 | Logotipos/pôsteres da fonte: o catálogo guarda só hash da imagem | Canais com iniciais; filmes/séries dependem do TMDB |
| 5 | Fontes protegidas por PIN (`pin-required`): `verifySourcePin` não atende dispositivos | Estado "Fonte protegida" |
| 6 | Plataforma `web` no `pairingSessionInputSchema` e no Gestor | Navegador pareia como `web`; Gestor mostra "Android TV" |
| 7 | Endpoint de direito de acesso (entitlement) para leitura | Assinatura só é conhecida em `acquireSession`/`heartbeat` |
| 8 | Favoritos/progresso guardam só contentId e título | Itens de outros dispositivos sem índice local não aparecem nas fileiras |
| 9 | Data de inclusão / audiência no catálogo | Sem "Adicionados recentemente" / "Em alta" |

## Shell Samsung (iPlex Player — não alterado aqui)

- Validar na Samsung UN65TU7020 (Tizen 5.5): handshake, foco do iframe, teclas
  de mídia por `PlatformInfo.keys`, AVPlay com URLs reais, transparência durante
  a reprodução, `app.visibility`, `app.exit`.
- Confirmar a origem das mensagens do shell (`null` vs `file://`) em
  `VITE_IPLEX_SHELL_ORIGINS`.
- Bundle legado: validar em Tizen 4.0 (M56) e 5.5 (M69). Chrome desktop não
  prova compatibilidade.

## Produção

1. Validar o App Check (reCAPTCHA Enterprise) **dentro do iframe** da Samsung.
   Se as TVs receberem pontuação baixa, ajustar `minValidScore` no App Check.
   Custo: reCAPTCHA Enterprise é gratuito até 10.000 avaliações/mês; cada
   dispositivo renova o token a cada hora.
2. Validar na TV (`npm run tv -- --env production` no Player).
3. Revisar termos/atribuição do TMDB para uso comercial (a atribuição já aparece
   nos detalhes).
4. Streams `http://` não tocam no navegador (página HTTPS); na TV, AVPlay.
5. As credenciais TMDB foram compartilhadas em conversa: considere gerar novas
   no painel do TMDB antes de produção.
