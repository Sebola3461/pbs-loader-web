# DESIGN.md — Mods do PBS Loader

Sistema de design "Garagem retrofuturista". Fonte única de verdade para toda a
implementação visual deste site. Qualquer decisão de UI fora deste arquivo é um bug de
processo: atualize o arquivo primeiro.

Direção escolhida (2026-10-31): dark OLED inspirado no painel de um ônibus noturno —
base quase preta, acento âmbar de luz-piloto para ação, azul discreto para links,
tipografia condensada de painel rodoviário. Anguloso, sem neons, sem scanlines.

## 1. Visual Theme & Atmosphere

Um site que se sente como a cabine de um ônibus rodoviário à noite: painel escuro,
iluminação âmbar só onde a mão precisa pousar, e um letreiro display que lembra painel
de destino. A base é OLED-escura (#0B0D12) — quase preto, frio, com superfícies que
sobem um degrau de luminância para separar camadas. Nada brilha sem propósito: o âmbar
(#FFB020) é reservado para ação (CTA, foco, estado ativo), o azul (#85B6FF) para
navegação de leitura, o dourado (#E3B341) exclusivo para estrelas de avaliação.

A sensação é de instrumento funcional, não de arcade. Os cantos são mais angulosos que
o padrão (0.375rem) para lembrar recortes de metal; as bordas de 1px marcam os limites
dos "painéis" da cabine. O hero da home traz uma linha de detalhe âmbar (o "farol")
que ancora a marca sem virar decoração gratuita.

**Key Characteristics:**
- Dark OLED #0B0D12 como base; superfícies #12151D e #191E28 em degraus
- Âmbar #FFB020 exclusivo para ação e foco; nunca como cor de texto corrente
- Azul #85B6FF só para links e navegação de leitura
- Russo One no display (painel de destino), Chakra Petch no corpo (instrumentos)
- Cantos 0.375rem — anguloso, "recorte de chapa", não "bolha"
- Bordas 1px sempre visíveis entre superfícies; sem sombras difusas grandes
- Ícones SVG, nunca emoji; nenhuma fonte de sistema

## 2. Color Palette & Roles

### Primary (ação)
| Role | Hex | Usage |
|------|-----|-------|
| Primary | #FFB020 | CTA, botão primário, marca visual |
| Primary Dark | #E69B10 | Hover alternativo em superfícies claras |
| Primary Hover | #FFC145 | Hover do botão primário |
| Primary Soft | #2E2410 | Fundo de badge/fundo suave âmbar |
| On Primary | #171208 | Texto sobre âmbar |

### Accent (avaliação)
| Role | Hex | Usage |
|------|-----|-------|
| Star | #E3B341 | Estrelas de avaliação, exclusivo |
| Star Muted | #4A4234 | Estrela vazia/contorno |

### Interactive States
| Role | Hex | Usage |
|------|-----|-------|
| Link Default | #85B6FF | Links em texto |
| Link Hover | #A9CCFF | Link hovered |
| Focus Ring | #FFB020 | Outline de foco (3px, offset 2px) |
| Error | #E8CE96 | Erro de formulário (mesma família do warning, por herança do site) |
| Success | #9FDDBD | Confirmações |
| Success BG | #16302A | Fundo de mensagem de sucesso |
| Warning | #E8CE96 | Avisos |
| Warning BG | #332A18 | Fundo de aviso |
| Warning Border | #A8894A | Borda de aviso |

### Neutral Scale
| Role | Hex | Usage |
|------|-----|-------|
| Foreground | #E8EAEE | Texto principal |
| Muted Foreground | #9AA3B2 | Texto secundário, dicas |
| Border | #262C3A | Bordas padrão |
| Border Strong | #3A4254 | Borda de input, separador forte |
| Surface | #12151D | Cards, header, superfícies |
| Surface Muted | #191E28 | Hover de item, chips |
| Background | #0B0D12 | Fundo da página |

### Surface & Borders
| Role | Hex | Usage |
|------|-----|-------|
| Surface Primary | #12151D | Cards |
| Surface Secondary | #191E28 | Hover, fundos alternados |
| Border Default | #262C3A | Bordas |
| Border Subtle | #262C3A | Divisores |

### Shadow Colors
| Role | Value | Usage |
|------|-------|-------|
| Shadow Light | rgb(0 0 0 / 0.25) | Sombra sutil |
| Shadow Card Hover | 0 4px 12px rgb(0 0 0 / 0.4) | Card no hover |
| Shadow Modal | 0 12px 32px rgb(0 0 0 / 0.5) | Modal/dialog |

Contraste verificado (WCAG AA): #E8EAEE sobre #0B0D12 ≈ 14.8:1; #9AA3B2 sobre #0B0D12
≈ 7.0:1; #171208 sobre #FFB020 ≈ 10.5:1; #85B6FF sobre #0B0D12 ≈ 8.9:1;
#E8CE96 sobre #332A18 ≈ 8.0:1. Todos passam.

## 3. Typography Rules

**Primary Font:** Chakra Petch (Google Fonts) — corpo, instrumentos
**Secondary Font:** Russo One (Google Fonts) — display, títulos de painel

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display Hero | Russo One | clamp(2rem, 1.4rem + 2.5vw, 3rem) | 400 | 1.1 | 0.01em | Reservado; a home não exibe título visível (decisão 2026-10-31) |
| Section Heading | Russo One | clamp(1.375rem, 1.2rem + 0.8vw, 1.75rem) | 400 | 1.2 | 0.01em | H1/H2 de página |
| Sub-heading | Chakra Petch | 1.125rem | 600 | 1.3 | 0 | H3, títulos de card |
| Body | Chakra Petch | 1rem | 400 | 1.55 | 0 | Texto corrente |
| Body Small | Chakra Petch | 0.875rem | 400 | 1.5 | 0 | Dicas, meta |
| Button | Chakra Petch | 1rem | 600 | 1 | 0.02em | Rótulos de botão |
| Caption | Chakra Petch | 0.75rem | 500 | 1.4 | 0.02em | Timestamps, tags |

Russo One só existe no peso 400 — nunca fingir peso com stroke. Chakra Petch cobre
300–700. Sem fonte de sistema visível; fallbacks apenas técnicos.

## 4. Component Stylings

### Buttons

**Primary Button:**
| Property | Value |
|----------|-------|
| Background | #FFB020 |
| Text Color | #171208 |
| Font | Chakra Petch 1rem 600 |
| Padding | 0 1rem (min-height 2.75rem) |
| Border Radius | 0.375rem |
| Border | 1px solid #FFB020 |
| Shadow | none |
| Hover Background | #FFC145 |
| Focus Ring | outline 3px #FFB020, offset 2px |
| Active Background | #E69B10 |
| Disabled Background | #3A4254 |
| Disabled Text | #9AA3B2 |
| Transition | background-color 150ms ease |

**Secondary Button:**
| Property | Value |
|----------|-------|
| Background | #12151D |
| Text Color | #E8EAEE |
| Border | 1px solid #3A4254 |
| Hover Background | #191E28 |
| Focus Ring | outline 3px #FFB020, offset 2px |

**Button Link (terciário):** texto #85B6FF, fundo transparente, sem borda.

### Cards (mod-card)
| Property | Value |
|----------|-------|
| Background | #12151D |
| Border | 1px solid #262C3A |
| Border Radius | 0.5rem |
| Padding | 1rem |
| Shadow | none (borda faz o trabalho) |
| Hover Border | 1px solid #3A4254 + shadow 0 4px 12px rgb(0 0 0 / 0.4) |
| Hover Transform | translateY(-2px) |
| Transition | 150ms ease |

### Inputs
| Property | Value |
|----------|-------|
| Background | #12151D |
| Border | 1px solid #3A4254 |
| Border Radius | 0.375rem |
| Padding | 0.5rem 0.75rem (min-height 2.75rem) |
| Font | Chakra Petch 1rem |
| Focus Border | #FFB020 |
| Error Border | #A8894A (herdado do warning) |

### Navigation
| Property | Value |
|----------|-------|
| Background | #12151D |
| Border Bottom | 1px solid #262C3A |
| Link Color | #9AA3B2 |
| Link Hover | #E8EAEE sobre #191E28 |
| Active Link | #FFB020, peso 600, sem sublinhado (o raio do link curvava a linha) |
| Brand Mark | #171208 sobre #FFB020, Russo One |

## 5. Layout Principles

**Base Spacing Unit:** 4px
**Spacing Scale:** 4, 8, 12, 16, 24, 32, 48, 56 (rem: 0.25/0.5/0.75/1/1.5/2/3/3.5)

**Grid:**
| Property | Value |
|----------|-------|
| Max Container Width | 76rem (1216px) |
| Grid Columns | auto-fit, minmax(16rem, 1fr) para cards |
| Column Gap | 1rem |
| Row Gap | 1rem |

**Border Radius Scale:**
| Size | Value | Usage |
|------|-------|-------|
| Small | 0.375rem | Inputs, botões |
| Medium | 0.5rem | Cards |
| Large | 0.75rem | Modal, imagens de capa |
| Full | 9999px | Pills, badges |

## 6. Depth & Elevation

| Level | Name | CSS box-shadow | Usage |
|-------|------|---------------|-------|
| 0 | Flat | none | Estado padrão |
| 1 | Card Hover | 0 4px 12px rgb(0 0 0 / 0.4) | Card no hover |
| 2 | Dropdown | 0 8px 24px rgb(0 0 0 / 0.45) | Menus, popover |
| 3 | Modal | 0 12px 32px rgb(0 0 0 / 0.5) | Dialogs |

A hierarquia vem de luminância das superfícies (#0B0D12 → #12151D → #191E28), não de
sombra. Sombra é reforço, nunca substituta da borda 1px.

## 7. Do's and Don'ts

### Do's
1. Use âmbar #FFB020 só em ação, foco e marca — um CTA âmbar por região.
2. Use Russo One apenas em títulos de página/hero; Chakra Petch em todo o resto.
3. Mantenha borda 1px #262C3A entre superfícies irmãs.
4. Suba um degrau de superfície (#0B0D12 → #12151D → #191E28) para hierarquia.
5. Respeite min-height 2.75rem em todo controle interativo (44px+).
6. Use `clamp()` na tipografia display; corpo sempre 1rem.
7. Teste foco visível em todo componente novo (outline âmbar 3px).
8. Ícones em SVG inline, com `aria-hidden` quando decorativos.

### Don'ts
1. Não use âmbar como cor de texto corrente ou em parágrafos longos.
2. Não introduza roxo, gradiente genérico ou neon (#00FF00/#FF00FF).
3. Não use Inter, Roboto, Arial, Helvetica, Space Grotesk, Lato, Open Sans.
4. Não arredonde além de 0.75rem — nada de bolha.
5. Não use emoji como ícone.
6. Não use sombra no estado de repouso do card — borda basta.
7. Não quebre o vocabulário `.form-*` dos dialogs.
8. Não coloque Russo One em corpo de texto ou em weight inventado.

### The AI Slop Test
> Se alguém olhasse e soubesse que IA fez, acreditaria? Se sim, redesenhe.

Tells a evitar aqui: hero centralizado sobre gradiente roxo; 3 colunas simétricas de
features; "Bem-vindo ao site"; cantos 1rem+ em tudo; teal+coral.

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Columns | Container Padding |
|------|-------|---------|-------------------|
| Mobile | 320px | 1 | 16px (1rem) |
| Tablet | 768px | 2 | 24px |
| Desktop | 1024px | 3 | 32px |
| Large | 1280px | 3–4 | 32px |
| XL | 1536px | 4 | 32px |

Grid de cards: `repeat(auto-fit, minmax(16rem, 1fr))` — sem media query para colunas.

### Touch Targets
- Mínimo 44×44px (min-height 2.75rem nos controles)
- Espaço mínimo entre alvos: 8px

### Typography Scaling
| Role | Mobile | Tablet | Desktop |
|------|--------|--------|---------|
| Display Hero | 2rem | 2.5rem | 3rem |
| Section Heading | 1.375rem | 1.55rem | 1.75rem |
| Body | 1rem | 1rem | 1rem |

### Collapsing Strategy
- **Header:** flex-wrap natural; em <640px o menu quebra para linha própria abaixo da
  marca. Sem hambúrguer (só 3 itens + user menu).
- **Cards:** 1 coluna mobile, auto-fit resolve tablet/desktop.
- **Filtros do browser:** empilhados no mobile; em 1024px+ lado a lado com a busca.

## 9. Agent Prompt Guide

### Quick Color Reference
- Primary (ação): #FFB020
- On Primary: #171208
- Background: #0B0D12
- Surface: #12151D
- Surface Muted: #191E28
- Text Primary: #E8EAEE
- Text Muted: #9AA3B2
- Border: #262C3A / forte #3A4254
- Link: #85B6FF
- Star: #E3B341

### Example Component Prompts

**Hero da home:**
"Sem título visível (decisão de design): intro curta em Chakra Petch 1rem #9AA3B2,
max-width 60ch, direto acima da busca. h1 oculto preserva a hierarquia. Sem
gradientes e sem linha decorativa."

**Mod card:**
"Card em #12151D, borda 1px #262C3A, radius 0.5rem, padding 1rem. Título Chakra Petch
1.125rem 600 #E8EAEE. Meta 0.875rem #9AA3B2. Estrelas #E3B341. Hover: borda #3A4254,
shadow 0 4px 12px rgb(0 0 0 / 0.4), translateY(-2px), 150ms ease."

**Formulário em dialog:**
"Dialog sobre overlay rgb(0 0 0 / 0.6), painel #12151D radius 0.75rem, shadow 0 12px
32px rgb(0 0 0 / 0.5). Labels Chakra Petch 0.875rem 600 #E8EAEE. Inputs #12151D borda
#3A4254, foco #FFB020. Erros #E8CE96 com o vocabulário .form-*."

**Footer:**
"Footer em #12151D, borda superior 1px #262C3A. Texto 0.875rem #9AA3B2. Links
#85B6FF, hover #A9CCFF."
