/**
 * Fluxos da aplicação com o backend de demonstração (cenários) e falhas
 * injetadas. Cobre menu, perfis, visitante, infantil, PIN, pareamento,
 * assinatura, limites, fontes IPTV e acesso por URL direta.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../app/App'
import { createMockBackend } from '../dev/mock/mockBackend'
import { browserContext } from '../platform/environment'
import { AppError } from '../services/api/errors'
import type { Backend } from '../services/api/backend'

const detect = async () => browserContext()

function start(path: string, scenario = 'default', patch: Partial<Backend> = {}) {
  window.history.replaceState({}, '', `${path}${path.includes('?') ? '&' : '?'}mock=${scenario}`)
  const backend = { ...createMockBackend(), ...patch } as Backend
  // Na URL do app não deve ficar o parâmetro de cenário.
  window.history.replaceState({}, '', path)
  return { backend, ...render(<App backend={backend} detect={detect} />) }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
  localStorage.clear()
})

const find = (text: string | RegExp) => screen.findByText(text, {}, { timeout: 5000 })

/** Backend de demonstração do cenário (mesma instância/estado), para sobrescrever só uma chamada. */
function scenarioBackend(scenario: string) {
  window.history.replaceState({}, '', `/?mock=${scenario}`)
  return createMockBackend()
}

describe('reabrir o app: último perfil usado', () => {
  const remember = (profileId: string) => localStorage.setItem('iplex.lastProfile.v1', JSON.stringify({ familyId: 'demo-family', profileId }))
  it('perfil adulto com infantil na família: entra direto quando o servidor aceita (sessão por PIN ainda ativa)', async () => {
    const real = scenarioBackend('default')
    remember('admin')
    const acquire = vi.fn(real.acquireSession)
    start('/', 'default', { ...real, acquireSession: acquire })
    expect(await screen.findByRole('navigation', { name: 'Menu principal' }, { timeout: 15000 })).toBeTruthy()
    expect(screen.queryByText('Quem está assistindo?')).toBeNull()
    expect(acquire).toHaveBeenCalledWith('admin')
  }, 30000)
  it('sessão por PIN expirada: o servidor exige o PIN e o app volta à escolha de perfil, sem mensagem de erro', async () => {
    const real = scenarioBackend('default')
    remember('admin')
    start('/', 'default', { ...real, acquireSession: async () => { throw new AppError('profile-locked', 'profile-pin-required') } })
    expect(await find('Quem está assistindo?')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/Perfil protegido/)).toBeNull()
  }, 30000)
  it('último perfil visitante (sem PIN) entra direto', async () => {
    const real = scenarioBackend('default')
    remember('guest')
    start('/', 'default', { ...real })
    expect(await screen.findByRole('navigation', { name: 'Menu principal' }, { timeout: 15000 })).toBeTruthy()
  }, 30000)
})

describe('carregamento inicial', () => {
  it('só libera a navegação com o catálogo completo, mostrando o progresso', async () => {
    const real = scenarioBackend('single')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    start('/', 'single', { ...real, readCatalog: async (profileId, query) => (await gate, real.readCatalog(profileId, query)) })
    expect(await find('Configurando filmes...')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Menu principal' })).toBeNull()
    release()
    expect(await screen.findByRole('navigation', { name: 'Menu principal' }, { timeout: 15000 })).toBeTruthy()
  }, 30000)
  it('falha no carregamento entra na TV sem lista: menu, marca d\'água e sem pedir vínculo', async () => {
    const real = scenarioBackend('single')
    start('/', 'single', {
      ...real,
      readCatalog: async () => {
        throw new AppError('iptv-unavailable', 'down')
      },
    })
    expect(await screen.findByRole('navigation', { name: 'Menu principal' }, { timeout: 15000 })).toBeTruthy()
    expect(screen.getByText('Conteúdo indisponível, favor contatar seu fornecedor de IPTV')).toBeTruthy()
    expect(screen.queryByText(/Vincule esta TV/)).toBeNull()
  }, 30000)
  it('IPTV fora do ar: entra com marca d\'água e sem botões de reproduzir', async () => {
    const real = scenarioBackend('single')
    start('/', 'single', { listSpaces: async (profileId: string) => (await real.listSpaces(profileId)).map((space) => ({ ...space, unavailable: true })) })
    expect(await find('Conteúdo indisponível, favor contatar seu fornecedor de IPTV')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Assistir|Continuar/ })).toBeNull()
  }, 30000)
})

describe('seis conjuntos', () => {
  it('com o backend novo a inicialização usa manifesto/blocos e não o formato paginado', async () => {
    const real = scenarioBackend('single')
    const readCatalog = vi.fn(real.readCatalog)
    const manifest = vi.fn(async () => ({
      version: 'v1', previousVersion: null, viewerKey: 'k', deltaAvailable: false,
      sets: { live_categories: { chunks: 1, hash: 'a' }, live: { chunks: 1, hash: 'a' }, vod_categories: { chunks: 1, hash: 'a' }, vod: { chunks: 1, hash: 'a' }, series_categories: { chunks: 1, hash: 'a' }, series: { chunks: 1, hash: 'a' } },
    }))
    const chunk = vi.fn(async (_p: string, sourceId: string, set: string) => ({
      version: 'v1', set, n: 0, chunks: 1,
      records: set === 'vod' ? [{ id: 'm9', sourceId, kind: 'movie', title: 'Filme do bloco', category: 'AÇAO', categoryId: '10', providerRef: '9', version: 'v1' }] : set === 'vod_categories' ? [{ id: '10', name: 'AÇAO', kind: 'movie' }] : [],
    }))
    start('/', 'single', { ...real, readCatalog, readCatalogManifest: manifest, readCatalogChunk: chunk as never, readCatalogDelta: vi.fn() as never })
    await screen.findByRole('navigation', { name: 'Menu principal' }, { timeout: 15000 })
    expect(manifest).toHaveBeenCalled()
    expect(chunk).toHaveBeenCalled()
    expect(readCatalog).not.toHaveBeenCalled()
    screen.getByRole('button', { name: 'Filmes' }).click()
    expect(await screen.findByRole('button', { name: 'Filme do bloco' }, { timeout: 8000 })).toBeTruthy()
  }, 40000)
})

describe('catálogo', () => {
  it('abre com várias linhas montadas, sem esperar tecla para baixo', async () => {
    localStorage.setItem('iplex.lastProfile.v1', JSON.stringify({ familyId: 'demo-family', profileId: 'p-kids' }))
    start('/filmes', 'many')
    await screen.findByRole('main', { name: /Filmes/ }, { timeout: 15000 })
    await waitFor(() => expect(document.querySelectorAll('[data-grid-index]').length).toBeGreaterThan(5), { timeout: 8000 })
    const rows = new Set(Array.from(document.querySelectorAll('[data-grid-index]')).map((el) => Math.floor(Number(el.getAttribute('data-grid-index')) / 5)))
    expect(rows.size).toBeGreaterThan(1)
  }, 40000)
})

describe('cards do catálogo', () => {
  it('nenhum card fica vazio: sem imagem aparece o nome', async () => {
    start('/filmes', 'single')
    await waitFor(() => expect(document.querySelectorAll('[data-grid-index]').length).toBeGreaterThan(0), { timeout: 15000 })
    await waitFor(() => {
      const empty = Array.from(document.querySelectorAll('[data-grid-index]')).filter((el) => !el.querySelector('img') && !(el.querySelector('.iplex-artwork__text')?.textContent ?? '').trim())
      expect(empty.length).toBe(0)
    }, { timeout: 8000 })
  }, 40000)
})

describe('listas IPTV nas configurações', () => {
  it('mostra as listas, a atual e a última atualização; trocar recarrega desde o início com a nova lista', async () => {
    const when = new Date(2026, 9, 28, 13, 5).getTime()
    const kinds = ['movie', 'series'] as const
    start('/configuracoes', 'single', {
      listSpaces: async () => [
        { sourceId: 'a', name: 'Lista A', kinds: [...kinds], lastSyncAt: when },
        { sourceId: 'b', name: 'Lista B', kinds: [...kinds] },
      ],
    })
    await screen.findByRole('main', { name: 'Configurações' }, { timeout: 15000 })
    expect(await find('Listas IPTV')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Lista A, lista atual' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByText('28/10/2026 13:05')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Lista B' }).getAttribute('aria-current')).toBeNull()
    screen.getByRole('button', { name: 'Lista B' }).click()
    // Volta ao início (Meu iPlex) com a lista nova guardada.
    await waitFor(() => expect(window.location.pathname).toBe('/meu-iplex'), { timeout: 15000 })
    expect(JSON.parse(localStorage.getItem('iplex.activeSource.v1.demo-family.admin') ?? 'null')).toBe('b')
  }, 40000)
})

describe('troca de perfil', () => {
  it('avatar abre a mesma seleção sem reiniciar o app e, ao trocar, o avatar e o menu seguem o novo perfil', async () => {
    localStorage.setItem('iplex.lastProfile.v1', JSON.stringify({ familyId: 'demo-family', profileId: 'guest' }))
    start('/', 'default')
    const avatar = await screen.findByRole('button', { name: 'Perfil: Visitante. Trocar perfil' }, { timeout: 15000 })
    avatar.click()
    expect(await find('Quem está assistindo?')).toBeTruthy()
    // O app segue montado por baixo (menu principal presente): nada foi reinicializado.
    expect(screen.getByRole('navigation', { name: 'Menu principal' })).toBeTruthy()
    screen.getByRole('button', { name: /^Infantil Demo/ }).click()
    expect(await screen.findByRole('button', { name: 'Perfil: Infantil Demo. Trocar perfil' }, { timeout: 15000 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Perfil: Visitante. Trocar perfil' })).toBeNull()
    expect(screen.queryByText('Quem está assistindo?')).toBeNull()
  }, 40000)
})

describe('menu principal', () => {
  it('ordem oficial: Avatar, Meu iPlex, Busca (só ícone), Ao Vivo, Filmes, Séries, Configurações', async () => {
    start('/', 'single')
    const nav = await screen.findByRole('navigation', { name: 'Menu principal' }, { timeout: 5000 })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Perfil: Demonstração. Trocar perfil',
      'Meu iPlex',
      'Buscar',
      'Ao Vivo',
      'Filmes',
      'Séries',
      'Configurações',
    ])
    // Busca: só ícone, sem rótulo visível; demais abas sem ícone.
    expect(buttons[2]!.textContent).toBe('')
    expect(buttons[2]!.querySelector('svg')).not.toBeNull()
    for (const b of [buttons[1], buttons[3], buttons[4], buttons[5]]) expect(b!.querySelector('svg')).toBeNull()
  })

  it('perfil regular abre em Meu iPlex com aba ativa', async () => {
    start('/', 'single')
    await waitFor(() => expect(window.location.pathname).toBe('/meu-iplex'), { timeout: 5000 })
    const nav = await screen.findByRole('navigation', { name: 'Menu principal' })
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Meu iPlex' }).getAttribute('aria-current')).toBe('page'))
  })
})

describe('perfis', () => {
  it('vários perfis com último adulto → seleção de perfis', async () => {
    start('/')
    expect(await find('Quem está assistindo?')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Infantil Demo, Infantil/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Demonstração, protegido por PIN/ })).toBeTruthy()
  })

  it('seleção de perfis identifica a conta vinculada sem substituir os avatares dos perfis', async () => {
    const { container } = start('/', 'default', { accountIdentity: () => ({ name: 'Conta Ana', photoUrl: 'https://lh3.googleusercontent.com/a/ana' }) })
    expect(await find('Quem está assistindo?')).toBeTruthy()
    expect(screen.getByText('Conta Ana')).toBeTruthy()
    expect(container.querySelector('.iplex-account-badge img')?.getAttribute('src')).toBe('https://lh3.googleusercontent.com/a/ana')
    // Perfis de visualização continuam com a própria identidade (inicial), sem a foto da conta.
    expect(container.querySelectorAll('.iplex-profile img').length).toBe(0)
    expect(screen.getByRole('button', { name: /Infantil Demo, Infantil/ })).toBeTruthy()
  })

  it('conta sem foto usa o avatar padrão (iniciais)', async () => {
    const { container } = start('/', 'default', { accountIdentity: () => ({ name: 'Bia Souza', photoUrl: null }) })
    expect(await find('Quem está assistindo?')).toBeTruthy()
    expect(container.querySelector('.iplex-account-badge img')).toBeNull()
    expect(container.querySelector('.iplex-account-badge .iplex-avatar')?.textContent).toBe('BS')
  })

  it('último perfil infantil entra direto, sem seletor', async () => {
    start('/', 'kids-last')
    await waitFor(() => expect(window.location.pathname).toBe('/meu-iplex'), { timeout: 5000 })
    expect(await find('Olá, Infantil Demo')).toBeTruthy()
  })

  it('perfil adulto com perfil infantil na família exige PIN', async () => {
    start('/')
    ;(await screen.findByRole('button', { name: /Demonstração, protegido por PIN/ }, { timeout: 5000 })).click()
    expect(await find('Digite o PIN')).toBeTruthy()
  })

  it('sem validação de PIN no backend, o perfil adulto continua bloqueado (falha fechada)', async () => {
    start('/', 'default', { verifyProfilePin: async () => { throw new AppError('not-supported') } })
    ;(await screen.findByRole('button', { name: /Demonstração, protegido por PIN/ }, { timeout: 5000 })).click()
    await find('Digite o PIN')
    for (const key of ['1', '2', '3', '4']) screen.getByRole('button', { name: key }).click()
    expect(await find(/não pode ser aberto nesta TV/)).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Menu principal' })).toBeNull()
  })

  it('PIN correto (validado pelo backend) abre o perfil', async () => {
    start('/')
    ;(await screen.findByRole('button', { name: /Demonstração, protegido por PIN/ }, { timeout: 5000 })).click()
    await find('Digite o PIN')
    await act(async () => {
      for (const key of ['1', '2', '3', '4']) screen.getByRole('button', { name: key }).click()
    })
    expect(await screen.findByRole('navigation', { name: 'Menu principal' }, { timeout: 5000 })).toBeTruthy()
  })
})

describe('visitante', () => {
  it('abre em Ao Vivo e tem Meu iPlex no menu', async () => {
    start('/', 'guest-only')
    await waitFor(() => expect(window.location.pathname).toBe('/ao-vivo'), { timeout: 5000 })
    const nav = await screen.findByRole('navigation', { name: 'Menu principal' })
    expect(within(nav).queryByText('Meu iPlex')).toBeTruthy()
  })
  it('Meu iPlex do visitante abre sem seções pessoais nem vazias', async () => {
    start('/meu-iplex', 'guest-only')
    expect(await screen.findByRole('main', { name: 'Meu iPlex' }, { timeout: 5000 })).toBeTruthy()
    expect(window.location.pathname).toBe('/meu-iplex')
    for (const title of ['Favoritos', 'Lista de desejo', 'Assistidos', 'Continuar assistindo']) expect(screen.queryByText(title)).toBeNull()
  })
})

describe('estados de acesso', () => {
  it('dispositivo não vinculado → vinculação com código', async () => {
    start('/', 'unpaired')
    expect(await find('Vincule esta TV à sua família')).toBeTruthy()
    expect(await find('123-456')).toBeTruthy()
    expect(screen.getByRole('img', { name: /QR Code de vinculação/ })).toBeTruthy()
  })
  it('vinculação: ocultar/reexibir a tela ou oscilar a rede não troca o código', async () => {
    const mock = createMockBackend()
    const beginPairing = vi.fn(mock.beginPairing.bind(mock))
    start('/', 'unpaired', { beginPairing })
    expect(await find('123-456')).toBeTruthy()
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    for (const state of ['hidden', 'visible'] as const) {
      visibility.mockReturnValue(state)
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    }
    await act(async () => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')) })
    visibility.mockRestore()
    expect(await find('123-456')).toBeTruthy()
    expect(beginPairing).toHaveBeenCalledTimes(1)
  })
  it('assinatura inativa: estado próprio, com nova verificação', async () => {
    start('/', 'subscription')
    ;(await screen.findByRole('button', { name: /Demonstração/ }, { timeout: 5000 }))
    // perfil infantil não exige PIN: entra nele para validar o acesso
    screen.getByRole('button', { name: /Infantil Demo/ }).click()
    expect(await find('Assinatura inativa')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Verificar novamente' })).toBeTruthy()
  })
  it('limite de telas atingido', async () => {
    start('/', 'session-limit')
    ;(await screen.findByRole('button', { name: /Infantil Demo/ }, { timeout: 5000 })).click()
    expect(await find('Limite de telas atingido')).toBeTruthy()
  })
  it('sem fonte IPTV: orienta o Gestor', async () => {
    start('/', 'no-iptv')
    ;(await screen.findByRole('button', { name: /Infantil Demo/ }, { timeout: 5000 })).click()
    await waitFor(() => expect(window.location.pathname).toBe('/meu-iplex'), { timeout: 5000 })
    screen.getByText('Filmes').click()
    expect(await find('Nenhuma fonte configurada')).toBeTruthy()
  })
  it('fonte IPTV fora do ar não é confundida com assinatura', async () => {
    start('/', 'iptv-down')
    ;(await screen.findByRole('button', { name: /Infantil Demo/ }, { timeout: 5000 })).click()
    // Fonte fora do ar: entra normalmente, com a marca d'água de conteúdo indisponível.
    expect(await find('Conteúdo indisponível, favor contatar seu fornecedor de IPTV')).toBeTruthy()
    expect(screen.queryByText('Assinatura inativa')).toBeNull()
  })
})

describe('conteúdo', () => {
  it('perfil infantil não acessa conteúdo adulto por URL direta', async () => {
    start('/', 'kids-last')
    await waitFor(() => expect(window.location.pathname).toBe('/meu-iplex'), { timeout: 5000 })
    act(() => {
      window.history.pushState({}, '', '/titulo/demo-source/m-tears?t=Tears')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(await find('Conteúdo indisponível')).toBeTruthy()
  })
  it('Meu iPlex sem itens pessoais: nenhuma seção vazia, sem cards fictícios', async () => {
    start('/', 'single')
    expect(await screen.findByRole('main', { name: 'Meu iPlex' }, { timeout: 5000 })).toBeTruthy()
    // Nenhum card pessoal fictício: só as seções do catálogo real podem ter pôsteres.
    expect(screen.queryByText('Recentes')).toBeNull()
    expect(screen.queryByText('Favoritos')).toBeNull()
    expect(screen.queryByText('Assistidos')).toBeNull()
  })
  it('Filmes lista somente itens do catálogo autorizado', async () => {
    start('/', 'single')
    await screen.findByRole('main', { name: 'Meu iPlex' }, { timeout: 5000 })
    screen.getByRole('button', { name: 'Filmes' }).click()
    expect(await screen.findByRole('button', { name: 'Big Buck Bunny (2008)' }, { timeout: 5000 })).toBeTruthy()
  })
})

describe('compatibilidade com backend anterior', () => {
  it('vinculação só por QR quando o backend não devolve código numérico', async () => {
    start('/', 'unpaired', {
      beginPairing: async () => ({ token: 'b'.repeat(64), expiresAt: Date.now() + 300000, code: null, formattedCode: null, deviceId: null }),
    })
    expect(await find('Leia o QR Code ao lado.')).toBeTruthy()
    expect(screen.getByRole('img', { name: /QR Code de vinculação/ })).toBeTruthy()
    expect(screen.queryByText('123-456')).toBeNull()
  })
  it('fonte IPTV registrada com erro: entra no app com marca d\'água', async () => {
    const real = scenarioBackend('single')
    start('/', 'single', { listSpaces: async (profileId: string) => (await real.listSpaces(profileId)).map((space) => ({ ...space, unavailable: true })) })
    expect(await find('Conteúdo indisponível, favor contatar seu fornecedor de IPTV')).toBeTruthy()
    expect(screen.queryByText(/Vincule esta TV/)).toBeNull()
  })
  it('sem listagem de fontes no backend: nosso servidor desatualizado barra o app', async () => {
    start('/', 'single', { listSpaces: async () => { throw new AppError('backend-outdated', 'invalid-action') } })
    expect(await find('Servidor do iPlex desatualizado')).toBeTruthy()
    expect(screen.queryByText('Conteúdo indisponível, favor contatar seu fornecedor de IPTV')).toBeNull()
  })
})
