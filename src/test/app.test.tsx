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

describe('menu principal', () => {
  it('ordem oficial: Avatar, Meu iPlex, Busca (só ícone), Ao Vivo, Filmes, Séries', async () => {
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

  it('conta sem foto usa o avatar padrão (inicial)', async () => {
    const { container } = start('/', 'default', { accountIdentity: () => ({ name: 'Bia', photoUrl: null }) })
    expect(await find('Quem está assistindo?')).toBeTruthy()
    expect(container.querySelector('.iplex-account-badge img')).toBeNull()
    expect(container.querySelector('.iplex-account-badge .iplex-avatar')?.textContent).toBe('B')
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
  it('abre em Ao Vivo e não tem Meu iPlex', async () => {
    start('/', 'guest-only')
    await waitFor(() => expect(window.location.pathname).toBe('/ao-vivo'), { timeout: 5000 })
    const nav = await screen.findByRole('navigation', { name: 'Menu principal' })
    expect(within(nav).queryByText('Meu iPlex')).toBeNull()
  })
  it('URL direta para Meu iPlex redireciona para Ao Vivo', async () => {
    start('/meu-iplex', 'guest-only')
    await waitFor(() => expect(window.location.pathname).toBe('/ao-vivo'), { timeout: 5000 })
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
    await waitFor(() => expect(window.location.pathname).toBe('/meu-iplex'), { timeout: 5000 })
    screen.getByText('Filmes').click()
    expect(await find('Fonte IPTV indisponível')).toBeTruthy()
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
  it('Meu iPlex vazio: mensagem curta, sem cards fictícios', async () => {
    start('/', 'single')
    expect(await find('Sua área pessoal está vazia')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /Big Buck Bunny/ })).toHaveLength(0)
  })
  it('Filmes lista somente itens do catálogo autorizado', async () => {
    start('/', 'single')
    await find('Sua área pessoal está vazia')
    screen.getByText('Filmes').click()
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
  it('sem listagem de fontes no backend: mensagem de servidor desatualizado', async () => {
    start('/', 'single', { listSpaces: async () => { throw new AppError('backend-outdated', 'invalid-action') } })
    await find('Sua área pessoal está vazia')
    screen.getByText('Filmes').click()
    expect(await find('Servidor do iPlex desatualizado')).toBeTruthy()
  })
})
