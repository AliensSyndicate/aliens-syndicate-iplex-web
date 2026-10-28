# iPlex Web

Interface do iPlex (React + TypeScript + Vite), hospedada por HTTPS no Firebase
Hosting `iplex-2c8fc` e carregada:

- dentro do **iPlex Player** (app Samsung Tizen, repositório `aliens-syndicate-iplex-app`), num iframe com a ponte `iplex-bridge` v1;
- em navegadores compatíveis.

O iPlex é um **player**: não fornece, vende nem hospeda conteúdo. As fontes IPTV
são configuradas pela família no **iPlex Gestor** (repositório
`aliens_syndicate_iplex_control`), que também mantém o backend (callable `manager`).

## Executar localmente

Requisitos: Node 22+ (testado com 26.8.2).

```bash
npm install
```

```bash
cp .env.example .env.local
```

Preencha `.env.local` (veja "Ambiente"). Para usar os dados de demonstração,
defina `VITE_IPLEX_USE_MOCKS=true` (só funciona em `vite dev`).

```bash
npm run dev
```

Abre em `http://localhost:5173`. Cenários de demonstração pela URL:
`?mock=unpaired | subscription | no-iptv | iptv-down | single | kids-last | session-limit | guest-only`.
PIN do perfil adulto de demonstração: 1234.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (inclui o proxy `/api/tmdb`) |
| `npm test` | Testes (Vitest) |
| `npm run typecheck` | TypeScript (app, testes, Node) |
| `npm run lint` | ESLint |
| `npm run build` | Typecheck + build de produção + `scripts/verify-build.mjs` |
| `node scripts/hosting-config.mjs` | Regenera o `firebase.json` (CSP com hashes do bundle legado) |

## Ambiente

| Variável | Onde | Observação |
|---|---|---|
| `VITE_FIREBASE_*` | bundle | Configuração web pública do projeto `iplex-2c8fc` |
| `VITE_FIREBASE_APPCHECK_SITE_KEY` | bundle | **Obrigatória em produção**: a callable `manager` exige App Check |
| `VITE_IPLEX_SHELL_ORIGINS` | bundle | Origens aceitas na ponte (`null,file://`) |
| `VITE_IPLEX_USE_MOCKS` | bundle (dev) | Ignorada em builds de produção |
| `TMDB_READ_ACCESS_TOKEN`, `TMDB_API_KEY` | **somente servidor** | Nunca com prefixo `VITE_`. Dev: `.env.local`. Produção: segredo da Function |

O segredo de produção já está configurado. Para trocar o token:

```bash
firebase functions:secrets:set TMDB_READ_ACCESS_TOKEN --project iplex-2c8fc
```

## Publicação (somente com autorização)

Publicado em 20/10/2026: Hosting (`https://iplex-2c8fc.web.app/`) e a Function
`iplexWebTmdb` (codebase `iplex-web`). O build de produção usa `.env.production`
(valores públicos versionados). Ordem para novas versões: Function (se mudou),
depois Hosting.

```bash
firebase deploy --only functions:iplex-web --project iplex-2c8fc
```

```bash
firebase hosting:channel:deploy preview --expires 7d --project iplex-2c8fc
```

```bash
firebase deploy --only hosting --project iplex-2c8fc
```

Nunca use `firebase deploy` sem `--only`. Nunca publique no projeto
institucional `aliens-syndicate-docs`.

### Publicar no Hosting e atualizar a TV

Fluxo usado no dia a dia (build, publicação e reabertura do app na Samsung):

```bash
npm run build
```

```bash
firebase deploy --only hosting --project iplex-2c8fc
```

```bash
cd ../aliens-syndicate-iplex-app && npm run tv -- --env production --watch 20
```

A TV carrega o Web de `https://iplex-2c8fc.web.app/`; por isso a versão nova só
chega a ela depois do deploy. O `npm run tv` (repositório do App) reinstala o
shell de produção e reabre o iPlex. Para ver os tempos de inicialização nos logs
da TV (`build/logs/tv-*.log` no repositório do App), abra com `?diag=1`:

```bash
cd ../aliens-syndicate-iplex-app && npm run tv -- --env production --target "https://iplex-2c8fc.web.app/?diag=1" --watch 30
```

Ao terminar um teste com `?diag=1` ou `?selftest=1`, rode de novo o
`npm run tv -- --env production` sem `--target` para voltar ao shell normal.

## Documentação

- [docs/ARQUITETURA.md](docs/ARQUITETURA.md): camadas, fluxos e contratos.
- [docs/DECISOES.md](docs/DECISOES.md): decisões aprovadas e propostas pendentes.
- [docs/PENDENCIAS.md](docs/PENDENCIAS.md): o que depende de backend, shell ou autorização.
