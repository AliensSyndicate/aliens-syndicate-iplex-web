# Decisões

## Aprovadas (seção 32 do prompt mestre) — implementadas

Projeto React independente; carregado por URL no app Samsung; menu horizontal
fixo no topo à esquerda (Avatar, Meu iPlex, Busca só ícone, Ao Vivo, Filmes,
Séries); visitante sem Meu iPlex e abrindo em Ao Vivo; proteção infantil;
fundo `#0F0F0F` sólido; Google Sans; Hugeicons Stroke Rounded; logo branco sem
efeitos; botões Primary/Secondary somente texto; cards de superfície com raio
48px; TMDB para metadados (nunca vídeo); AVPlay no shell; Clappr no navegador;
Gestor separado; projeto institucional intocado; pagamentos desligados.

> Diferença em relação ao Player: o logo do Player tem um "brilho vertical
> suave". Aqui segue a regra do prompt mestre: branco sólido, sem brilho.

## Propostas (seção 33) — implementação inicial ajustável

| Ponto | Escolha atual | Onde ajustar |
|---|---|---|
| Seção inicial de perfis regulares | Meu iPlex | `FEATURES.regularStartSection` |
| Abrir último canal automaticamente | Desligado | `FEATURES.autoplayLastChannel` |
| Altura do header, banner, espaçamentos, tamanhos de cards | Tokens de layout | `src/styles/tokens.css` |
| Hover/foco | Anel claro com vão escuro + escala 1,06 nos cards; abas/chips em pílula branca | tokens `--iplex-focus-*` e `app.css` |
| Destaque de Filmes/Séries | 1º item do catálogo com correspondência TMDB confirmada e backdrop | `useHero` em `CatalogBrowseScreen` |
| Fileiras | "Continuar assistindo" + uma fileira por categoria da fonte | idem |
| "Em alta" / "Adicionados recentemente" | **Não exibidos**: o backend não tem audiência nem data de inclusão | — |
| Recomendações (Meu iPlex) | Itens já carregados das mesmas categorias da lista/progresso, ainda não assistidos | `MyIplexScreen` |
| "Minha lista" | Coleção `favorites` do backend (não existe coleção separada); canais favoritos na mesma coleção | `LibraryStore` |
| Guia EPG | Agora/A seguir + barra de progresso no painel do canal | `LiveTvScreen` |
| Configurações | Perfil, dispositivo, fontes, versões, "Sair deste dispositivo" (só administrador) | `SettingsScreen` |
| Cache | TMDB: servidor (LRU 24 h, falhas 6 h) + cliente (memória e localStorage 7 dias, só metadados) | `service.ts`, `tmdbClient.ts` |
| PIN | 4 dígitos, bloqueio local após 5 erros por 60 s | `FEATURES.pin*` |

## Decisões que afetam segurança — precisam de aprovação

1. **PIN parental (implementado em 20/10/2026, local).** Um PIN de 4 dígitos
   por família, definido pelo administrador no Control e validado no backend
   (scrypt, 5 tentativas, bloqueio de 15 min por TV). Sem PIN definido e com
   perfil infantil, adultos continuam bloqueados na TV (falha fechada).
   **A aprovar:** PIN único por família (e não por perfil adulto).
5. **Pedido de reprodução com algo tocando (proposta v1, a aprovar).** A TV
   pergunta ("Assistir agora" / "Continuar assistindo"); sem resposta em 40 s,
   mantém a reprodução atual. Sem reprodução em andamento, inicia direto. Na
   seleção de perfis, espera a escolha (até 60 s). Ajuste em
   `features/remote/PlayRequestCoordinator.tsx` (`CONFIRM_TIMEOUT_MS`).
2. **Navegador como dispositivo.** O pareamento pelo navegador envia
   `platform: 'web'` (a callable aceita; o schema lista só TVs e o Gestor
   exibiria "Android TV").
3. **App web próprio + App Check.** Registrado o app web "iPlex Web" (separado
   do app web do Gestor) com reCAPTCHA Enterprise no App Check. Configuração
   pública versionada em `.env.production`.
4. **CSP sem `data:`.** O detector de navegador moderno do plugin legado
   importava uma URL `data:`; o build troca por `/assets/import-meta-resolve-guard.js`
   antes do hash (`server/legacy-guard-plugin.ts`) e não gera polyfills
   modernos. A CSP segue só com `'self'` + hashes.
