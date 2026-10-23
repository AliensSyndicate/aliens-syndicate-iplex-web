import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CatalogItem } from '../../services/api/types'
import { ChannelCard } from './ChannelCard'

const channel = (imageRef?: string): CatalogItem => ({ id: 'c1', sourceId: 's', kind: 'channel', title: 'Canal Um', category: 'Notícias', providerRef: 'p', version: 'v', ...(imageRef ? { imageRef } : {}) })
const card = (item: CatalogItem) => render(<ChannelCard item={item} navId="c" navGroup="g" onSelect={() => undefined} gridIndex={0} />).container

describe('ChannelCard quadrado', () => {
  it('logo https sobrepõe o nome (que fica no fundo)', () => {
    const el = card(channel('https://logos.exemplo.invalid/um.png'))
    const children = Array.from(el.querySelector('.iplex-artwork')!.children)
    expect(children[0]!.className).toContain('iplex-artwork__fallback')
    expect(children[1]!.tagName).toBe('IMG')
  })
  it('sem logo ou com URL http, só o nome', () => {
    expect(card(channel()).querySelector('img')).toBeNull()
    expect(card(channel('http://inseguro.invalid/um.png')).querySelector('img')).toBeNull()
    expect(card(channel()).textContent).toContain('Canal Um')
  })
})
